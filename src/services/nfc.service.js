// server/src/services/nfc.service.js
// ============================================================================
// NFC Service — gestione token/tag per tavoli
// - generateToken(len): token base62 random (default 12)
// - getActiveByTable(tableId): se esiste token attivo, lo ritorna; altrimenti ne crea uno
// - bindTable(tableId, {forceNew}): forza rigenerazione (revoca i precedenti attivi) opzionale
// - resolveToken(token): ritorna mapping + info tavolo/room + reservation "odierna" se presente
// - revokeToken(token): set is_revoked=1 + revoked_at
// - buildPublicUrl(token, req): preferisce ENV.PUBLIC_BASE_URL, fall back da req
//
// Dipendenze: db (mysql2 pool), logger, config ENV
// NOTE ROBUSTEZZA:
//   - Mai più "rows[0]" su variabile indefinita: wrapper query() che normalizza SEMPRE l'array.
//   - Colonne allineate al tuo schema: tables.table_number (NON "number").
// ============================================================================

const crypto = require('crypto');
const dbMod  = require('../db');           // può esportare direttamente il pool o { pool }
const logger = require('../logger');       // winston (stile esistente)

const TABLE = 'nfc_tags';

// ————————————————————————————————————————————————————————————————————————————
// Helpers
// ————————————————————————————————————————————————————————————————————————————

/** Ritorna sempre il pool (compat: module → pool | { pool }) */
function getPool() {
  return dbMod?.pool || dbMod;
}

/** Esegue query normalizzando SEMPRE rows in Array */
async function query(sql, params = [], conn) {
  const runner = conn || getPool();
  try {
    const ret = await runner.query(sql, params);
    // mysql2/promise => [rows, fields] | alcuni wrapper => rows
    const rows = Array.isArray(ret?.[0]) ? ret[0] : (Array.isArray(ret) ? ret : []);
    return rows;
  } catch (err) {
    logger.error('❌ [NFC][SQL] Error', { sql, params, error: String(err) });
    throw err;
  }
}

function base62(bytes = 9) {
  // 9 bytes ~ 12 char base62
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const buf = crypto.randomBytes(bytes);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

function generateToken(len = 12) {
  // token base62 di lunghezza "len"
  let token = '';
  while (token.length < len) token += base62(9);
  return token.slice(0, len);
}

// ————————————————————————————————————————————————————————————————————————————
// Core queries
// ————————————————————————————————————————————————————————————————————————————

async function getActiveByTable(tableId) {
  const rows = await query(
    `SELECT id, table_id, token, is_revoked, created_at
       FROM ${TABLE}
      WHERE table_id = ? AND is_revoked = 0
      ORDER BY id DESC
      LIMIT 1`,
    [tableId]
  );
  return rows[0] || null; // ← sicuro: rows è sempre []
}

async function insertToken(tableId, token, conn) {
  await query(
    `INSERT INTO ${TABLE} (table_id, token, is_revoked, created_at)
     VALUES (?, ?, 0, NOW())`,
    [tableId, token],
    conn
  );
}

async function revokeByTable(tableId, conn) {
  await query(
    `UPDATE ${TABLE}
        SET is_revoked = 1, revoked_at = NOW()
      WHERE table_id = ? AND is_revoked = 0`,
    [tableId],
    conn
  );
}

// ————————————————————————————————————————————————————————————————————————————
// API publiche del servizio
// ————————————————————————————————————————————————————————————————————————————

async function bindTable(tableId, opts = {}) {
  // Se forceNew → revoca e crea nuovo; altrimenti riusa se esiste
  if (!tableId) throw new Error('table_id mancante');
  const { forceNew = false } = opts;

  if (!forceNew) {
    const current = await getActiveByTable(tableId);
    if (current) {
      logger.info(`🔗 [NFC] Token esistente per table_id=${tableId} → ${current.token}`);
      return current.token;
    }
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    if (forceNew) {
      logger.warn(`♻️ [NFC] Rigenerazione token per table_id=${tableId} (revoca precedenti)`);
      await revokeByTable(tableId, conn);
    }

    // Genera un token unico (retry se collisione su UNIQUE uk_nfc_token)
    let token = generateToken(12);
    let ok = false;

    for (let i = 0; i < 5 && !ok; i++) {
      try {
        await insertToken(tableId, token, conn);
        ok = true;
      } catch (err) {
        const msg = String(err?.message || '');
        if (msg.includes('uk_nfc_token') || msg.includes('Duplicate') || msg.includes('ER_DUP_ENTRY')) {
          token = generateToken(12); // collisione → rigenera
        } else {
          throw err;
        }
      }
    }

    if (!ok) throw new Error('Impossibile generare token univoco');

    logger.info(`✅ [NFC] Creato token ${token} per table_id=${tableId}`);
    return token;
  } finally {
    try { conn.release(); } catch {}
  }
}

async function resolveToken(token) {
  if (!token) throw new Error('token mancante');

  // 1) Trova mapping attivo + info tavolo/sala (schema allineato al tuo FE)
  const rows = await query(
    `SELECT n.table_id,
            n.is_revoked,
            t.table_number AS table_number,   -- 👈 allineato al tuo /api/tables
            t.room_id,
            r.name        AS room_name
       FROM ${TABLE} n
       JOIN tables t ON t.id = n.table_id
  LEFT JOIN rooms  r ON r.id = t.room_id
      WHERE n.token = ? AND n.is_revoked = 0
      LIMIT 1`,
    [token]
  );
  const m = rows[0];
  if (!m) return null;

  // 2) (Opzionale) Prenotazione "odierna" pending/accepted per quel tavolo
  //    DB in UTC (tua policy): finestra [UTC_DATE(), UTC_DATE()+1d)
  const resv = await query(
    `SELECT id
       FROM reservations
      WHERE table_id = ?
        AND status IN ('pending','accepted')
        AND start_at >= UTC_DATE()
        AND start_at <  (UTC_DATE() + INTERVAL 1 DAY)
      ORDER BY start_at ASC
      LIMIT 1`,
    [m.table_id]
  );

  const reservation_id = resv?.[0]?.id || null;

  return {
    ok: true,
    table_id: m.table_id,
    table_number: m.table_number,
    room_id: m.room_id,
    room_name: m.room_name,
    reservation_id
  };
}

async function revokeToken(token) {
  if (!token) throw new Error('token mancante');
  await query(
    `UPDATE ${TABLE}
        SET is_revoked = 1, revoked_at = NOW()
      WHERE token = ? AND is_revoked = 0`,
    [token]
  );
  return { ok: true };
}

function buildPublicUrl(token, req) {
  // Preferisci ENV.PUBLIC_BASE_URL (es. https://admin.miodominio.it)
  const base = process.env.PUBLIC_BASE_URL
    || `${req?.protocol || 'http'}://${req?.get ? req.get('host') : 'localhost:3000'}`;
  return `${String(base).replace(/\/+$/, '')}/t/${encodeURIComponent(token)}`;
}

module.exports = {
  generateToken,
  bindTable,
  resolveToken,
  revokeToken,
  getActiveByTable,
  buildPublicUrl,
};
