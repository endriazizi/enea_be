// Service “Reservations” — query DB per prenotazioni
// Stile: commenti lunghi, log con emoji, diagnostica chiara.

'use strict';

const { query } = require('../db');
const logger = require('../logger');
const env    = require('../env');

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
function isoToMysql(iso) {
  if (!iso) return null;
  return iso.replace('T', ' ').slice(0, 19);
}
function computeEndAtFromStart(startAtIso) {
  const start = new Date(startAtIso);
  const addMin = (start.getHours() < 16
    ? (env.RESV?.defaultLunchMinutes || 90)
    : (env.RESV?.defaultDinnerMinutes || 120)
  );
  const end = new Date(start.getTime() + addMin * 60 * 1000);

  const pad = (n) => String(n).padStart(2, '0');
  const mysql = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

  return { startMysql: mysql(start), endMysql: mysql(end) };
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

  const res = await query(
    `INSERT INTO users (first_name, last_name, email, phone) VALUES (?, ?, ?, ?)`,
    [trimOrNull(first), trimOrNull(last), e, p]
  );
  return res.insertId;
}

// --- Core queries -------------------------------------------------------------
async function list(filter = {}) {
  const wh = [];
  const pr = [];

  if (filter.status) { wh.push('r.status = ?'); pr.push(String(filter.status)); }

  const { from, to } = toDayRange(filter.from, filter.to);
  if (from) { wh.push('r.start_at >= ?'); pr.push(from); }
  if (to)   { wh.push('r.start_at <= ?'); pr.push(to);   }

  if (filter.q) {
    const q = `%${String(filter.q).trim()}%`;
    wh.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR r.customer_first LIKE ? OR r.customer_last LIKE ? OR r.email LIKE ? OR r.phone LIKE ?)');
    pr.push(q, q, q, q, q, q, q, q);
  }

  const where = wh.length ? ('WHERE ' + wh.join(' AND ')) : '';
  const sql = `
    SELECT
      r.*,
      CONCAT_WS(' ', u.first_name, u.last_name) AS display_name,
      u.email  AS contact_email,
      u.phone  AS contact_phone,
      t.table_number,
      CONCAT('Tavolo ', t.table_number) AS table_name
    FROM reservations r
    LEFT JOIN users  u ON u.id = r.user_id
    LEFT JOIN tables t ON t.id = r.table_id
    ${where}
    ORDER BY r.start_at ASC, r.id ASC
  `;

  const rows = await query(sql, pr);
  return rows;
}

async function getById(id) {
  const sql = `
    SELECT
      r.*,
      CONCAT_WS(' ', u.first_name, u.last_name) AS display_name,
      u.email  AS contact_email,
      u.phone  AS contact_phone,
      t.table_number,
      CONCAT('Tavolo ', t.table_number) AS table_name
    FROM reservations r
    LEFT JOIN users  u ON u.id = r.user_id
    LEFT JOIN tables t ON t.id = r.table_id
    WHERE r.id = ?
    LIMIT 1
  `;
  const rows = await query(sql, [id]);
  return rows[0] || null;
}

