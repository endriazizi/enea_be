// src/services/reservations.service.js 
// ============================================================================
// Service “Reservations” — query DB per prenotazioni
// Stile: commenti lunghi, log con emoji, diagnostica chiara.
// NOTA: questo è un *service module* (esporta funzioni). La tua API/Router
//       /api/reservations importerà da qui.
// - 🆕 checkIn / checkOut idempotenti (persistono checkin_at / checkout_at / dwell_sec)
// - 🆕 assignReservationTable (usato dai sockets) + changeTable alias
// ============================================================================

'use strict';

const { query } = require('../db');
const logger = require('../logger');
const env    = require('../env');
const google = require('./google.service');

// --- Helpers -----------------------------------------------------------------
function trimOrNull(s) { const v = (s ?? '').toString().trim(); return v ? v : null; }
function toDayRange(fromYmd, toYmd) {
  const out = { from: null, to: null };
  if (fromYmd) out.from = `${fromYmd} 00:00:00`;
  if (toYmd)   out.to   = `${toYmd} 23:59:59`;
  return out;
}

/**
 * 🕒 FIX TZ: DB è in CET (system_time_zone = CET).
 * Converte qualunque input in stringa MySQL DATETIME "YYYY-MM-DD HH:mm:ss"
 * in ORA LOCALE (CET/Europe/Rome) — NON più UTC.
 *
 * - Se start_at è già "YYYY-MM-DD HH:mm:ss" (senza Z/offset) → salva così com'è.
 * - Se contiene 'Z' o offset (+/-) → converti a ORA LOCALE CET e serializza.
 */
function isoToMysql(iso) {
  if (!iso) return null;
  if (iso instanceof Date) return dateToMysqlLocal(iso);
  const s = String(iso).trim();

  // Già "YYYY-MM-DD HH:mm:ss" (ora locale) → salva così
  const mysqlLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (mysqlLike.test(s)) return s;

  // Ha 'Z' o offset (+/-) → NON salvare diretto: converti a CET
  const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
  if (hasOffset) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return dateToMysqlLocalCET(d);
  }

  // "YYYY-MM-DDTHH:mm" (senza Z) → Date interpreta come locale, ok
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return dateToMysqlLocal(d);

  return s.replace('T', ' ').slice(0, 19);
}

/**
 * Date → "YYYY-MM-DD HH:mm:ss" in ORA LOCALE del server (getHours, getMonth, ecc.)
 */
function dateToMysqlLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

/**
 * Date → "YYYY-MM-DD HH:mm:ss" in Europe/Rome (CET).
 * Usato quando il payload contiene ISO con Z o offset.
 */
function dateToMysqlLocalCET(d) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const pad = (n) => String(n).padStart(2, '0');
  const y = parts.find((p) => p.type === 'year').value;
  const m = pad(parts.find((p) => p.type === 'month').value);
  const day = pad(parts.find((p) => p.type === 'day').value);
  const hh = pad(parts.find((p) => p.type === 'hour').value);
  const mm = pad(parts.find((p) => p.type === 'minute').value);
  const ss = pad(parts.find((p) => p.type === 'second').value);
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

/**
 * Calcola start_at / end_at a partire da una stringa di input (tipicamente
 * "YYYY-MM-DDTHH:mm" dalla tua admin PWA) e applica le regole pranzo/cena.
 *
 * - L'input viene interpretato come ORA LOCALE del ristorante.
 * - Decidiamo se è pranzo o cena guardando l'ora locale (<16 ⇒ pranzo).
 * - Poi convertiamo sia start che end in UTC per salvarli in DB.
 */
