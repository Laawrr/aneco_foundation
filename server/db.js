require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'anecofoundation',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function testConnection() {
  let conn;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT 1 AS ok');
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { pool, testConnection };
