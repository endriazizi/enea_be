'use strict';

/**
 * src/db/index.js
 * -----------------------------------------------------------------------------
 * Pool MySQL (mysql2/promise) + helper query.
 *
 * ✅ FIX:
 * - Leggiamo sempre da src/env.js (che ora carica anche il .env)
 * - Normalizziamo host "localhost" → "127.0.0.1" per evitare ::1 su Windows
 * - Logghiamo config “safe” (senza password)
 */

const mysql = require('mysql2/promise');
const env = require('../env');
const logger = require('./logger');

let _pool = null;

function normalizeHost(host) {
  const h = String(host || '').trim();
  if (!h) return '127.0.0.1';
  if (h.toLowerCase() === 'localhost') {
    // Windows spesso risolve localhost su ::1 (IPv6) e MySQL non ascolta lì
    return '127.0.0.1';
  }
  return h;
}

function getPool() {
  if (_pool) return _pool;

  const host = normalizeHost(env.DB.host);
  const port = env.DB.port || 3306;

  // fallback extra per non avere user/db vuoti (ti evitano log “db:'' user:''”)
  const user = (env.DB.user && String(env.DB.user).trim()) ? env.DB.user : 'root';
  const database = (env.DB.database && String(env.DB.database).trim()) ? env.DB.database : 'app';

  _pool = mysql.createPool({
    host,
    port,
    user,
    password: env.DB.password || '',
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true,

    // timeouts “umani”
    connectTimeout: 10_000,
  });

  logger.info('🗄️  DB Pool created', {
    service: 'server',
    host,
    port,
    db: database,
    user: user ? (String(user).slice(0, 2) + '…') : '',
    envFileLoaded: env._envFileLoaded || '(none)',
  });

  return _pool;
}

/**
 * Query helper
 * - Ritorna direttamente rows (come fai già in varie API)
 * - Logga SQL solo in caso di errore
 */
async function query(sql, params = []) {
  const pool = getPool();
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (err) {
    logger.error('🗄️  DB query ❌', {
      service: 'server',
      error: String(err && err.message ? err.message : err),
      sql: String(sql || '').slice(0, 2000),
    });
    throw err;
  }
}

module.exports = {
  getPool,
  query,
};