function computeEndAtFromStart(startAtIso) {
  if (!startAtIso) throw new Error('startAtIso mancante per computeEndAtFromStart');

  const raw = String(startAtIso).trim();
  let localStart = null;

  // Caso 1: "YYYY-MM-DD HH:mm[:ss]" (già con spazio)
  const spaceLike = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/;
  const spaceMatch = raw.match(spaceLike);
  if (spaceMatch) {
    const [, datePart, hhStr, mmStr, ssStr] = spaceMatch;
    const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10));
    const hh = parseInt(hhStr, 10);
    const mm = parseInt(mmStr, 10);
    const ss = ssStr ? parseInt(ssStr, 10) : 0;
    localStart = new Date(y, m - 1, d, hh, mm, ss);
  } else {
    // Caso 2: qualunque ISO gestito da Date ("YYYY-MM-DDTHH:mm" o ISO con Z).
    localStart = new Date(raw);
  }

  if (Number.isNaN(localStart.getTime())) {
    throw new Error(`startAtIso non valido: ${startAtIso}`);
  }

  // Regola pranzo/cena basata sull'ORA LOCALE (getHours).
  const addMin = (localStart.getHours() < 16
    ? (env.RESV?.defaultLunchMinutes || 90)
    : (env.RESV?.defaultDinnerMinutes || 120));

  const localEnd = new Date(localStart.getTime() + addMin * 60 * 1000);

  return {
    startMysql: dateToMysqlLocal(localStart),
    endMysql  : dateToMysqlLocal(localEnd),
  };
}

// ============================================================================
// ⚙️ Cambio stato basico (compat): accetta azione o stato
// ============================================================================

function normalizeStatusAction(actionOrStatus) {
  if (!actionOrStatus) return { nextStatus: null, note: null };
  const s = String(actionOrStatus).toLowerCase();
  if (s === 'accept' || s === 'accepted') return { nextStatus: 'accepted', note: null };
  if (s === 'reject' || s === 'rejected' || s === 'cancel' || s === 'cancelled' || s === 'canceled') {
    return { nextStatus: 'cancelled', note: null };
  }
  return { nextStatus: s, note: null };
}

// ============================================================================
// 📋 LIST / GET
// ============================================================================

