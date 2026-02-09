require('dotenv').config();
const mysql = require('mysql2/promise');

// Allow providing a full connection URL (e.g. mysql://user:pass@host:3306/dbname)
let parsedConfig = {};
if (process.env.DATABASE_URL) {
  try {
    const dbUrl = new URL(process.env.DATABASE_URL);
    parsedConfig.host = dbUrl.hostname;
    parsedConfig.port = dbUrl.port ? Number(dbUrl.port) : 3306;
    parsedConfig.user = dbUrl.username ? decodeURIComponent(dbUrl.username) : undefined;
    parsedConfig.password = dbUrl.password ? decodeURIComponent(dbUrl.password) : undefined;
    parsedConfig.database = dbUrl.pathname ? dbUrl.pathname.replace(/^\//, '') : undefined;
  } catch (e) {
    console.warn('Invalid DATABASE_URL, falling back to environment variables');
  }
}

const pool = mysql.createPool({
  host: parsedConfig.host || process.env.DB_HOST || '192.168.137.1',
  port: parsedConfig.port || (process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306),
  user: parsedConfig.user || process.env.DB_USER || 'root',
  password: parsedConfig.password || process.env.DB_PASSWORD || '',
  database: parsedConfig.database || process.env.DB_NAME || 'anecofoundation',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: Number(process.env.DB_QUEUE_LIMIT || 0),
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 10000),
});

// Log pool summary (redact sensitive fields)
try {
  const cfg = pool.config && pool.config.connectionConfig ? pool.config.connectionConfig : {};
  console.log(`[db] Pool configured - host=${cfg.host||'unknown'}, port=${cfg.port||'3306'}, user=${cfg.user||'unknown'}, database=${cfg.database||'unknown'}, connectionLimit=${pool.config.connectionLimit||'unknown'}`);
} catch (e) {
  console.log('[db] Pool created');
}

// Wrapper to acquire connection with logs
async function getConnection() {
  console.log('[db] Attempting to acquire a DB connection from pool...');
  try {
    const conn = await pool.getConnection();
    console.log(`[db] Connection acquired (threadId=${conn.threadId||'n/a'})`);
    return conn;
  } catch (err) {
    console.error('[db] Error acquiring connection:', err && err.code ? `${err.code}: ${err.message}` : err);
    throw err;
  }
}

async function testConnection() {
  let conn;
  try {
    conn = await getConnection();
    const [rows] = await conn.query('SELECT 1 AS ok');
    console.log('[db] testConnection successful');
    return { ok: true, rows };
  } catch (err) {
    console.error('[db] testConnection failed:', err && err.code ? `${err.code}: ${err.message}` : err);
    return { ok: false, error: String(err) };
  } finally {
    if (conn) conn && conn.release();
  }
}

module.exports = { pool, testConnection, getConnection };
