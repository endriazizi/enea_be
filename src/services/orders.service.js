'use strict';

/**
 * services/orders.service.js
 * Query SQL per gli ordini — stile simile a reservations.service.js
 */

const { query } = require('../db');
const logger    = require('../logger');

// Stati ammessi (in FE li usi tutti)
const ALLOWED = new Set(['pending','confirmed','preparing','ready','completed','cancelled']);

function toMoney(n) {
  const v = Number(n || 0);
  return Math.round(v * 100) / 100;
}

// -------------------------- LISTE --------------------------------------------
async function listHeaders() {
  const sql = `
    SELECT id, customer_name, phone, email, people, scheduled_at, note,
           channel, status, total, created_at, updated_at
    FROM orders
    ORDER BY id DESC
  `;
  return await query(sql, []);
}

async function listFull() {
  const headers = await listHeaders();
  if (!headers.length) return [];
  const ids = headers.map(r => r.id);
  const items = await query(
    `SELECT * FROM order_items WHERE order_id IN (${ids.map(()=>'?').join(',')}) ORDER BY id ASC`,
    ids
  );
  const byOrder = new Map();
  for (const h of headers) byOrder.set(h.id, { ...h, items: [] });
  for (const it of items) byOrder.get(it.order_id)?.items.push(it);
  return Array.from(byOrder.values());
}

async function listByStatus(status) {
  const sql = `
    SELECT id, customer_name, phone, email, people, scheduled_at, note,
           channel, status, total, created_at, updated_at
    FROM orders
    WHERE status = ?
    ORDER BY id DESC
  `;
  return await query(sql, [status]);
}

async function listLastHours(hours = 24) {
  const sql = `
    SELECT id, customer_name, phone, email, people, scheduled_at, note,
           channel, status, total, created_at, updated_at
    FROM orders
    WHERE created_at >= (NOW() - INTERVAL ? HOUR)
    ORDER BY id DESC
  `;
  return await query(sql, [Number(hours || 24)]);
}

// -------------------------- CREATE -------------------------------------------
async function create(payload) {
  const p = payload || {};
  const items = Array.isArray(p.items) ? p.items : [];

  if (!p.customer_name || !items.length) {
    throw new Error('customer_name e almeno 1 item sono obbligatori');
  }

  // totale
  const total = toMoney(items.reduce((s, it) => s + (Number(it.price || 0) * Number(it.qty || 1)), 0));

  const res = await query(
    `INSERT INTO orders
     (customer_name, phone, email, people, scheduled_at, note, channel, status, total)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      String(p.customer_name),
      p.phone || null,
      p.email || null,
      Number(p.people || 1),
      p.scheduled_at || null,
      p.note || null,
      (p.channel || 'online'),
      'pending',
      total
    ]
  );

  const orderId = res.insertId;

  for (const it of items) {
    await query(
      `INSERT INTO order_items (order_id, product_id, name, qty, price, notes)
       VALUES (?,?,?,?,?,?)`,
      [
        orderId,
        it.product_id || null,
        it.name,
        Number(it.qty || 1),
        toMoney(it.price || 0),
        it.notes || null
      ]
    );
  }

  logger.info('🆕 order created', { id: orderId, total });

  // ritorna header + righe
  const header = (await query('SELECT * FROM orders WHERE id=? LIMIT 1', [orderId]))[0];
  const lines  = await query('SELECT * FROM order_items WHERE order_id=? ORDER BY id ASC', [orderId]);
  return { ...header, items: lines };
}

// -------------------------- STATUS -------------------------------------------
async function setStatus(id, status) {
  if (!ALLOWED.has(String(status))) throw new Error('status non valido');
  const sql = `UPDATE orders SET status=?, updated_at=NOW() WHERE id=? LIMIT 1`;
  const r = await query(sql, [status, Number(id)]);
  if (!r.affectedRows) throw new Error('ordine non trovato');
  logger.info('✏️ order status updated', { id, status });
}

module.exports = {
  listHeaders,
  listFull,
  listByStatus,
  listLastHours,
  create,
  setStatus,
};
