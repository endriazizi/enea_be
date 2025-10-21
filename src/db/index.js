// src/db/index.js
// Pool MySQL + query() con log. Sessione forzata in UTC, dateStrings per evitare shift.

const mysql = require('mysql2/promise');
const env = require('../env');
const logger = require('../logger');

const pool = mysql.createPool({
  host: env.DB.host,
  port: env.DB.port,
  user: env.DB.user,
  password: env.DB.password,
  database: env.DB.database,
  waitForConnections: env.DB.waitForConnections,
  connectionLimit: env.DB.connectionLimit,
  queueLimit: env.DB.queueLimit,
  // 🔑 IMPORTANTI per time:
  dateStrings: true,   // DATETIME come stringa → niente auto-conversione a Date locale
  timezone: 'Z' ,       // ‘Z’ = UTC per le conversioni lato driver (di fatto con dateStrings non incide, ma è esplicito)
   multipleStatements: true // <-- AGGIUNGI QUESTO
});

// Forza la sessione MySQL a UTC
async function ensureUtcSession() {
  try {
    await pool.query(`SET time_zone = '+00:00'`);
    logger.info('🕒 DB session time_zone set to UTC (+00:00)');
  } catch (err) {
    logger.warn('⚠️ DB time_zone SET failed (continuo lo stesso)', { error: String(err) });
  }
}

async function query(sql, params = []) {
  const t0 = Date.now();
  try {
    const [rows] = await pool.query(sql, params);
    const ms = (Date.now() - t0).toFixed(0);
    logger.info('🐬 SQL ✅', { duration_ms: ms, sql: shorten(sql), params });
    return rows;
  } catch (err) {
    const ms = (Date.now() - t0).toFixed(0);
    logger.error('🐬 SQL ❌', { duration_ms: ms, error: String(err), sql: shorten(sql), params });
    throw err;
  }
}

// log più leggibile
function shorten(s, max = 320) {
  if (!s) return s;
  const one = String(s).replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '…[truncated]' : one;
}

module.exports = { pool, query, ensureUtcSession };
