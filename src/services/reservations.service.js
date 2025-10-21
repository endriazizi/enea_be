// src/services/reservations.service.js
// Service “Reservations” — query DB per prenotazioni
// Stile: commenti lunghi, log con emoji, diagnostica chiara.

const { query } = require('../db');
const logger = require('../logger');
const env = require('../env');

// --- Helpers -----------------------------------------------------------------
function trimOrNull(s) {
  const v = (s ?? '').toString().trim();
  return v ? v : null;
}
function toDayRange(fromYmd, toYmd) {
  const out = { from: null, to: null };
  if (fromYmd) out.from = `${fromYmd} 00:00:00`;
  if (toYmd)   out.to   = `${toYmd} 23:59:59`;
  return out;
}
function computeEndAtFromStart(startAtIso) {
  const start = new Date(startAtIso);
  const addMin = (start.getHours() < 16
    ? env.RESV.defaultLunchMinutes
    : env.RESV.defaultDinnerMinutes
  );
  const end = new Date(start.getTime() + addMin * 60 * 1000);

  const pad = (n) => String(n).padStart(2, '0');
  const mysqlStart = `${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(start.getDate())} ${pad(start.getHours())}:${pad(start.getMinutes())}:00`;
  const mysqlEnd   = `${end.getFullYear()}-${pad(end.getMonth()+1)}-${pad(end.getDate())} ${pad(end.getHours())}:${pad(end.getMinutes())}:00`;
  return { startMysql: mysqlStart, endMysql: mysqlEnd };
}

// ensureUser: trova/crea utente e ritorna id (unique su email/phone)
async function ensureUser({ first, last, email, phone }) {
  const e = trimOrNull(email);
  const p = trimOrNull(phone);

  if (e) {
    const r = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [e]);
    if (r.length) return r[0].id;
  }
  if (p) {
    const r = await query('SELECT id FROM users WHERE phone = ? LIMIT 1', [p]);
    if (r.length) return r[0].id;
  }

  const res = await query(`
    INSERT INTO users (first_name, last_name, email, phone)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      first_name = COALESCE(VALUES(first_name), first_name),
      last_name  = COALESCE(VALUES(last_name),  last_name),
      id = LAST_INSERT_ID(id)
  `, [trimOrNull(first), trimOrNull(last), e, p]);

  return res.insertId || res[0]?.insertId;
}

// --- LIST --------------------------------------------------------------------
async function list(filter = {}) {
  const where = ['1=1'];
  const params = [];

  const { from, to } = toDayRange(filter.from, filter.to);
  if (from) { where.push('r.start_at >= ?'); params.push(from); }
  if (to)   { where.push('r.start_at <= ?'); params.push(to); }

  if (filter.status && filter.status !== 'all') {
    where.push('r.status = ?'); params.push(String(filter.status));
  }
  if (filter.q) {
    const q = `%${String(filter.q).trim()}%`;
    where.push(`(
      u.first_name  LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?
      OR r.customer_first LIKE ? OR r.customer_last LIKE ? OR r.email LIKE ? OR r.phone LIKE ?
    )`);
    params.push(q, q, q, q, q, q, q, q);
  }

  const sql = `
    SELECT
      r.*,
      t.table_number AS table_number,
      t.room_id      AS room_id,
      CONCAT('Tavolo ', IFNULL(CAST(t.table_number AS CHAR), CHAR(63))) AS table_name,
      u.id          AS u_id,
      u.first_name  AS u_first_name,
      u.last_name   AS u_last_name,
      u.email       AS u_email,
      u.phone       AS u_phone,
      TRIM(CONCAT_WS(' ',
        COALESCE(NULLIF(u.first_name,''), NULLIF(r.customer_first,'')),
        COALESCE(NULLIF(u.last_name,''),  NULLIF(r.customer_last,''))
      )) AS display_name,
      COALESCE(NULLIF(u.phone,''),  NULLIF(r.phone,''))  AS contact_phone,
      COALESCE(NULLIF(u.email,''),  NULLIF(r.email,''))  AS contact_email
    FROM reservations r
    LEFT JOIN users  u ON u.id = r.user_id
    LEFT JOIN tables t ON t.id = r.table_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.start_at DESC, r.id DESC
  `;

  logger.info('📥 RESV list ▶️', { where, params, service: 'server' });
  return await query(sql, params);
}

// --- GET BY ID ---------------------------------------------------------------
async function getById(id) {
  const sql = `
    SELECT
      r.*,
      t.table_number AS table_number,
      t.room_id      AS room_id,
      CONCAT('Tavolo ', IFNULL(CAST(t.table_number AS CHAR), CHAR(63))) AS table_name,
      u.id          AS u_id,
      u.first_name  AS u_first_name,
      u.last_name   AS u_last_name,
      u.email       AS u_email,
      u.phone       AS u_phone,
      TRIM(CONCAT_WS(' ',
        COALESCE(NULLIF(u.first_name,''), NULLIF(r.customer_first,'')),
        COALESCE(NULLIF(u.last_name,''),  NULLIF(r.customer_last,''))
      )) AS display_name,
      COALESCE(NULLIF(u.phone,''),  NULLIF(r.phone,''))  AS contact_phone,
      COALESCE(NULLIF(u.email,''),  NULLIF(r.email,''))  AS contact_email
    FROM reservations r
    LEFT JOIN users  u ON u.id = r.user_id
    LEFT JOIN tables t ON t.id = r.table_id
    WHERE r.id = ?
    LIMIT 1
  `;
  const rows = await query(sql, [id]);
  return rows[0] || null;
}

