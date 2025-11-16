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

// --- Helpers -----------------------------------------------------------------
function trimOrNull(s) { const v = (s ?? '').toString().trim(); return v ? v : null; }
function toDayRange(fromYmd, toYmd) {
  const out = { from: null, to: null };
  if (fromYmd) out.from = `${fromYmd} 00:00:00`;
  if (toYmd)   out.to   = `${toYmd} 23:59:59`;
  return out;
}

/**
 * Converte qualunque input (stringa ISO, Date, oppure 'YYYY-MM-DD HH:mm:ss'
 * locale) in una stringa MySQL DATETIME "YYYY-MM-DD HH:mm:ss" in **UTC**.
 *
 * Pipeline che vogliamo:
 * - Il FE lavora in ORA LOCALE (Europe/Rome nel tuo caso).
 *   (logica gemella di toUTCFromLocalDateTimeInput sul FE: src/app/shared/utils.date.ts).
 * - Quando manda al BE valori tipo "2025-11-15T19:00" o "2025-11-15 19:00:00",
 *   qui li interpretiamo come locali e li convertiamo in UTC.
 * - Il DB è configurato con time_zone = '+00:00', quindi il DATETIME salvato
 *   è già UTC e quando lo rileggiamo/serializziamo va verso il FE come ISO con 'Z'.
 */
function isoToMysql(iso) {
  if (!iso) return null;
  if (iso instanceof Date) return dateToMysqlUtc(iso);
  const s = String(iso).trim();

  // Se è già nel formato MySQL "YYYY-MM-DD HH:mm:ss" lo tratto come ORA LOCALE
  // del ristorante e lo porto in UTC.
  const mysqlLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (mysqlLike.test(s)) {
    const [datePart, timePart] = s.split(' ');
    const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10));
    const [hh, mm, ss] = timePart.split(':').map((n) => parseInt(n, 10));
    const local = new Date(y, m - 1, d, hh, mm, ss); // 👉 locale
    if (!Number.isNaN(local.getTime())) return dateToMysqlUtc(local);
  }

  // Per tutto il resto ("YYYY-MM-DDTHH:mm", ISO con 'Z', ecc.) lascio che il
  // costruttore Date si arrangi. Se è senza 'Z' verrà interpretato come locale,
  // se ha 'Z' è già UTC.
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return dateToMysqlUtc(d);

  // Fallback compat per formati strani: mantengo il tuo vecchio comportamento.
  return s.replace('T', ' ').slice(0, 19);
}

/**
 * Helper interno: Date → stringa MySQL DATETIME in UTC.
 */
function dateToMysqlUtc(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
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
    startMysql: dateToMysqlUtc(localStart),
    endMysql  : dateToMysqlUtc(localEnd),
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

async function list({ status, from, to } = {}) {
  const where = [];
  const params = [];

  if (status && status !== 'all') {
    where.push('r.status = ?');
    params.push(status);
  }

  const range = toDayRange(from, to);
  if (range.from) { where.push('r.start_at >= ?'); params.push(range.from); }
  if (range.to)   { where.push('r.start_at <= ?'); params.push(range.to);   }

  const sql = `
    SELECT
      r.id,
      r.customer_first,
      r.customer_last,
      r.phone,
      r.email,
      r.user_id,
      r.party_size,
      r.start_at,
      r.end_at,
      r.room_id,
      r.notes,
      r.status,
      r.created_by,
      r.updated_by,
      r.status_note,
      r.status_changed_at,
      r.client_token,
      r.table_id,
      r.created_at,
      r.updated_at,
      r.checkin_at,
      r.checkout_at,
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
  const sql = `
    SELECT
      r.id,
      r.customer_first,
      r.customer_last,
      r.phone,
      r.email,
      r.user_id,
      r.party_size,
      r.start_at,
      r.end_at,
      r.room_id,
      r.notes,
      r.status,
      r.created_by,
      r.updated_by,
      r.status_note,
      r.status_changed_at,
      r.client_token,
      r.table_id,
      r.created_at,
      r.updated_at,
      r.checkin_at,
      r.checkout_at,
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

  const startIso = dto.start_at;
  const endIso   = dto.end_at || null;

  const { startMysql, endMysql } = endIso
    ? { startMysql: isoToMysql(startIso), endMysql: isoToMysql(endIso) }
    : computeEndAtFromStart(startIso);

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
      trimOrNull(dto.notes), trimOrNull(user?.email) || null
    ]);
  const created = await getById(res.insertId);
  logger.info('🆕 reservation created', { id: created.id, by: user?.email || null });
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
  if (dto.notes    !== undefined) { fields.push('notes=?');    pr.push(trimOrNull(dto.notes)); }
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

  const checkout_at_mysql = isoToMysql(at || new Date()) || null;

  // dwell_sec se ho checkin_at
  let dwell_sec = null;
  if (r.checkin_at) {
    const start = new Date(r.checkin_at).getTime();
    const end   = checkout_at_mysql ? new Date(at).getTime() : Date.now();
    dwell_sec   = Math.max(0, Math.floor((end - start) / 1000));
  }
  const params = [ user?.email || null, id ];
  const SQL = `
    UPDATE reservations
       SET checkout_at = ${checkout_at_mysql ? '?' : 'CURRENT_TIMESTAMP'},
           dwell_sec   = ${dwell_sec === null ? 'dwell_sec' : '?'},
           updated_at  = CURRENT_TIMESTAMP,
           updated_by  = ?
     WHERE id = ? LIMIT 1`;
  const pr = checkout_at_mysql
    ? (dwell_sec === null ? [checkout_at_mysql, ...params] : [checkout_at_mysql, dwell_sec, ...params])
    : (dwell_sec === null ? params : [dwell_sec, ...params]);
  await query(SQL, pr);

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
