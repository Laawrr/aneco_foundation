const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });
const app = express();
app.use(cors());
// Allow larger payloads for base64 signature PNGs
app.use(express.json({ limit: '8mb' }));

let signatureDir = process.env.SIGNATURE_DIR || '\\\\192.168.137.1\\shared';
// Normalize for Windows UNC paths using win32
try {
  signatureDir = require('path').win32.normalize(signatureDir);
} catch (e) {
  // fallback: leave as-is
}
console.log('[server] signatureDir=', signatureDir);

// Admin access code (from ENV or default)
const ADMIN_CODE = process.env.ADMIN_CODE || 'ANEC0491977';
// Changes on each server boot so frontend sessions are invalidated after restart.
const SERVER_SESSION_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

let worker;

(async () => {
  try {
    console.log('Creating Tesseract worker...');
    worker = await createWorker({
      logger: m => {
        // Useful logs for progress and troubleshooting
        if (m && m.status && m.progress !== undefined) {
          console.log(`[tesseract] ${m.status} - ${Math.round(m.progress * 100)}%`);
        } else if (m && m.status) {
          console.log(`[tesseract] ${m.status}`);
        } else {
          console.log('[tesseract]', m);
        }
      }
    });

    console.log('Loading Tesseract worker...');
    // worker.load is deprecated in Node; worker comes pre-loaded, ensure language initialized
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    console.log('Tesseract worker ready');
  } catch (err) {
    console.error('Failed to initialize Tesseract worker', err);
    worker = null;
  }
})();

const { testConnection, getConnection, pool } = require('./db');

