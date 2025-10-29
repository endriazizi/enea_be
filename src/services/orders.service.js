'use strict';

/**
 * services/orders.service.js
 *
 * Service unico per:
 *  - create ordine (testa + righe) con transazione se disponibile
 *  - list con filtri server-side (status/hours/from/to/q) - opzionali
 *  - getById con righe
 *  - updateStatus
 *
 * Obiettivo principale di questa revisione:
 *  - compatibilità schema: colonne {phone|customer_phone}, {email|customer_email}, {channel|source}
 *  - log con emoji e guardie sicure
 *  - SQL con placeholders
 */

const db     = require('../db');
const logger = require('../logger');

// Cache in-memory delle colonne della tabella orders/order_items
let _ordersCols = null;
let _orderItemsCols = null;

async function loadTableCols(table) {
  const rows = await db.query(`SHOW COLUMNS FROM \`${table}\``);
  const set = new Set(rows.map(r => String(r.Field)));
  return set;
}

async function getOrdersCols() {
  if (_ordersCols) return _ordersCols;
  try {
    _ordersCols = await loadTableCols('orders');
    logger.info('🧩 orders columns cache', { cols: Array.from(_ordersCols).join(',') });
  } catch (e) {
    logger.error('❌ SHOW COLUMNS orders', { error: String(e) });
    _ordersCols = new Set();
  }
  return _ordersCols;
}

async function getOrderItemsCols() {
  if (_orderItemsCols) return _orderItemsCols;
  try {
    _orderItemsCols = await loadTableCols('order_items');
    logger.info('🧩 order_items columns cache', { cols: Array.from(_orderItemsCols).join(',') });
  } catch (e) {
    logger.error('❌ SHOW COLUMNS order_items', { error: String(e) });
    _orderItemsCols = new Set();
  }
  return _orderItemsCols;
}

/** Utility tiny: numero o null */
function toNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/** Mappa DTO in base alle colonne disponibili */
async function mapInsertHead(dto) {
  const cols = await getOrdersCols();

  // colonne alternative
  const phoneCol  = cols.has('phone')  ? 'phone'  : (cols.has('customer_phone')  ? 'customer_phone'  : null);
  const emailCol  = cols.has('email')  ? 'email'  : (cols.has('customer_email')  ? 'customer_email'  : null);
  const chanCol   = cols.has('channel')? 'channel': (cols.has('source')          ? 'source'          : null);
  const peopleCol = cols.has('people') ? 'people' : null;
  const schedCol  = cols.has('scheduled_at') ? 'scheduled_at' : null;
  const noteCol   = cols.has('note')   ? 'note'   : null;
  const totalCol  = cols.has('total')  ? 'total'  : null;
  const nameCol   = cols.has('customer_name') ? 'customer_name' : null;
  const statusCol = cols.has('status') ? 'status' : null;

  if (!nameCol) throw new Error('orders.customer_name mancante nello schema');

  // prepara colonne/valori effettive
  const columns = [nameCol];
  const values  = [String(dto.customer_name || '').trim() || ''];

  if (phoneCol)  { columns.push(phoneCol);   values.push(String(dto.phone || '').trim() || null); }
  if (emailCol)  { columns.push(emailCol);   values.push(String(dto.email || '').trim() || null); }
  if (peopleCol) { columns.push(peopleCol);  values.push(toNumber(dto.people) ?? 1); }
  if (schedCol)  { columns.push(schedCol);   values.push(dto.scheduled_at || null); }
  if (noteCol)   { columns.push(noteCol);    values.push(dto.note || null); }
  if (chanCol)   { columns.push(chanCol);    values.push((dto.channel || 'online').toString()); }
  if (statusCol) { columns.push(statusCol);  values.push((dto.status || 'pending').toString()); }
  if (totalCol)  { columns.push(totalCol);   values.push(0); } // lo aggiorniamo dopo dalle righe

  return { columns, values, phoneCol, emailCol, chanCol, totalCol, nameCol };
}