async function create(dto, { user } = {}) {
  const userId = await ensureUser({
    first: dto.customer_first,
    last : dto.customer_last,
    email: dto.email,
    phone: dto.phone
  });

  const startIso = dto.start_at;
  const endIso   = dto.end_at || null;
  const { startMysql, endMysql } =
    endIso ? { startMysql: isoToMysql(startIso), endMysql: isoToMysql(endIso) }
           : computeEndAtFromStart(startIso);

  // room_id, created_by presenti (strada B)
  const res = await query(
    `INSERT INTO reservations
      (customer_first, customer_last, phone, email,
       user_id, party_size, start_at, end_at, room_id, table_id,
       notes, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
    [
      trimOrNull(dto.customer_first),
      trimOrNull(dto.customer_last),
      trimOrNull(dto.phone),
      trimOrNull(dto.email),
      userId,
      Number(dto.party_size) || 1,
      startMysql,
      endMysql,
      dto.room_id || null,
      dto.table_id || null,
      trimOrNull(dto.notes),
      trimOrNull(user?.email) || null
    ]
  );

  const created = await getById(res.insertId);
  logger.info('🆕 reservation created', { id: created.id, by: user?.email || null });
  return created;
}

async function update(id, dto, { user } = {}) {
  let userId = null;
  if (dto.customer_first !== undefined || dto.customer_last !== undefined || dto.email !== undefined || dto.phone !== undefined) {
    userId = await ensureUser({
      first: dto.customer_first,
      last : dto.customer_last,
      email: dto.email,
      phone: dto.phone
    });
  }

  let startMysql = null, endMysql = null;
  if (dto.start_at) {
    const endIso = dto.end_at || null;
    const c = endIso ? { startMysql: isoToMysql(dto.start_at), endMysql: isoToMysql(endIso) }
                     : computeEndAtFromStart(dto.start_at);
    startMysql = c.startMysql;
    endMysql   = c.endMysql;
  }

  const fields = [];
  const pr = [];

  if (userId !== null) { fields.push('user_id=?'); pr.push(userId); }
  if (dto.customer_first !== undefined) { fields.push('customer_first=?'); pr.push(trimOrNull(dto.customer_first)); }
  if (dto.customer_last  !== undefined) { fields.push('customer_last=?');  pr.push(trimOrNull(dto.customer_last));  }
  if (dto.phone          !== undefined) { fields.push('phone=?');          pr.push(trimOrNull(dto.phone));          }
  if (dto.email          !== undefined) { fields.push('email=?');          pr.push(trimOrNull(dto.email));          }

  if (dto.party_size !== undefined) { fields.push('party_size=?'); pr.push(Number(dto.party_size)||1); }
  if (startMysql) { fields.push('start_at=?'); pr.push(startMysql); }
  if (endMysql)   { fields.push('end_at=?');   pr.push(endMysql);   }

  if (dto.room_id  !== undefined) { fields.push('room_id=?');  pr.push(dto.room_id || null); }
  if (dto.table_id !== undefined) { fields.push('table_id=?'); pr.push(dto.table_id || null); }
  if (dto.notes    !== undefined) { fields.push('notes=?');    pr.push(trimOrNull(dto.notes)); }

  // updated_by
  fields.push('updated_by=?'); pr.push(trimOrNull(user?.email) || null);

  if (!fields.length) {
    logger.info('✏️ update: nessun campo da aggiornare', { id });
    return await getById(id);
  }

  pr.push(id);
  const sql = `UPDATE reservations SET ${fields.join(', ')} WHERE id=?`;
  await query(sql, pr);

  const updated = await getById(id);
  logger.info('✏️ reservation updated', { id, by: user?.email || null });
  return updated;
}

// --- Hard delete con policy ---------------------------------------------------
async function remove(id, { user, reason } = {}) {
  const existing = await getById(id);
  if (!existing) return false;

  const allowAnyByEnv =
    (env.RESV && env.RESV.allowDeleteAnyStatus === true) ||
    (String(process.env.RESV_ALLOW_DELETE_ANY_STATUS || '').toLowerCase() === 'true');

  const isCancelled = String(existing.status || '').toLowerCase() === 'cancelled';

  if (!allowAnyByEnv && !isCancelled) {
    logger.warn('🛡️ hard-delete NEGATO (stato non cancellato)', { id, status: existing.status });
    return false;
  }

  const res = await query('DELETE FROM reservations WHERE id=? LIMIT 1', [id]);
  const ok  = res.affectedRows > 0;

  if (ok) {
    logger.info('🗑️ reservation hard-deleted', { id, by: user?.email || null, reason: reason || null });
  } else {
    logger.error('💥 reservation delete KO', { id });
  }
  return ok;
}

// --- Supporto UI --------------------------------------------------------------
async function countByStatus({ from, to }) {
  const w = [];
  const p = [];

  const r = toDayRange(from, to);
  if (r.from) { w.push('start_at >= ?'); p.push(r.from); }
  if (r.to)   { w.push('start_at <= ?'); p.push(r.to);   }

  const where = w.length ? ('WHERE ' + w.join(' AND ')) : '';

  const rows = await query(
    `SELECT status, COUNT(*) AS count FROM reservations ${where} GROUP BY status`,
    p
  );

  const out = {};
  for (const r of rows) out[String(r.status)] = Number(r.count);
  return out;
}

// --- Sale / Tavoli (supporto UI) ---------------------------------------------
async function listRooms() {
  const sql = `
    SELECT id, name
    FROM rooms
    WHERE IFNULL(is_active,1)=1
    ORDER BY (sort_order IS NULL), sort_order, name
  `;
  return await query(sql, []);
}

async function listTablesByRoom(roomId) {
  const sql = `
    SELECT
      t.id,
      t.room_id,
      t.table_number,
      t.seats,
      CONCAT('Tavolo ', t.table_number) AS name
    FROM tables t
    WHERE t.room_id = ?
    ORDER BY t.table_number ASC, t.id ASC
  `;
  return await query(sql, [roomId]);
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  countByStatus,
  listRooms,
  listTablesByRoom,
};
