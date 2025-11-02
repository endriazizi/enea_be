// src/db/index.js
// ============================================================================
// MySQL pool (mysql2/promise) con:
// - multipleStatements: true (migrations/file SQL interi)
// - SET time_zone = '+00:00' (politica UTC a DB)
// - SET NAMES utf8mb4 (emoji safe)
// Stile: commenti lunghi, log con emoji
// ============================================================================
'use strict';

const mysql = require('mysql2/promise');
const logger = require('../logger');

const {
  DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT = 3306,
} = process.env;

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      port: Number(DB_PORT || 3306),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      multipleStatements: true,
      timezone: 'Z', // usa UTC in driver
    });
    logger.info('🗄️  DB Pool created', { host: DB_HOST, db: DB_NAME });
  }
  return pool;
}

async function prime(conn) {
  await conn.query(`SET time_zone = '+00:00'`);
  await conn.query(`SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci`);
}

async function query(sql, params = []) {
  const p = getPool();
  const conn = await p.getConnection();
  try {
    await prime(conn);
    const [rows] = await conn.query(sql, params);
    return rows;
  } finally {
    conn.release();
  }
}

module.exports = { query };
