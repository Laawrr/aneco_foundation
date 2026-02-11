const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
require('dotenv').config();

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });
const app = express();
app.use(cors());
// Allow larger payloads for base64 signature PNGs
app.use(express.json({ limit: '8mb' }));

function resolveSignatureDir(rawValue) {
  let value = String(rawValue || '').trim();
  if (!value) return '\\\\192.168.0.101\\shared';

  // Remove accidental wrapping quotes in .env values.
  value = value.replace(/^['"]|['"]$/g, '');
  // Accept slash style from copied paths.
  value = value.replace(/\//g, '\\');

  // If value starts with a single "\" and resembles UNC, fix it to "\\server\share".
  if (value.startsWith('\\') && !value.startsWith('\\\\')) {
    value = `\\${value}`;
  }

  // Auto-correct malformed UNC accidentally turned into local path, e.g. C:\192.168.0.101\shared
  const malformedUncMatch = value.match(/^[A-Za-z]:\\(\d{1,3}(?:\.\d{1,3}){3}(?:\\.*)?)$/);
  if (malformedUncMatch) {
    value = `\\\\${malformedUncMatch[1]}`;
  }

  // Auto-correct root-relative ip path, e.g. \192.168.0.101\shared
  const rootRelativeIpMatch = value.match(/^\\(\d{1,3}(?:\.\d{1,3}){3}(?:\\.*)?)$/);
  if (rootRelativeIpMatch) {
    value = `\\\\${rootRelativeIpMatch[1]}`;
  }

  let normalized = value;
  try {
    normalized = path.win32.normalize(value);
  } catch (e) {
    normalized = value;
  }

  // Canonicalize UNC-like IP path to always start with two backslashes.
  const singleSlashIpMatch = String(normalized).match(/^\\(\d{1,3}(?:\.\d{1,3}){3}(?:\\.*)?)$/);
  if (singleSlashIpMatch) {
    return `\\\\${singleSlashIpMatch[1]}`;
  }

  return normalized;
}

function isLikelyLocalIpPath(value) {
  return /^[A-Za-z]:\\\d{1,3}(?:\.\d{1,3}){3}(?:\\|$)/.test(String(value || ''));
}

function isAllowedSignatureDir(value) {
  const normalized = String(value || '').toUpperCase();
  // Allow exact UNC share root (with optional trailing slash) or mapped Z drive.
  if (/^\\\\192\.168\.0\.101\\SHARED(?:\\)?$/.test(normalized)) return true;
  if (/^Z:\\(?:)?$/.test(normalized)) return true;
  return false;
}

const signatureDir = resolveSignatureDir(process.env.SIGNATURE_DIR || '\\\\192.168.0.101\\shared');
console.log('[server] signatureDir=', signatureDir);
console.log('[server] signatureDir(raw)=', JSON.stringify(signatureDir));

if (isLikelyLocalIpPath(signatureDir) || !isAllowedSignatureDir(signatureDir)) {
  console.error('[server] Invalid SIGNATURE_DIR:', signatureDir);
  console.error('[server] Allowed values: \\\\192.168.0.101\\shared or Z:\\');
  process.exit(1);
}

// Admin access code (from ENV or default)
const ADMIN_CODE = process.env.ADMIN_CODE || 'ANEC0491977';
// Changes on each server boot so frontend sessions are invalidated after restart.
const SERVER_SESSION_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const SIGNATURE_IO_TIMEOUT_MS = Number(process.env.SIGNATURE_IO_TIMEOUT_MS || 10000);

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

function normalizeTransactionRef(value) {
  return String(value || '')
    .replace(/[^\d]/g, '')
    .trim();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function countDigits(value) {
  return (String(value || '').match(/\d/g) || []).length;
}

function parseMoney(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function validateOcrPayload(payload) {
  const errors = [];

  const transactionRef = normalizeTransactionRef(payload.transactionRef);
  const accountNumber = normalizeAccountNumber(payload.accountNumber);
  const customerName = normalizeText(payload.customerName);
  const scannerName = normalizeText(payload.scannerName);
  const date = normalizeText(payload.date);
  const company = normalizeText(payload.company) || null;
  const electricityBill = parseMoney(payload.electricityBill);
  const amountDue = parseMoney(payload.amountDue);
  const totalSales = parseMoney(payload.totalSales);

  if (!transactionRef) errors.push('Transaction Reference is required');
  if (transactionRef && countDigits(transactionRef) < 15) {
    errors.push('Transaction reference must have at least 15 digits');
  }

  if (!date) errors.push('Date is required');

  if (!customerName) errors.push('Customer Name is required');
  if (customerName && !/^[A-Za-z][A-Za-z\s,\-./']*$/.test(customerName)) {
    errors.push('Customer Name must contain valid text only');
  }

  if (!accountNumber) errors.push('Account Number is required');
  const accountDigits = accountNumber.replace(/^B/, '');
  if (accountNumber && !/^\d{6,}$/.test(accountDigits)) {
    errors.push('Account number must contain at least 6 digits');
  }

  if (!scannerName) errors.push('Scanner Name is required');

  if (electricityBill == null) {
    errors.push('Amount (Bill) is required');
  } else if (Number.isNaN(electricityBill) || electricityBill < 50) {
    errors.push('Bill amount must be at least 50');
  }

  if (amountDue !== null && Number.isNaN(amountDue)) {
    errors.push('Amount Due must be a valid number');
  }

  if (totalSales !== null && Number.isNaN(totalSales)) {
    errors.push('Total Sales must be a valid number');
  }

  return {
    errors,
    data: {
      transactionRef,
      accountNumber,
      customerName,
      scannerName,
      date,
      company,
      electricityBill,
      amountDue: Number.isNaN(amountDue) ? null : amountDue,
      totalSales: Number.isNaN(totalSales) ? null : totalSales,
    },
  };
}

async function acquireAccountLock(conn, accountNumber) {
  const lockKey = `ocr-account:${accountNumber}`;
  const [rows] = await conn.query('SELECT GET_LOCK(?, 5) AS acquired', [lockKey]);
  const acquired = rows && rows[0] && Number(rows[0].acquired) === 1;
  return { lockKey, acquired };
}

async function releaseAccountLock(conn, lockKey) {
  if (!conn || !lockKey) return;
  try {
    await conn.query('SELECT RELEASE_LOCK(?) AS released', [lockKey]);
  } catch (err) {
    console.warn('[db] failed to release account lock', lockKey, err && err.message ? err.message : err);
  }
}

function runWithTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function saveSignatureToSharedFolder(signatureDataUrl) {
  const startedAt = Date.now();
  const m = String(signatureDataUrl || '').match(/^data:image\/png;base64,(.+)$/);
  if (!m || !m[1]) {
    return { signatureName: null, signaturePath: null, warning: 'Invalid signature format', durationMs: Date.now() - startedAt };
  }

  if (isLikelyLocalIpPath(signatureDir)) {
    return {
      signatureName: null,
      signaturePath: null,
      warning: `Invalid SIGNATURE_DIR resolved to local path: ${signatureDir}. Use UNC \\\\192.168.0.101\\shared or mapped drive like Z:\\`,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    await runWithTimeout(
      fs.promises.mkdir(signatureDir, { recursive: true }),
      SIGNATURE_IO_TIMEOUT_MS,
      'Signature directory check'
    );

    const buffer = Buffer.from(m[1], 'base64');
    const filename = `signature_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const savePath = path.join(signatureDir, filename);

    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await runWithTimeout(
          fs.promises.writeFile(savePath, buffer),
          SIGNATURE_IO_TIMEOUT_MS,
          `Signature write attempt ${attempt}`
        );
        return {
          signatureName: filename,
          signaturePath: savePath,
          warning: null,
          durationMs: Date.now() - startedAt,
        };
      } catch (err) {
        lastError = err;
      }
    }

    return {
      signatureName: null,
      signaturePath: null,
      warning: lastError && lastError.message ? lastError.message : String(lastError || 'Unknown signature write error'),
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      signatureName: null,
      signaturePath: null,
      warning: err && err.message ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
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
    if (!err || err.code !== 'ER_DUP_FIELDNAME') {
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
    if (isLikelyLocalIpPath(signatureDir)) {
      return res.status(500).json({
        ok: false,
        error: `Invalid SIGNATURE_DIR resolved to local path: ${signatureDir}`,
        details: ['Use UNC path (\\\\192.168.0.101\\shared) or mapped drive (Z:\\).'],
      });
    }
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

// Endpoint to check if transaction reference already exists
app.get('/api/check-transaction/:transactionRef', async (req, res) => {
  const normalizedRef = normalizeTransactionRef(req.params.transactionRef);
  console.log(`[api] check-transaction requested: transactionRef=${normalizedRef}`);
  let conn;
  try {
    conn = await getConnection();
    await ensureOcrTable(conn);
    const [rows] = await conn.query(
      'SELECT COUNT(*) as count FROM ocr_data WHERE transaction_ref = ?',
      [normalizedRef]
    );
    const exists = rows[0].count > 0;
    console.log(`[api] check-transaction result: count=${rows[0].count}`);
    res.json({ ok: true, exists, count: rows[0].count, transactionRef: normalizedRef });
  } catch (err) {
    console.error('[api] Error checking transaction reference:', err && err.code ? `${err.code}: ${err.message}` : err);
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    if (conn) conn && conn.release();
  }
});

// Endpoint to save parsed OCR data to database
app.post('/api/ocr-data', async (req, res) => {
  const { transactionRef, accountNumber, customerName, scannerName, date, electricityBill, amountDue, totalSales, company, signature } = req.body;
  console.log('[api] save-ocr-data requested', { transactionRef, accountNumber, customerName, scannerName, date, electricityBill, amountDue, totalSales, company, hasSignature: Boolean(signature) });

  if (!signature) {
    return res.status(400).json({
      ok: false,
      error: 'Signature is required',
      code: 'SIGNATURE_REQUIRED',
      details: ['No signature payload was received by the server.'],
    });
  }

  if (!/^data:image\/png;base64,/.test(String(signature))) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid signature format',
      code: 'INVALID_SIGNATURE_FORMAT',
      details: ['Signature must be a PNG data URL (data:image/png;base64,...)'],
    });
  }

  const { errors, data } = validateOcrPayload(req.body || {});
  if (errors.length > 0) {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: errors,
    });
  }

  let conn;
  let signatureName = null;
  let signaturePath = null;
  let signatureSaveMs = 0;
  let lockKey = null;
  try {
    conn = await getConnection();
    await ensureOcrTable(conn);

    const lock = await acquireAccountLock(conn, data.accountNumber);
    if (!lock.acquired) {
      return res.status(429).json({
        ok: false,
        error: 'A save is already in progress for this account number. Please try again.',
        code: 'ACCOUNT_LOCK_TIMEOUT',
      });
    }
    lockKey = lock.lockKey;

    const [existingRows] = await conn.query(
      'SELECT COUNT(*) AS count FROM ocr_data WHERE UPPER(REPLACE(account_number, " ", "")) = ?',
      [data.accountNumber]
    );
    if (existingRows && existingRows[0] && Number(existingRows[0].count) > 0) {
      return res.status(409).json({
        ok: false,
        error: 'Account number already exists in database',
        code: 'DUPLICATE_ACCOUNT_NUMBER',
      });
    }

    const [existingTxRows] = await conn.query(
      'SELECT COUNT(*) AS count FROM ocr_data WHERE transaction_ref = ?',
      [data.transactionRef]
    );
    if (existingTxRows && existingTxRows[0] && Number(existingTxRows[0].count) > 0) {
      return res.status(409).json({
        ok: false,
        error: 'Transaction reference already exists in database',
        code: 'DUPLICATE_TRANSACTION_REFERENCE',
      });
    }

    // If signature provided (base64 png), save to network share
    if (signature) {
      const signatureResult = await saveSignatureToSharedFolder(signature);
      signatureName = signatureResult.signatureName;
      signaturePath = signatureResult.signaturePath;
      signatureSaveMs = signatureResult.durationMs;
      if (signaturePath) {
        console.log('[api] signature saved to', signaturePath, `(in ${signatureSaveMs}ms)`);
      } else {
        const warning = signatureResult.warning || 'Unknown signature write failure';
        console.warn('[api] signature write failed:', warning, `(after ${signatureSaveMs}ms)`);
        return res.status(503).json({
          ok: false,
          error: 'Failed to save signature image to network shared folder',
          code: 'SIGNATURE_SAVE_FAILED',
          details: [warning],
          signatureSaveMs,
        });
      }
    }

    // Insert the data
    const [result] = await conn.query(
      'INSERT INTO ocr_data (transaction_ref, account_number, customer_name, scanner_name, company, date, electricity_bill, amount_due, total_sales, signature_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        data.transactionRef,
        data.accountNumber,
        data.customerName,
        data.scannerName,
        data.company,
        data.date,
        data.electricityBill,
        data.amountDue,
        data.totalSales,
        signatureName
      ]
    );
    console.log('[api] OCR data saved, id=', result.insertId);

    res.json({
      ok: true,
      id: result.insertId,
      signature: signatureName,
      signaturePath: signaturePath || null,
      signatureSaveMs,
      message: 'Data saved successfully',
    });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        ok: false,
        error: 'Account number already exists in database',
        code: 'DUPLICATE_ACCOUNT_NUMBER',
      });
    }
    console.error('[api] Error saving OCR data:', err && err.code ? `${err.code}: ${err.message}` : err);
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    if (conn && lockKey) {
      await releaseAccountLock(conn, lockKey);
    }
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

  const { errors, data } = validateOcrPayload(req.body || {});
  if (errors.length > 0) {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: errors,
    });
  }

  let conn;
  let lockKey = null;
  try {
    conn = await getConnection();

    await ensureOcrTable(conn);

    const lock = await acquireAccountLock(conn, data.accountNumber);
    if (!lock.acquired) {
      return res.status(429).json({
        ok: false,
        error: 'An update is already in progress for this account number. Please try again.',
        code: 'ACCOUNT_LOCK_TIMEOUT',
      });
    }
    lockKey = lock.lockKey;

    const [existingRows] = await conn.query(
      'SELECT COUNT(*) AS count FROM ocr_data WHERE UPPER(REPLACE(account_number, " ", "")) = ? AND id <> ?',
      [data.accountNumber, id]
    );
    if (existingRows && existingRows[0] && Number(existingRows[0].count) > 0) {
      return res.status(409).json({
        ok: false,
        error: 'Account number already exists in database',
        code: 'DUPLICATE_ACCOUNT_NUMBER',
      });
    }

    const [existingTxRows] = await conn.query(
      'SELECT COUNT(*) AS count FROM ocr_data WHERE transaction_ref = ? AND id <> ?',
      [data.transactionRef, id]
    );
    if (existingTxRows && existingTxRows[0] && Number(existingTxRows[0].count) > 0) {
      return res.status(409).json({
        ok: false,
        error: 'Transaction reference already exists in database',
        code: 'DUPLICATE_TRANSACTION_REFERENCE',
      });
    }

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
        data.transactionRef,
        data.accountNumber,
        data.customerName,
        data.scannerName,
        data.company,
        data.date,
        data.electricityBill,
        data.amountDue,
        data.totalSales,
        id,
      ]
    );

    res.json({ ok: true, affectedRows: result.affectedRows });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        ok: false,
        error: 'Account number already exists in database',
        code: 'DUPLICATE_ACCOUNT_NUMBER',
      });
    }
    console.error('[api] Error updating OCR data:', err && err.code ? `${err.code}: ${err.message}` : err);
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    if (conn && lockKey) {
      await releaseAccountLock(conn, lockKey);
    }
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
