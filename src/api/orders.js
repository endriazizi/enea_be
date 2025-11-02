// src/api/orders.js
// ============================================================================
// ORDERS API (root = /api/orders)
// - GET    /                lista (hours | from/to | status | q)
// - GET    /:id(\d+)        dettaglio full con items
// - POST   /                crea ordine (header + items) → 201 + full
// - PATCH  /:id(\d+)/status cambio stato
// - POST   /:id(\d+)/print  stampa Pizzeria/Cucina (best-effort)
// - GET    /stream          SSE (montato qui)
// Stile: commenti lunghi, log con emoji
// ============================================================================
'use strict';

const express = require('express');
const router  = express.Router();
const logger  = require('../logger');
const { query } = require('../db');
const sse     = require('../sse');
const { printOrderDual } = require('../utils/print-order');

// Monta subito l’endpoint SSE (/api/orders/stream)
sse.mount(router);

// Helpers ---------------------------------------------------------------------
const toNum = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const toDate = (v) => v ? new Date(v) : null;

async function getOrderFullById(id) {
  const [o] = await query(
    `SELECT id, customer_name, phone, email, people, scheduled_at, status,
            total, channel, note, created_at, updated_at
     FROM orders WHERE id=?`, [id]
  );
  if (!o) return null;

  const items = await query(
    `SELECT i.id, i.order_id, i.product_id, i.name, i.qty, i.price, i.notes, i.created_at,
            COALESCE(c.name,'Altro') AS category
     FROM order_items i
     LEFT JOIN products p ON p.id = i.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE i.order_id=?
     ORDER BY i.id ASC`, [id] // <-- fix 'p.category' mancante
  );

  return { ...o, items };
}

// ROUTES ----------------------------------------------------------------------

// Lista
router.get('/', async (req, res) => {
  try {
    const { hours, from, to, status, q } = req.query;
    const conds = [];
    const params = [];

    if (hours) { conds.push(`created_at >= (UTC_TIMESTAMP() - INTERVAL ? HOUR)`); params.push(toNum(hours)); }
    if (from)  { conds.push(`created_at >= ?`); params.push(new Date(from)); }
    if (to)    { conds.push(`created_at <= ?`); params.push(new Date(to)); }
    if (status && status !== 'all') { conds.push(`status = ?`); params.push(status); }
    if (q)     { conds.push(`(customer_name LIKE ? OR phone LIKE ?)`); params.push(`%${q}%`, `%${q}%`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await query(
      `SELECT id, customer_name, phone, email, people, scheduled_at, status,
              total, channel, note, created_at, updated_at
       FROM orders
       ${where}
       ORDER BY id DESC
       LIMIT 300`, params
    );
    res.json(rows);
  } catch (e) {
    logger.error('📄 orders list ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_list_error' });
  }
});

// Dettaglio
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const full = await getOrderFullById(id);
    if (!full) return res.status(404).json({ error: 'not_found' });
    res.json(full);
  } catch (e) {
    logger.error('📄 orders get ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_get_error' });
  }
});

// Crea
router.post('/', async (req, res) => {
  const dto = req.body || {};
  try {
    const scheduled = dto.scheduled_at ? toDate(dto.scheduled_at) : null;
    const items = Array.isArray(dto.items) ? dto.items : [];
    const total = items.reduce((acc, it) => acc + toNum(it.price) * toNum(it.qty, 1), 0);

    const r = await query(
      `INSERT INTO orders (customer_name, phone, email, people, scheduled_at, note, channel, status, total)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        (dto.customer_name || 'Cliente').toString().trim(),
        dto.phone || null,
        dto.email || null,
        dto.people || null,
        scheduled,
        dto.note || null,
        dto.channel || 'admin',
        'pending',
        total
      ]
    );
    const orderId = r.insertId;

    for (const it of items) {
      await query(
        `INSERT INTO order_items (order_id, product_id, name, qty, price, notes)
         VALUES (?,?,?,?,?,?)`,
        [ orderId, (it.product_id ?? null), it.name, toNum(it.qty,1), toNum(it.price), (it.notes ?? null) ]
      );
    }

    const full = await getOrderFullById(orderId);
    // Notifica SSE best-effort
    try { sse.emitCreated(full); } catch (e) { logger.warn('🧵 SSE created ⚠️', { e: String(e) }); }

    res.status(201).json(full);
  } catch (e) {
    logger.error('🆕 orders create ❌', { reason: String(e) });
    res.status(500).json({ ok: false, error: 'orders_create_error', reason: String(e) });
  }
});

// Cambio stato
router.patch('/:id(\\d+)/status', async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const status = String(req.body?.status || '').toLowerCase();
    const allowed = new Set(['pending','confirmed','preparing','ready','completed','cancelled']);
    if (!allowed.has(status)) return res.status(400).json({ error: 'invalid_status' });

    await query(`UPDATE orders SET status=?, updated_at=UTC_TIMESTAMP() WHERE id=?`, [status, id]);
    // Notifica SSE best-effort
    try { sse.emitStatus({ id, status }); } catch (e) { logger.warn('🧵 SSE status ⚠️', { e: String(e) }); }
    res.json({ ok: true });
  } catch (e) {
    logger.error('✏️ orders status ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_status_error' });
  }
});

// Stampa (best-effort, non blocca)
router.post('/:id(\\d+)/print', async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const full = await getOrderFullById(id);
    if (!full) return res.status(404).json({ ok: false, error: 'not_found' });

    try {
      await printOrderDual(full);
      return res.json({ ok: true });
    } catch (e) {
      logger.warn('🖨️ orders print ⚠️', { id, error: String(e) });
      return res.status(502).json({ ok: false, error: 'printer_error', reason: String(e) });
    }
  } catch (e) {
    logger.error('🖨️ orders print ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_print_error' });
  }
});

module.exports = router;
