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
app.use(express.json());

// Admin access code (from ENV or default)
const ADMIN_CODE = process.env.ADMIN_CODE || 'ANEC0491977';

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

function isFebruary2026(dateValue) {
  if (!dateValue) return false;
  const raw = String(dateValue).trim();

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return year === 2026 && month === 2 && day >= 1 && day <= 29;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getFullYear() === 2026 && parsed.getMonth() === 1;
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
}

app.get('/health', async (req, res) => {
  const db = await testConnection();
  res.json({ ok: true, env: process.env.NODE_ENV || 'development', db });
});

// Simple login endpoint that validates the admin code
app.post('/api/login', (req, res) => {
  const { code } = req.body || {};

  if (!code) {
    return res.status(400).json({ ok: false, error: 'Code is required' });
  }

  if (code === ADMIN_CODE) {
    return res.json({ ok: true });
  }

  return res.status(401).json({ ok: false, error: 'Invalid code' });
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

// Endpoint to check if transaction ref already exists
app.get('/api/check-transaction/:transactionRef', async (req, res) => {
  const { transactionRef } = req.params;
  console.log(`[api] check-transaction requested: transactionRef=${transactionRef}`);
  let conn;
  try {
    conn = await getConnection();
    const [rows] = await conn.query(
      'SELECT COUNT(*) as count FROM ocr_data WHERE transaction_ref = ?',
      [transactionRef]
    );
    const exists = rows[0].count > 0;
    console.log(`[api] check-transaction result: count=${rows[0].count}`);
    res.json({ exists, count: rows[0].count });
  } catch (err) {
    console.error('[api] Error checking transaction:', err && err.code ? `${err.code}: ${err.message}` : err);
    res.status(500).json({ ok: false, error: String(err) });
  } finally {
    if (conn) conn && conn.release();
  }
});

// Endpoint to save parsed OCR data to database
app.post('/api/ocr-data', async (req, res) => {
  const { transactionRef, accountNumber, customerName, scannerName, date, electricityBill, amountDue, totalSales, company } = req.body;
  console.log('[api] save-ocr-data requested', { transactionRef, accountNumber, customerName, scannerName, date, electricityBill, amountDue, totalSales, company });

  if (!isFebruary2026(date)) {
    return res.status(400).json({
      ok: false,
      error: 'Only dates within February 2026 are allowed',
    });
  }

  let conn;
  try {
    conn = await getConnection();
    await ensureOcrTable(conn);
    
    // Insert the data
    const [result] = await conn.query(
      'INSERT INTO ocr_data (transaction_ref, account_number, customer_name, scanner_name, company, date, electricity_bill, amount_due, total_sales) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        transactionRef || null,
        accountNumber || null,
        customerName || null,
        scannerName || null,
        company || null,
        date || null,
        electricityBill ? parseFloat(electricityBill.replace(/,/g, '')) : null,
        amountDue ? parseFloat(amountDue.replace(/,/g, '')) : null,
        totalSales ? parseFloat(totalSales.replace(/,/g, '')) : null
      ]
    );
    console.log('[api] OCR data saved, id=', result.insertId);
    
    res.json({ ok: true, id: result.insertId, message: 'Data saved successfully' });
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

    const [result] = await conn.query('DELETE FROM ocr_data WHERE id = ?', [id]);

    res.json({ ok: true, affectedRows: result.affectedRows });
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

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  server.close(async () => {
    try { await worker.terminate(); } catch (e) {}
    process.exit(0);
  });
});