async function list({ status, from, to, q } = {}) {
  const where = [];
  const params = [];

  if (status && status !== 'all') {
    where.push('r.status = ?');
    params.push(status);
  }

  const qNorm = trimOrNull(q);
  if (qNorm) {
    const raw = qNorm;
    const clean = raw.replace(/\s+/g, ' ').trim();
    const tokens = clean.split(' ').filter(Boolean);

    // Caso rapido: #123 oppure solo numeri → match ID diretto
    const idCandidate = clean.replace(/^#/, '');
    if (/^\d+$/.test(idCandidate)) {
      where.push('r.id = ?');
      params.push(Number(idCandidate));
    }

    // Per ogni token costruisco un OR "ampio" e lo metto in AND
    for (const t of tokens) {
      const like = `%${t}%`;
      const tDigits = t.replace(/\D+/g, '');
      const likeDigits = tDigits ? `%${tDigits}%` : null;
      where.push(
        '(' +
        'r.customer_first COLLATE utf8mb4_unicode_ci LIKE ? OR ' +
        'r.customer_last COLLATE utf8mb4_unicode_ci LIKE ? OR ' +
        "CONCAT_WS(' ', r.customer_first, r.customer_last) COLLATE utf8mb4_unicode_ci LIKE ? OR " +
        'r.phone COLLATE utf8mb4_unicode_ci LIKE ? OR ' +
        'r.email COLLATE utf8mb4_unicode_ci LIKE ? OR ' +
        'r.notes COLLATE utf8mb4_unicode_ci LIKE ? OR ' +
        'r.status_note COLLATE utf8mb4_unicode_ci LIKE ? OR ' +
        't.table_number LIKE ?' +
        (likeDigits ? ' OR REPLACE(REPLACE(REPLACE(REPLACE(r.phone, " ", ""), "+", ""), "-", ""), "/", "") LIKE ?' : '') +
        ')'
      );
      if (likeDigits) {
        params.push(like, like, like, like, like, like, like, like, likeDigits);
      } else {
        params.push(like, like, like, like, like, like, like, like);
      }
    }
  }

  const range = toDayRange(from, to);
  if (range.from) { where.push('r.start_at >= ?'); params.push(range.from); }
  if (range.to)   { where.push('r.start_at <= ?'); params.push(range.to);   }

  // 🧭 FIX TZ: DATE_FORMAT forza output "YYYY-MM-DD HH:mm:ss" (no UTC ISO)
  const sql = `
    SELECT
      r.id,
      r.customer_first,
      r.customer_last,
      r.phone,
      r.email,
      r.user_id,
      r.party_size,
      DATE_FORMAT(r.start_at, '%Y-%m-%d %H:%i:%s') AS start_at,
      DATE_FORMAT(r.end_at, '%Y-%m-%d %H:%i:%s') AS end_at,
      r.room_id,
      r.notes,
      r.status,
      r.created_by,
      r.updated_by,
      r.status_note,
      r.status_changed_at,
      r.client_token,
      r.table_id,
      DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
      DATE_FORMAT(r.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
      DATE_FORMAT(r.checkin_at, '%Y-%m-%d %H:%i:%s') AS checkin_at,
      DATE_FORMAT(r.checkout_at, '%Y-%m-%d %H:%i:%s') AS checkout_at,
      r.dwell_sec,
      u.first_name   AS user_first_name,
      u.last_name    AS user_last_name,
      u.email        AS user_email,
      t.table_number,
      CONCAT('Tavolo ', t.table_number) AS table_name
    FROM reservations r
    LEFT JOIN users  u ON u.id = r.user_id
    LEFT JOIN tables t ON t.id = r.table_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.start_at ASC, r.id ASC
  `;
  const rows = await query(sql, params);
  return rows;
}

async function getById(id) {
  // 🧭 FIX TZ: DATE_FORMAT forza output "YYYY-MM-DD HH:mm:ss" (no UTC ISO)
  const sql = `
    SELECT
      r.id,
      r.customer_first,
      r.customer_last,
      r.phone,
      r.email,
      r.user_id,
      r.party_size,
      DATE_FORMAT(r.start_at, '%Y-%m-%d %H:%i:%s') AS start_at,
      DATE_FORMAT(r.end_at, '%Y-%m-%d %H:%i:%s') AS end_at,
      r.room_id,
      r.notes,
      r.status,
      r.created_by,
      r.updated_by,
      r.status_note,
      r.status_changed_at,
      r.client_token,
      r.table_id,
      DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
      DATE_FORMAT(r.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
      DATE_FORMAT(r.checkin_at, '%Y-%m-%d %H:%i:%s') AS checkin_at,
      DATE_FORMAT(r.checkout_at, '%Y-%m-%d %H:%i:%s') AS checkout_at,
      r.dwell_sec,
      u.first_name   AS user_first_name,
      u.last_name    AS user_last_name,
      u.email        AS user_email,
      t.table_number,
      CONCAT('Tavolo ', t.table_number) AS table_name
    FROM reservations r
    LEFT JOIN users  u ON u.id = r.user_id
    LEFT JOIN tables t ON t.id = r.table_id
    WHERE r.id = ?
    LIMIT 1`;
  const rows = await query(sql, [id]); return rows[0] || null;
}

async function ensureUser({ first, last, email, phone }) {
  const e = trimOrNull(email), p = trimOrNull(phone);
  if (e) {
    const r = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [e]);
    if (r.length) return r[0].id;
  }
  if (p) {
    const r = await query('SELECT id FROM users WHERE phone = ? LIMIT 1', [p]);
    if (r.length) return r[0].id;
  }
  const res = await query(
    `INSERT INTO users (first_name, last_name, email, phone)
     VALUES (?, ?, ?, ?)`,
    [trimOrNull(first), trimOrNull(last), e, p]
  );
  return res.insertId;
}

async function updateUserById(id, { first, last, email, phone }) {
  if (!id) return;
  const fields = [];
  const params = [];

  if (first !== undefined && first !== null) { fields.push('first_name=?'); params.push(trimOrNull(first)); }
  if (last  !== undefined && last  !== null) { fields.push('last_name=?');  params.push(trimOrNull(last)); }
  if (email !== undefined && email !== null) { fields.push('email=?');      params.push(trimOrNull(email)); }
  if (phone !== undefined && phone !== null) { fields.push('phone=?');      params.push(trimOrNull(phone)); }

  if (!fields.length) return;
  params.push(id);
  await query(`UPDATE users SET ${fields.join(', ')} WHERE id=?`, params);
}