async function create(dto = {}) {
  // Items validati: [{ name, qty, price, product_id?, notes? }]
  const items = Array.isArray(dto.items) ? dto.items : [];
  if (!items.length) throw new Error('empty_items');

  let conn = null;
  try {
    // transazione se disponibile
    if (typeof db.getConnection === 'function') {
      conn = await db.getConnection();
      await conn.beginTransaction();
      logger.info('🔒 TX BEGIN (orders.create)');
    }

    const head = await mapInsertHead(dto);
    const colsSql = head.columns.map(c => `\`${c}\``).join(',');
    const qm      = head.columns.map(() => '?').join(',');

    const sqlIns = `INSERT INTO orders (${colsSql}) VALUES (${qm})`;
    const exec   = conn ? conn.execute.bind(conn) : db.pool.execute.bind(db.pool);

    const [res] = await exec(sqlIns, head.values);
    const orderId = res.insertId;

    // Inserisci le righe
    const itemCols = await getOrderItemsCols();
    const hasPid   = itemCols.has('product_id');
    const hasNotes = itemCols.has('notes');

    const sqlItem = `
      INSERT INTO order_items (order_id, ${hasPid ? 'product_id,' : ''} name, qty, price ${hasNotes ? ', notes' : ''})
      VALUES ${items.map(() => `(?${hasPid ? ',?' : ''}, ?, ?, ?${hasNotes ? ', ?' : ''})`).join(',')}
    `;

    const params = [];
    let total = 0;
    for (const it of items) {
      const qty = toNumber(it.qty) ?? 1;
      const price = Number(it.price) || 0;
      total += qty * price;

      params.push(
        orderId,
        ...(hasPid ? [toNumber(it.product_id)] : []),
        String(it.name || '').trim(),
        qty,
        price,
        ...(hasNotes ? [it.notes || null] : [])
      );
    }

    await exec(sqlItem, params);

    // aggiorna totale (se colonna esiste)
    if (head.totalCol) {
      await exec(`UPDATE orders SET \`${head.totalCol}\`=? WHERE id=?`, [total, orderId]);
    }

    // Commit/No-TX
    if (conn) {
      await conn.commit();
      logger.info('🔒 TX COMMIT (orders.create)', { id: orderId });
    }

    // Ritorna l’ordine completo
    const out = await getById(orderId);
    return out;

  } catch (err) {
    if (conn) {
      try { await conn.rollback(); logger.warn('🔒 TX ROLLBACK (orders.create)'); } catch {}
    }
    logger.error('❌ Orders.create', { error: String(err) });
    throw err;
  } finally {
    if (conn) { try { conn.release(); } catch {} }
  }
}

async function getById(id) {
  const head = await db.query(
    `SELECT * FROM orders WHERE id = ?`,
    [id]
  );
  const row = head[0];
  if (!row) return null;

  const items = await db.query(
    `SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC`,
    [id]
  );
  row.items = items;
  return row;
}

function buildFilterSql(cols, f = {}) {
  // preferenza from/to rispetto a hours
  const where = [];
  const args  = [];

  // status
  if (f.status && f.status !== 'all') {
    where.push('`status` = ?');
    args.push(String(f.status));
  }

  // hours (fallback se non ci sono from/to)
  if (!f.from && !f.to && f.hours) {
    where.push('`created_at` >= (NOW() - INTERVAL ? HOUR)');
    args.push(toNumber(f.hours) ?? 6);
  }

  // from/to (usa date intere; to → +1 giorno, semplice)
  if (f.from) {
    where.push('`created_at` >= ?');
    args.push(String(f.from).slice(0, 19)); // YYYY-MM-DD[ HH:mm:ss]
  }
  if (f.to) {
    where.push('`created_at` < DATE_ADD(?, INTERVAL 1 DAY)');
    args.push(String(f.to).slice(0, 10));
  }

  // q su customer_name | note
  if (f.q) {
    where.push('(customer_name LIKE ? OR note LIKE ?)');
    const like = `%${String(f.q)}%`;
    args.push(like, like);
  }

  const sqlWhere = where.length ? ('WHERE ' + where.join(' AND ')) : '';
  return { sqlWhere, args };
}

async function list(filter = {}) {
  const cols = await getOrdersCols();
  const { sqlWhere, args } = buildFilterSql(cols, filter);

  const rows = await db.query(
    `
    SELECT *
    FROM orders
    ${sqlWhere}
    ORDER BY created_at DESC
    LIMIT 500
    `,
    args
  );
  return rows;
}

async function updateStatus(id, status) {
  const s = String(status || '').toLowerCase();
  if (!s) throw new Error('missing_status');

  await db.query(`UPDATE orders SET status=? WHERE id=?`, [s, id]);
  const out = await getById(id);
  return out;
}

module.exports = {
  create,
  getById,
  list,
  updateStatus
};