function normalizeAccountNumber(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

async function ensureOcrTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS ocr_data (
      id INT AUTO_INCREMENT PRIMARY KEY,
      transaction_ref VARCHAR(100),
      account_number VARCHAR(100),
      customer_name VARCHAR(255),
      scanner_name VARCHAR(255),
      company VARCHAR(255),
      date VARCHAR(50),
      electricity_bill DECIMAL(10, 2),
      amount_due DECIMAL(10, 2),
      total_sales DECIMAL(10, 2),
      signature_name VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add scanner_name for databases created before this feature.
  try {
    await conn.query('ALTER TABLE ocr_data ADD COLUMN scanner_name VARCHAR(255) NULL AFTER customer_name');
  } catch (err) {
    if (!err || err.code !== 'ER_DUP_FIELDNAME') {
      throw err;
    }
  }

  // Add signature_name for older databases
  try {
    await conn.query('ALTER TABLE ocr_data ADD COLUMN signature_name VARCHAR(255) NULL AFTER total_sales');
  } catch (err) {
    if (!err && err.code !== 'ER_DUP_FIELDNAME') {
      throw err;
    }
  }
}

function isSafeSignatureFilename(filename) {
  const value = String(filename || '');
  if (!value) return false;
  if (value.includes('..') || value.includes('/') || value.includes('\\')) return false;
  return true;
}

async function cleanupOrphanSignatureFiles(conn) {
  await ensureOcrTable(conn);

  const [rows] = await conn.query(
    `SELECT signature_name AS signatureName
     FROM ocr_data
     WHERE signature_name IS NOT NULL AND signature_name <> ''`
  );

  const referencedFiles = new Set(
    rows
      .map((row) => row && row.signatureName)
      .filter((name) => isSafeSignatureFilename(name))
  );

  let filesInDir = [];
  try {
    filesInDir = await fs.promises.readdir(signatureDir);
  } catch (err) {
    // If folder is unavailable, return stats without failing whole process.
    console.warn('[cleanup] cannot read signature directory:', err && err.message ? err.message : err);
    return { scanned: 0, deleted: 0, skipped: 0, errors: 1 };
  }

  let scanned = 0;
  let deleted = 0;
  let skipped = 0;
  let errors = 0;

  for (const fileName of filesInDir) {
    if (!isSafeSignatureFilename(fileName)) {
      skipped += 1;
      continue;
    }

    // Only touch PNG signature files created by this app.
    if (!fileName.toLowerCase().endsWith('.png')) {
      skipped += 1;
      continue;
    }
    if (!fileName.startsWith('signature_')) {
      skipped += 1;
      continue;
    }

    scanned += 1;
    if (referencedFiles.has(fileName)) {
      continue;
    }

    const filePath = path.join(signatureDir, fileName);
    try {
      await fs.promises.unlink(filePath);
      deleted += 1;
    } catch (unlinkErr) {
      if (!unlinkErr || unlinkErr.code !== 'ENOENT') {
        errors += 1;
        console.error('[cleanup] failed to delete orphan signature:', fileName, unlinkErr);
      }
    }
  }

  return { scanned, deleted, skipped, errors };
}

async function runSignatureCleanupTask() {
  let conn;
  try {
    conn = await getConnection();
    const stats = await cleanupOrphanSignatureFiles(conn);
    console.log('[cleanup] orphan signature cleanup complete:', stats);
    return stats;
  } catch (err) {
    console.error('[cleanup] orphan signature cleanup failed:', err);
    return null;
  } finally {
    if (conn) conn.release();
  }
}

app.get('/health', async (req, res) => {
  const db = await testConnection();
  res.json({ ok: true, env: process.env.NODE_ENV || 'development', db });
});

// Endpoint to test write access to the network signature folder
app.post('/api/test-signature-write', async (req, res) => {
  const filename = `signature_test_${Date.now()}.txt`;
  const savePath = path.join(signatureDir, filename);
  try {
    await fs.promises.writeFile(savePath, 'test');
    res.json({ ok: true, testFile: savePath });
  } catch (err) {
    console.error('[api] test signature write failed:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Manual cleanup endpoint for orphaned signature images.
app.post('/api/cleanup-signature-storage', async (req, res) => {
  const stats = await runSignatureCleanupTask();
  if (!stats) {
    return res.status(500).json({ ok: false, error: 'Cleanup failed' });
  }
  return res.json({ ok: true, ...stats });
});

// Endpoint to serve signature images
app.get('/api/signature/:filename', async (req, res) => {
  const { filename } = req.params;
  // Security: prevent directory traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ ok: false, error: 'Invalid filename' });
  }
  
  const filePath = path.join(signatureDir, filename);
  
  try {
    // Check if file exists
    await fs.promises.access(filePath, fs.constants.F_OK);
    // Set appropriate content type for PNG images
    res.setHeader('Content-Type', 'image/png');
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (err) {
    console.error('[api] Error serving signature:', err);
    res.status(404).json({ ok: false, error: 'Signature not found' });
  }
});

// Simple login endpoint that validates the admin code
app.post('/api/login', (req, res) => {
  const { code } = req.body || {};

  if (!code) {
    return res.status(400).json({ ok: false, error: 'Code is required' });
  }

  if (code === ADMIN_CODE) {
    return res.json({ ok: true, sessionId: SERVER_SESSION_ID });
  }

  return res.status(401).json({ ok: false, error: 'Invalid code' });
});

// Expose the current server session id for client-side session validation.
app.get('/api/session-status', (req, res) => {
  return res.json({ ok: true, sessionId: SERVER_SESSION_ID });
});

app.post('/ocr', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!worker) return res.status(503).json({ error: 'OCR worker not ready' });
  const filePath = req.file.path;
  try {
    // Preprocess image: auto-rotate by EXIF, convert to grayscale, resize for better OCR
    const procPath = `${filePath}-proc.jpg`;
    await sharp(filePath)
      .rotate() // Auto-orient using EXIF data
      .grayscale()
      .resize({ width: 2000, withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(procPath);

    const { data: { text } } = await worker.recognize(procPath);
    
    // Cleanup temporary files
    fs.unlink(filePath, () => {});
    fs.unlink(procPath, () => {});
    
    res.json({ text });
  } catch (err) {
    console.error('OCR error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Endpoint to check if account number already exists
app.get('/api/check-account/:accountNumber', async (req, res) => {
  const normalizedAccount = normalizeAccountNumber(req.params.accountNumber);
  console.log(`[api] check-account requested: accountNumber=${normalizedAccount}`);
  let conn;
  try {
    conn = await getConnection();
    await ensureOcrTable(conn);
    const [rows] = await conn.query(
      'SELECT COUNT(*) as count FROM ocr_data WHERE UPPER(REPLACE(account_number, " ", "")) = ?',
      [normalizedAccount]
    );
    const exists = rows[0].count > 0;
    console.log(`[api] check-account result: count=${rows[0].count}`);
    res.json({ ok: true, exists, count: rows[0].count, accountNumber: normalizedAccount });
  } catch (err) {
    console.error('[api] Error checking account number:', err && err.code ? `${err.code}: ${err.message}` : err);
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    if (conn) conn && conn.release();
  }
});

// Endpoint to save parsed OCR data to database
app.post('/api/ocr-data', async (req, res) => {
  const { transactionRef, accountNumber, customerName, scannerName, date, electricityBill, amountDue, totalSales, company, signature } = req.body;
  console.log('[api] save-ocr-data requested', { transactionRef, accountNumber, customerName, scannerName, date, electricityBill, amountDue, totalSales, company, hasSignature: Boolean(signature) });

  let conn;
  let signatureName = null;
  let signaturePath = null;
  try {
    conn = await getConnection();
    await ensureOcrTable(conn);

    const [existingRows] = await conn.query(
      'SELECT COUNT(*) AS count FROM ocr_data WHERE UPPER(REPLACE(account_number, " ", "")) = ?',
      [normalizeAccountNumber(accountNumber)]
    );
    if (existingRows && existingRows[0] && Number(existingRows[0].count) > 0) {
      return res.status(409).json({
        ok: false,
        error: 'Account number already exists in database',
        code: 'DUPLICATE_ACCOUNT_NUMBER',
      });
    }

    // If signature provided (base64 png), save to network share
    if (signature) {
      try {
        // Ensure signatureDir exists (attempt to create; if on network share this may fail)
        try {
          await fs.promises.mkdir(signatureDir, { recursive: true });
        } catch (mkErr) {
          console.warn('[api] could not create signature directory (maybe permission/network issue):', mkErr && mkErr.message ? mkErr.message : mkErr);
        }

        const m = String(signature).match(/^data:image\/png;base64,(.+)$/);
        if (m && m[1]) {
          const buffer = Buffer.from(m[1], 'base64');
          const filename = `signature_${Date.now()}_${Math.random().toString(36).slice(2,8)}.png`;
          // Use path.join without resolve to preserve UNC path semantics on Windows
          const savePath = path.join(signatureDir, filename);
          await fs.promises.writeFile(savePath, buffer);
          signatureName = filename;
          signaturePath = savePath; // full path for response
          console.log('[api] signature saved to', savePath);
        } else {
          console.warn('[api] invalid signature format');
        }
      } catch (e) {
        console.error('[api] failed to save signature:', e);
        // don't fail the whole request; continue without signature
      }
    }

    // Insert the data
    const [result] = await conn.query(
      'INSERT INTO ocr_data (transaction_ref, account_number, customer_name, scanner_name, company, date, electricity_bill, amount_due, total_sales, signature_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        transactionRef || null,
        normalizeAccountNumber(accountNumber) || null,
        customerName || null,
        scannerName || null,
        company || null,
        date || null,
        electricityBill ? parseFloat(String(electricityBill).replace(/,/g, '')) : null,
        amountDue ? parseFloat(String(amountDue).replace(/,/g, '')) : null,
        totalSales ? parseFloat(String(totalSales).replace(/,/g, '')) : null,
        signatureName
      ]
    );
    console.log('[api] OCR data saved, id=', result.insertId);

    res.json({ ok: true, id: result.insertId, signature: signatureName, signaturePath: signaturePath || null, message: 'Data saved successfully' });
  } catch (err) {
    console.error('[api] Error saving OCR data:', err && err.code ? `${err.code}: ${err.message}` : err);
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    if (conn) conn && conn.release();
  }
});

// Endpoint to fetch OCR data for the dashboard
app.get('/api/ocr-data', async (req, res) => {
  const { limit } = req.query;
  const rowLimit = Number(limit) && Number(limit) > 0 ? Number(limit) : 100;

  let conn;
  try {
    conn = await getConnection();

    await ensureOcrTable(conn);

    const [rows] = await conn.query(
      `SELECT
         id,
         transaction_ref   AS transactionRef,
         account_number    AS accountNumber,
         customer_name     AS customerName,
         scanner_name      AS scannerName,
         company,
         date,
         electricity_bill  AS electricityBill,
         amount_due        AS amountDue,
         total_sales       AS totalSales,
         signature_name     AS signatureName,
         created_at        AS createdAt
       FROM ocr_data
       ORDER BY id ASC
       LIMIT ?`,
      [rowLimit]
    );

    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[api] Error fetching OCR data:', err && err.code ? `${err.code}: ${err.message}` : err);
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    if (conn) conn && conn.release();
  }
});

// Endpoint to update an existing OCR row
app.put('/api/ocr-data/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid id' });
  }

  const {
    transactionRef,
    accountNumber,
    customerName,
    scannerName,
    date,
    electricityBill,
    amountDue,
    totalSales,
    company,
  } = req.body;

  let conn;
  try {
    conn = await getConnection();

    await ensureOcrTable(conn);

    const [result] = await conn.query(
      `UPDATE ocr_data
       SET transaction_ref = ?,
           account_number  = ?,
           customer_name   = ?,
           scanner_name    = ?,
           company         = ?,
           date            = ?,
           electricity_bill= ?,
           amount_due      = ?,
           total_sales     = ?
       WHERE id = ?`,
      [
        transactionRef || null,
        accountNumber || null,
        customerName || null,
        scannerName || null,
        company || null,
        date || null,
        electricityBill != null ? parseFloat(String(electricityBill).replace(/,/g, '')) : null,
        amountDue != null ? parseFloat(String(amountDue).replace(/,/g, '')) : null,
        totalSales != null ? parseFloat(String(totalSales).replace(/,/g, '')) : null,
        id,
      ]
    );

    res.json({ ok: true, affectedRows: result.affectedRows });
  } catch (err) {
    console.error('[api] Error updating OCR data:', err && err.code ? `${err.code}: ${err.message}` : err);
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    if (conn) conn && conn.release();
  }
});

// Endpoint to delete an existing OCR row
app.delete('/api/ocr-data/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid id' });
  }

  let conn;
  try {
    conn = await getConnection();

    // Read signature name first so we can clean up file after delete.
    const [existingRows] = await conn.query(
      'SELECT signature_name AS signatureName FROM ocr_data WHERE id = ? LIMIT 1',
      [id]
    );
    const signatureName = existingRows && existingRows[0] ? existingRows[0].signatureName : null;

    const [result] = await conn.query('DELETE FROM ocr_data WHERE id = ?', [id]);

    let signatureDeleted = false;
    let signatureDeleteError = null;
    if (result.affectedRows > 0 && signatureName) {
      // If another row still references the same signature, keep the file.
      const [usageRows] = await conn.query(
        'SELECT COUNT(*) AS refCount FROM ocr_data WHERE signature_name = ?',
        [signatureName]
      );
      const refCount = usageRows && usageRows[0] ? Number(usageRows[0].refCount) : 0;

      if (isSafeSignatureFilename(signatureName) && refCount === 0) {
        const filePath = path.join(signatureDir, signatureName);
        try {
          await fs.promises.unlink(filePath);
          signatureDeleted = true;
        } catch (unlinkErr) {
          if (!unlinkErr || unlinkErr.code !== 'ENOENT') {
            signatureDeleteError = String(unlinkErr);
            console.error('[api] Error deleting signature file:', unlinkErr);
          }
        }
      }
    }

    res.json({
      ok: true,
      affectedRows: result.affectedRows,
      signatureName: signatureName || null,
      signatureDeleted,
      signatureDeleteError,
    });
  } catch (err) {
    console.error('[api] Error deleting OCR data:', err && err.code ? `${err.code}: ${err.message}` : err);
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    if (conn) conn && conn.release();
  }
});

const port = process.env.PORT || 3001;
const host = process.env.HOST || '0.0.0.0'; // Listen on all network interfaces
const server = app.listen(port, host, () => console.log(`OCR server listening on ${host}:${port}`));

// Cleanup once at boot, then periodically to remove any orphaned signature files.
setTimeout(() => {
  runSignatureCleanupTask();
}, 1500);
setInterval(() => {
  runSignatureCleanupTask();
}, 60 * 60 * 1000);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  server.close(async () => {
    try { await worker.terminate(); } catch (e) {}
    process.exit(0);
  });
});