// --- CREATE ------------------------------------------------------------------
async function create(dto) {
  const {
    customer_first = null,
    customer_last  = null,
    phone          = null,
    email          = null,
    party_size,
    start_at,
    end_at   = null,
    notes    = null,
    table_id = null,
    client_token = null,
  } = dto || {};

  if (!party_size || !start_at) throw new Error('party_size e start_at sono obbligatori');

  const userId = await ensureUser({ first: customer_first, last: customer_last, email, phone });

  const { startMysql, endMysql } = computeEndAtFromStart(start_at);
  const insertEnd = end_at ? end_at : endMysql;

  const sql = `
    INSERT INTO reservations
      (user_id, customer_first, customer_last, phone, email, party_size,
       start_at, end_at, notes, status, client_token, table_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `;
  const params = [
    userId,
    trimOrNull(customer_first),
    trimOrNull(customer_last),
    trimOrNull(phone),
    trimOrNull(email),
    Number(party_size) || 1,
    startMysql,
    insertEnd,
    trimOrNull(notes),
    client_token,
    table_id || null
  ];

  const res = await query(sql, params);
  const id = res.insertId || res[0]?.insertId;

  const created = await getById(id);
  logger.info('✅ RESV create', { id, user_id: userId, service: 'server' });
  return created;
}

// --- UPDATE (PATCH) ----------------------------------------------------------
async function update(id, dto = {}) {
  const existing = await getById(id);
  if (!existing) { const e = new Error('not_found'); e.statusCode = 404; throw e; }

  // Se cambiano dati anagrafici, ricalcolo user_id coerente
  let newUserId = null;
  const anagChanged =
    dto.customer_first !== undefined ||
    dto.customer_last  !== undefined ||
    dto.email          !== undefined ||
    dto.phone          !== undefined;

  if (anagChanged) {
    newUserId = await ensureUser({
      first: dto.customer_first ?? existing.customer_first,
      last : dto.customer_last  ?? existing.customer_last,
      email: dto.email          ?? existing.email,
      phone: dto.phone          ?? existing.phone,
    });
  }

  // Ricalcolo start/end se arriva un nuovo start_at
  let startMysql = null, endMysql = null;
  if (dto.start_at) {
    const t = computeEndAtFromStart(dto.start_at);
    startMysql = t.startMysql;
    endMysql   = dto.end_at ? dto.end_at : t.endMysql;
  } else if (dto.end_at) {
    endMysql = dto.end_at;
  }

  const set = [];
  const params = [];
  const push = (expr, val) => { set.push(expr); params.push(val); };

  if (newUserId !== null)               push('user_id = ?', newUserId);
  if (dto.customer_first !== undefined) push('customer_first = ?', trimOrNull(dto.customer_first));
  if (dto.customer_last  !== undefined) push('customer_last  = ?', trimOrNull(dto.customer_last));
  if (dto.phone          !== undefined) push('phone          = ?', trimOrNull(dto.phone));
  if (dto.email          !== undefined) push('email          = ?', trimOrNull(dto.email));
  if (dto.party_size     !== undefined) push('party_size     = ?', Number(dto.party_size) || 1);
  if (startMysql         !== null)      push('start_at       = ?', startMysql);
  if (endMysql           !== null)      push('end_at         = ?', endMysql);
  if (dto.notes          !== undefined) push('notes          = ?', trimOrNull(dto.notes));
  if (dto.table_id       !== undefined) push('table_id       = ?', dto.table_id || null);
  // NB: status NON qui → usare svc azioni stato

  if (!set.length) {
    logger.info('ℹ️ RESV update: nessun campo cambiato', { id });
    return existing;
  }

  const sql = `UPDATE reservations SET ${set.join(', ')} WHERE id = ? LIMIT 1`;
  params.push(id);
  await query(sql, params);
  logger.info('✏️ RESV update', { id, set: set.length });
  return await getById(id);
}

// --- DELETE ------------------------------------------------------------------
async function remove(id) {
  const res = await query('DELETE FROM reservations WHERE id = ? LIMIT 1', [id]);
  logger.warn('🗑️ RESV delete', { id, affected: res.affectedRows || res[0]?.affectedRows || 0 });
  return { ok: true };
}

// --- ROOMS/TABLES/COUNT ------------------------------------------------------
async function listRooms() {
  return await query(
    'SELECT id, name, is_active, sort_order FROM rooms ORDER BY sort_order ASC, id ASC', []
  );
}
async function listTablesByRoom(roomId) {
  return await query(
    'SELECT id, room_id, table_number, seats AS capacity, status FROM tables WHERE room_id = ? ORDER BY table_number ASC, id ASC',
    [roomId]
  );
}
async function countByStatus(filter = {}) {
  const where = ['1=1']; const params = [];
  const { from, to } = toDayRange(filter.from, filter.to);
  if (from) { where.push('r.start_at >= ?'); params.push(from); }
  if (to)   { where.push('r.start_at <= ?'); params.push(to); }
  const sql = `
    SELECT r.status, COUNT(*) AS n
    FROM reservations r
    WHERE ${where.join(' AND ')}
    GROUP BY r.status
  `;
  const rows = await query(sql, params);
  const out = { pending: 0, accepted: 0, rejected: 0, cancelled: 0, total: 0 };
  for (const r of rows) { const s = String(r.status), n = Number(r.n||0); if (s in out) out[s]=n; out.total += n; }
  return out;
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  listRooms,
  listTablesByRoom,
  countByStatus,
};
