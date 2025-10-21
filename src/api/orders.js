// src/api/orders.js
const express = require('express');
const router = express.Router();

const logger = require('../logger');      // ✅ winston
const { query } = require('../db');       // ✅ mysql2/promise pool

// 🔧 helper: carica un ordine con items
async function hydrateOrder(orderId) {
  const [order] = await query('SELECT * FROM orders WHERE id=?', [orderId]);
  if (!order) return null;
  const items = await query('SELECT * FROM order_items WHERE order_id=?', [orderId]);
  return { ...order, items }; // <-- FIX: spread corretto
}

// GET /api/orders  → tutti (solo header, senza items)
// Per caricare la board rapidamente
router.get('/', async (req, res) => {
  try {
    logger.info('📥 [GET] /api/orders (all headers)');
    const rows = await query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/orders', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/orders/all → alias, con hydrate (items inclusi)
router.get('/all', async (req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/all (hydrate each)');
    const heads = await query('SELECT id FROM orders ORDER BY created_at DESC');
    const full = [];
    for (const h of heads) {
      const o = await hydrateOrder(h.id);
      if (o) full.push(o);
    }
    res.json(full);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/all', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/orders/pending
router.get('/pending', async (req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/pending');
    const rows = await query('SELECT * FROM orders WHERE status="pending" ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/pending', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/orders/completed
router.get('/completed', async (req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/completed');
    const rows = await query('SELECT * FROM orders WHERE status="completed" ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/completed', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/orders/today  → ultimi 24h
router.get('/today', async (req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/today (last 24h)');
    const rows = await query(
      'SELECT * FROM orders WHERE created_at >= NOW() - INTERVAL 1 DAY ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/today', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/orders/:id  → dettaglio + items
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    logger.info('📥 [GET] /api/orders/:id', { id });
    const full = await hydrateOrder(id);
    if (!full) return res.status(404).json({ error: 'not_found' });
    res.json(full);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/:id', { id, error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// PATCH /api/orders/:id/status  → aggiorna stato (pending|confirmed|preparing|ready|completed)
router.patch('/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  try {
    logger.info('✏️ [PATCH] /api/orders/:id/status', { id, body: req.body });

    const valid = ['pending', 'confirmed', 'preparing', 'ready', 'completed'];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: 'invalid_status', valid });
    }

    await query('UPDATE orders SET status=? WHERE id=?', [status, id]);
    res.json({ ok: true, id, status });
  } catch (err) {
    logger.error('❌ [PATCH] /api/orders/:id/status', { id, error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