async function loadUserForGoogle(userId, dto) {
  if (!userId) return null;
  const rows = await query(
    `SELECT
       id,
       first_name,
       last_name,
       full_name,
       name,
       email,
       phone,
       note,
       google_resource_name,
       google_etag
     FROM users
     WHERE id = ? LIMIT 1`,
    [userId],
  );
  const user = rows && rows[0] ? rows[0] : null;
  if (!user) return null;

  return {
    ...user,
    first_name: trimOrNull(dto.customer_first) || user.first_name,
    last_name: trimOrNull(dto.customer_last) || user.last_name,
    email: trimOrNull(dto.email) || user.email,
    phone: trimOrNull(dto.phone) || user.phone,
    note: trimOrNull(dto.google_note) || trimOrNull(dto.notes) || user.note,
  };
}

async function upsertGoogleContactForUser(userId, dto) {
  if (!userId) return;
  try {
    const user = await loadUserForGoogle(userId, dto);
    if (!user) return;
    await google.upsertContactFromUser(user);
  } catch (e) {
    logger.warn('👤⚠️ [Google] upsert failed', { error: String(e), userId });
  }
}

// ============================================================================
// ➕ CREATE
// ============================================================================

async function create(dto, { user } = {}) {
  const userId = await ensureUser({
    first: dto.customer_first,
    last : dto.customer_last,
    email: dto.email,
    phone: dto.phone,
  });

  const noteValue = trimOrNull(dto.google_note) || trimOrNull(dto.notes);
  const startIso = dto.start_at;
  const endIso   = dto.end_at || null;

  const { startMysql, endMysql } = endIso
    ? { startMysql: isoToMysql(startIso), endMysql: isoToMysql(endIso) }
    : computeEndAtFromStart(startIso);

  // 🧭 TZ DEBUG: diagnostica fuso orario prenotazioni
  logger.info('🧭 TZ DEBUG', {
    received: startIso,
    normalized: startMysql,
    newDateReceived: startIso ? new Date(startIso).toString() : null,
    toISOString: startIso ? new Date(startIso).toISOString() : null,
    serverTZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const res = await query(
    `INSERT INTO reservations
      (customer_first, customer_last, phone, email,
       user_id, party_size, start_at, end_at, room_id, table_id,
       notes, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
    [
      trimOrNull(dto.customer_first), trimOrNull(dto.customer_last),
      trimOrNull(dto.phone), trimOrNull(dto.email),
      userId, Number(dto.party_size) || 1, startMysql, endMysql,
      dto.room_id || null, dto.table_id || null,
      noteValue, trimOrNull(user?.email) || null
    ]);
  const created = await getById(res.insertId);
  logger.info('🆕 reservation created', { id: created.id, by: user?.email || null });

  // Best-effort sync: upsert contatto Google
  await upsertGoogleContactForUser(userId, dto);

  return created;
}

// ============================================================================
// ✏️ UPDATE
// ============================================================================

async function update(id, dto, { user } = {}) {
  let userId = null;
  if (dto.customer_first !== undefined || dto.customer_last !== undefined
    || dto.email !== undefined || dto.phone !== undefined) {
    userId = await ensureUser({
      first: dto.customer_first,
      last : dto.customer_last,
      email: dto.email,
      phone: dto.phone,
    });
  }
  let startMysql = null, endMysql = null;
  if (dto.start_at) {
    const endIso = dto.end_at || null;
    const c = endIso
      ? { startMysql: isoToMysql(dto.start_at), endMysql: isoToMysql(endIso) }
      : computeEndAtFromStart(dto.start_at);
    startMysql = c.startMysql; endMysql = c.endMysql;

    logger.info('🧭 TZ DEBUG', {
      received: dto.start_at,
      normalized: startMysql,
      newDateReceived: new Date(dto.start_at).toString(),
      toISOString: new Date(dto.start_at).toISOString(),
      serverTZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }
  const fields = [], pr = [];
  if (userId !== null) { fields.push('user_id=?'); pr.push(userId); }
  if (dto.customer_first !== undefined) { fields.push('customer_first=?'); pr.push(trimOrNull(dto.customer_first)); }
  if (dto.customer_last  !== undefined) { fields.push('customer_last=?');  pr.push(trimOrNull(dto.customer_last));  }
  if (dto.phone          !== undefined) { fields.push('phone=?');          pr.push(trimOrNull(dto.phone));          }
  if (dto.email          !== undefined) { fields.push('email=?');          pr.push(trimOrNull(dto.email));          }
  if (dto.party_size     !== undefined) { fields.push('party_size=?');     pr.push(dto.party_size || 1);           }
  if (startMysql         !== null)      { fields.push('start_at=?');       pr.push(startMysql);                    }
  if (endMysql           !== null)      { fields.push('end_at=?');         pr.push(endMysql);                      }
  if (dto.room_id  !== undefined) { fields.push('room_id=?');  pr.push(dto.room_id || null); }
  if (dto.table_id !== undefined) { fields.push('table_id=?'); pr.push(dto.table_id || null); }
  if (dto.notes !== undefined || dto.google_note !== undefined) {
    fields.push('notes=?');
    pr.push(trimOrNull(dto.google_note) || trimOrNull(dto.notes));
  }
  if (dto.checkin_at  !== undefined) {
    fields.push('checkin_at=?');
    pr.push(dto.checkin_at ? isoToMysql(dto.checkin_at) : null);
  }
  if (dto.checkout_at !== undefined) {
    fields.push('checkout_at=?');
    pr.push(dto.checkout_at ? isoToMysql(dto.checkout_at) : null);
  }
  if (dto.dwell_sec   !== undefined) {
    fields.push('dwell_sec=?');
    pr.push(dto.dwell_sec == null ? null : Number(dto.dwell_sec));
  }
  fields.push('updated_by=?'); pr.push(trimOrNull(user?.email) || null);

  if (!fields.length) {
    logger.info('✏️ update: nessun campo da aggiornare', { id });
    return await getById(id);
  }
  pr.push(id);
  await query(`UPDATE reservations SET ${fields.join(', ')} WHERE id=?`, pr);
  const updated = await getById(id);
  logger.info('✏️ reservation updated', { id, by: user?.email || null });
  await upsertGoogleContactForUser(updated?.user_id || userId, dto);
  return updated;
}

// ============================================================================
// 🗑️ DELETE (hard, con policy) – invariato
// ============================================================================

async function remove(id, { user, reason } = {}) {
  const existing = await getById(id);
  if (!existing) return false;
  const allowAnyByEnv =
    (env.RESV && env.RESV.allowDeleteAnyStatus === true) ||
    (String(process.env.RESV_ALLOW_DELETE_ANY_STATUS || '').toLowerCase() === 'true');
  const statusNorm = String(existing.status || '').toLowerCase();
  const isCancelled = (statusNorm === 'cancelled' || statusNorm === 'canceled');
  if (!allowAnyByEnv && !isCancelled) {
    logger.warn('🛡️ hard-delete NEGATO (stato non cancellato)', { id, status: existing.status }); return false;
  }
  await query('DELETE FROM reservations WHERE id=? LIMIT 1', [id]);
  logger.info('🗑️ reservation removed', { id, by: user?.email || null, reason: reason || null });
  return true;
}

// ============================================================================
// 📊 COUNT BY STATUS
// ============================================================================

async function countByStatus({ from, to } = {}) {
  const where = [];
  const params = [];
  const range = toDayRange(from, to);
  if (range.from) { where.push('r.start_at >= ?'); params.push(range.from); }
  if (range.to)   { where.push('r.start_at <= ?'); params.push(range.to);   }
  const sql = `
    SELECT r.status, COUNT(*) AS count
    FROM reservations r
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY r.status
  `;
  const rows = await query(sql, params);
  const out = { pending: 0, accepted: 0, cancelled: 0 };
  for (const r of rows) {
    const s = String(r.status || '').toLowerCase();
    if (s === 'pending') out.pending = r.count;
    else if (s === 'accepted') out.accepted = r.count;
    else if (s === 'cancelled' || s === 'canceled') out.cancelled = r.count;
  }
  return out;
}

// ============================================================================
// 📚 ROOMS / TABLES
// ============================================================================

async function listRooms() {
  const sql = `
    SELECT id, name, description
    FROM rooms
    WHERE is_active = 1
    ORDER BY sort_order ASC, id ASC
  `;
  return await query(sql, []);
}

async function listTablesByRoom(roomId) {
  const sql = `
    SELECT id, room_id, table_number, capacity, is_active
    FROM tables
    WHERE room_id = ?
    ORDER BY table_number ASC, id ASC
  `;
  return await query(sql, [roomId]);
}

// ============================================================================
// 🪑 Assegnazione tavolo
// ============================================================================

async function assignReservationTable(id, tableId, { user } = {}) {
  await query(
    `UPDATE reservations
        SET table_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? LIMIT 1`,
    [tableId || null, trimOrNull(user?.email) || null, id]
  );
  const updated = await getById(id);
  logger.info('🪑 reservation table assigned', { id, table_id: tableId, by: user?.email || null });
  return updated;
}

// Alias più leggibile lato chiamante
const changeTable = assignReservationTable;

// ============================================================================
// ✅ Cambio stato “semplice” (non usa state-machine avanzata)
// ============================================================================

async function updateStatus(id, actionOrStatus, { user } = {}) {
  const existing = await getById(id);
  if (!existing) return null;
  const { nextStatus } = normalizeStatusAction(actionOrStatus);
  if (!nextStatus) {
    logger.warn('⚠️ updateStatus: stato non valido', { id, actionOrStatus });
    return existing;
  }
  await query(
    `UPDATE reservations
        SET status = ?, status_changed_at = CURRENT_TIMESTAMP, updated_by = ?
      WHERE id = ? LIMIT 1`,
    [nextStatus, trimOrNull(user?.email) || null, id]
  );
  const updated = await getById(id);
  logger.info('🔁 reservation status updated', {
    id,
    from: existing.status,
    to  : updated.status,
    by  : user?.email || null
  });
  return updated;
}

// ============================================================================
// 🕒 Check-in / Check-out
// ============================================================================

async function checkIn(id, { at, user } = {}) {
  const existing = await getById(id);
  if (!existing) return null;

  const checkin_at_mysql = isoToMysql(at || new Date()) || null;

  await query(
    `UPDATE reservations
        SET checkin_at = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
      WHERE id = ? LIMIT 1`,
    [checkin_at_mysql, trimOrNull(user?.email) || null, id]
  );

  const updated = await getById(id);
  logger.info('✅ reservation check-in', {
    id,
    at     : updated.checkin_at,
    by     : user?.email || null,
    status : updated.status,
  });
  return updated;
}

async function checkOut(id, { at, user } = {}) {
  const existing = await getById(id);
  if (!existing) return null;

  // Orario di checkout: se non passo nulla → adesso
  const checkoutDate = at ? new Date(at) : new Date();
  const checkout_at_mysql = isoToMysql(checkoutDate) || null;

  // dwell_sec (in secondi) se ho un checkin_at valido
  let dwell_sec = null;
  if (existing.checkin_at) {
    const startMs = new Date(existing.checkin_at).getTime();
    const endMs   = checkoutDate.getTime();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
      dwell_sec = Math.max(0, Math.floor((endMs - startMs) / 1000));
    }
  }

  // Costruisco SQL + parametri mantenendo il tuo stile
  const params = [checkout_at_mysql, trimOrNull(user?.email) || null];
  let SQL = `
    UPDATE reservations
       SET checkout_at = ?,
           updated_at  = CURRENT_TIMESTAMP,
           updated_by  = ?`;

  if (dwell_sec !== null) {
    SQL += `,
           dwell_sec   = ?`;
    params.push(dwell_sec);
  }

  SQL += `
     WHERE id = ? LIMIT 1`;
  params.push(id);

  await query(SQL, params);

  const updated = await getById(id);
  logger.info('✅ reservation check-out', {
    id,
    at     : updated.checkout_at,
    dwell  : updated.dwell_sec,
    by     : user?.email || null,
    status : updated.status,
  });
  return updated;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  list,
  getById,
  create,
  update,
  updateStatus,
  remove,
  countByStatus,
  listRooms,
  listTablesByRoom,
  // 🆕
  assignReservationTable,
  changeTable,
  checkIn,
  checkOut,
};
