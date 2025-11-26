'use strict';

// src/services/nfc.service.js
// ============================================================================
// NFC Service — token/tag per tavoli + "Sessione Tavolo"
// - generateToken / bindTable / revokeToken
// - resolveToken(token): prima verifica su nfc_tags, poi JOIN per meta tavolo
// - sessione tavolo (table_sessions)
// - 🧲 closeSessionById: chiusura sessione per id (API /api/nfc/session/:id/close)
// Stile: commenti lunghi + log con emoji
// ============================================================================

const crypto = require('crypto');
const { query } = require('../db'); // wrapper mysql2
const logger = require('../logger');

const TABLE = 'nfc_tags';
const TABLE_TS = 'table_sessions';

// ----------------------------- utils ----------------------------------------
function base62(bytes = 9) {
  const alphabet =
    '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const buf = crypto.randomBytes(bytes);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}
function generateToken(len = 12) {
  let token = '';
  while (token.length < len) token += base62(9);
  return token.slice(0, len);
}

// --------------------------- token <-> tavolo --------------------------------
async function getActiveByTable(tableId) {
  const rows = await query(
    `SELECT id, table_id, token, is_revoked, created_at
       FROM ${TABLE}
      WHERE table_id=? AND is_revoked=0
   ORDER BY id DESC
      LIMIT 1`,
    [tableId],
  );
  return rows[0] || null;
}

async function insertToken(tableId, token) {
  await query(
    `INSERT INTO ${TABLE} (table_id, token, is_revoked) VALUES (?, ?, 0)`,
    [tableId, token],
  );
  return token;
}

async function revokeByTable(tableId) {
  await query(
    `UPDATE ${TABLE}
        SET is_revoked=1, revoked_at=NOW()
      WHERE table_id=? AND is_revoked=0`,
    [tableId],
  );
}

async function bindTable(tableId, opts = {}) {
  if (!tableId) throw new Error('table_id mancante');
  const { forceNew = false } = opts;

  if (!forceNew) {
    const current = await getActiveByTable(tableId);
    if (current) {
      logger.info(
        `🔗 [NFC] Token esistente per table_id=${tableId} → ${current.token}`,
      );
      return current.token;
    }
  }
  if (forceNew) {
    logger.warn(
      `♻️ [NFC] Rigenerazione token per table_id=${tableId} (revoca precedenti)`,
    );
    await revokeByTable(tableId);
  }

  let token = generateToken(12);
  for (let i = 0; i < 5; i++) {
    try {
      await insertToken(tableId, token);
      return token;
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('ER_DUP_ENTRY')) {
        token = generateToken(12);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Impossibile generare token univoco');
}

async function revokeToken(token) {
  if (!token) throw new Error('token mancante');
  await query(
    `UPDATE ${TABLE}
        SET is_revoked=1, revoked_at=NOW()
      WHERE token=? AND is_revoked=0`,
    [token],
  );
  return { ok: true };
}

function buildPublicUrl(token, req) {
  const base =
    process.env.PUBLIC_BASE_URL ||
    `${req?.protocol || 'http'}://${
      req?.get ? req.get('host') : 'localhost:3000'
    }`;
  return `${base.replace(/\/+$/, '')}/t/${encodeURIComponent(token)}`;
}

// ---------------------------- sessione tavolo --------------------------------
async function getActiveSession(tableId) {
  const rows = await query(
    `SELECT id, table_id, opened_at, opened_by
       FROM ${TABLE_TS}
      WHERE table_id=? AND closed_at IS NULL
   ORDER BY id DESC
      LIMIT 1`,
    [tableId],
  );
  return rows?.[0] || null;
}
async function openSession(tableId, { by, note } = {}) {
  const res = await query(
    `INSERT INTO ${TABLE_TS} (table_id, opened_by, note) VALUES (?,?,?)`,
    [tableId, by || null, note || null],
  );
  const id = res?.insertId || null;
  logger.info(
    `🟢 [NFC] Sessione APERTA table_id=${tableId} (session_id=${id})`,
  );
  return id;
}
async function closeActiveSession(tableId, { by, reason } = {}) {
  const act = await getActiveSession(tableId);
  if (!act) return { closed: 0 };
  await query(
    `UPDATE ${TABLE_TS}
        SET closed_at = NOW(), closed_by = ?
      WHERE id = ? AND closed_at IS NULL`,
    [by || reason || null, act.id],
  );
  logger.info(
    `🔴 [NFC] Sessione CHIUSA table_id=${tableId} (session_id=${act.id})`,
  );
  return { closed: 1, session_id: act.id };
}

/**
 * 🧲 closeSessionById
 * ----------------------------------------------------------------------------
 * Chiusura sessione per ID (usato da API tipo: PUT /api/nfc/session/:id/close).
 * - Non richiede il table_id a chiamata
 * - È best-effort: se la sessione è già chiusa, non lancia errore.
 */
async function closeSessionById(sessionId, { by, reason } = {}) {
  if (!sessionId) throw new Error('session_id mancante');

  const rows = await query(
    `SELECT id, table_id, opened_at, closed_at
       FROM ${TABLE_TS}
      WHERE id = ?
      LIMIT 1`,
    [sessionId],
  );
  const s = rows?.[0];
  if (!s) {
    logger.warn('🧲 [NFC] closeSessionById: sessione non trovata', {
      session_id: sessionId,
    });
    return { closed: 0 };
  }

  if (s.closed_at) {
    logger.info('🧲 [NFC] closeSessionById: sessione già chiusa', {
      session_id: sessionId,
      table_id: s.table_id,
    });
    return { closed: 0, session_id: s.id, already_closed: true };
  }

  await query(
    `UPDATE ${TABLE_TS}
        SET closed_at = NOW(), closed_by = ?
      WHERE id = ? AND closed_at IS NULL`,
    [by || reason || null, sessionId],
  );

  logger.info('🔴 [NFC] Sessione CHIUSA (by id)', {
    session_id: sessionId,
    table_id: s.table_id,
  });

  return { closed: 1, session_id: sessionId, table_id: s.table_id };
}

async function ensureSession(tableId, { ttlHours = 6, by } = {}) {
  const act = await getActiveSession(tableId);
  if (act) {
    if (!ttlHours) return act.id;
    const ageMs = Date.now() - new Date(act.opened_at).getTime();
    if (ageMs <= ttlHours * 3_600_000) return act.id;
    await closeActiveSession(tableId, { by: 'ensureSession:ttl' });
  }
  return await openSession(tableId, { by });
}

// ------------------------------ resolve --------------------------------------
async function resolveToken(token) {
  if (!token) throw new Error('token mancante');

  // 1) esiste in nfc_tags (non revocato)?
  const tag = (
    await query(
      `SELECT id, table_id
       FROM ${TABLE}
      WHERE token = ? AND is_revoked = 0
      LIMIT 1`,
      [token],
    )
  )?.[0];

  logger.info('🔎 [NFC] resolve.check', {
    token,
    found: !!tag,
    table_id: tag?.table_id,
  });

  if (!tag) return null; // ← 404 not_found_or_revoked

  // 2) meta tavolo (JOIN) — usa table_number
  const meta =
    (
      await query(
        `SELECT t.table_number, t.room_id, r.name AS room_name
       FROM tables t
  LEFT JOIN rooms  r ON r.id = t.room_id
      WHERE t.id = ?
      LIMIT 1`,
        [tag.table_id],
      )
    )?.[0] || {};

  // 3) prenotazione odierna
  const resv =
    (
      await query(
        `SELECT id FROM reservations
      WHERE table_id = ?
        AND status IN ('pending','accepted')
        AND start_at >= UTC_DATE()
        AND start_at <  (UTC_DATE() + INTERVAL 1 DAY)
      ORDER BY start_at ASC
      LIMIT 1`,
        [tag.table_id],
      )
    )?.[0] || null;

  // 4) assicura sessione
  // check whether this table is enabled for sessions
  const stateRow = (
    await query(
      `SELECT enabled FROM nfc_table_state WHERE table_id = ? LIMIT 1`,
      [tag.table_id],
    )
  )?.[0];
  const enabled = stateRow ? Number(stateRow.enabled || 0) === 1 : true;

  if (!enabled) {
    logger.info('🔒 [NFC] token resolved but table disabled', { token, table_id: tag.table_id });
    return {
      ok: false,
      disabled: true,
      table_id: tag.table_id,
      table_number: meta.table_number ?? null,
      room_id: meta.room_id ?? null,
      room_name: meta.room_name ?? null,
    };
  }

  const session_id = await ensureSession(tag.table_id, {
    ttlHours: 6,
    by: 'nfc/resolve',
  });

  return {
    ok: true,
    table_id: tag.table_id,
    table_number: meta.table_number ?? null,
    room_id: meta.room_id ?? null,
    room_name: meta.room_name ?? null,
    reservation_id: resv?.id ?? null,
    session_id,
  };
}

// ------------------------------ cart snapshot --------------------------------
async function getSessionCart(sessionId) {
  if (!sessionId) throw new Error('session_id mancante');
  const s =
    (
      await query(
        `SELECT id, closed_at, cart_json, cart_version, cart_updated_at
       FROM ${TABLE_TS}
      WHERE id=? LIMIT 1`,
        [sessionId],
      )
    )?.[0];
  if (!s) return null;
  return {
    id: s.id,
    is_open: !s.closed_at,
    version: Number(s.cart_version || 0),
    cart_json: s.cart_json || null,
    cart_updated_at: s.cart_updated_at || null,
  };
}
async function saveSessionCart(sessionId, version, cartObj) {
  if (!sessionId) throw new Error('session_id mancante');
  const cartJson = cartObj ? JSON.stringify(cartObj) : null;
  const res = await query(
    `UPDATE ${TABLE_TS}
        SET cart_json = ?, cart_version = cart_version + 1, cart_updated_at = NOW()
      WHERE id = ? AND closed_at IS NULL AND cart_version = ?`,
    [cartJson, sessionId, Number(version || 0)],
  );
  if (Number(res?.affectedRows || 0) === 1) {
    const cur = await getSessionCart(sessionId);
    return {
      ok: true,
      version: cur?.version ?? 0,
      updated_at: cur?.cart_updated_at ?? null,
    };
  }
  const current = await getSessionCart(sessionId);
  const err = new Error('version_conflict');
  err.status = 409;
  err.current = current;
  throw err;
}

// ------------------------------- exports -------------------------------------
module.exports = {
  // Token
  generateToken,
  getActiveByTable,
  bindTable,
  revokeToken,
  resolveToken,
  buildPublicUrl,
  // Sessione
  getActiveSession,
  openSession,
  closeActiveSession,
  closeSessionById,
  ensureSession,
  // Cart
  getSessionCart,
  saveSessionCart,
};
