'use strict';

// src/api/orders.js — ORDINI (header + items + stato + notify + socket + SSE)

const express = require('express');
const router = express.Router();

const logger = require('../logger');
const { query } = require('../db');
const Orders = require('../services/orders.service');
const notify = require('../services/notify.service');
const sse = require('../services/orders.sse');

// Helper: id numerico
const toId = (v) => Number.parseInt(v, 10);

// Carica + items
async function hydrateOrder(orderId) {
  const [order] = await query('SELECT * FROM orders WHERE id=?', [orderId]);
  if (!order) return null;
  const items = await query('SELECT * FROM order_items WHERE order_id=?', [orderId]);
  return { ...order, items };
}

// ---------------- LISTE ------------------------------------------------------
router.get('/', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders');
    const rows = await Orders.listHeaders();
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/orders', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/all', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/all');
    const out = await Orders.listFull();
    res.json(out);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/all', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/pending', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/pending');
    res.json(await Orders.listByStatus('pending'));
  } catch (err) {
    logger.error('❌ [GET] /api/orders/pending', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/completed', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/completed');
    res.json(await Orders.listByStatus('completed'));
  } catch (err) {
    logger.error('❌ [GET] /api/orders/completed', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/today', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/today');
    res.json(await Orders.listLastHours(24));
  } catch (err) {
    logger.error('❌ [GET] /api/orders/today', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---------------- DETTAGLIO --------------------------------------------------
router.get('/:id(\\d+)', async (req, res) => {
  const id = toId(req.params.id);
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

// ---------------- CREA -------------------------------------------------------
router.post('/', async (req, res) => {
  const dto = req.body || {};
  try {
    logger.info('➕ [POST] /api/orders ▶️', {
      source: dto.source || dto.channel || 'web',
      items: Array.isArray(dto.items) ? dto.items.length : 0
    });

    const created = await Orders.create(dto);
    const full = await hydrateOrder(created.id);

    // Notifiche (best-effort)
    try { await notify.onOrderCreated(full); }
    catch (e) { logger.error('🔔 notify NEW ❌', { id: created.id, error: String(e) }); }

    // Socket
    try {
      const io = require('../sockets/index').io();
      io.emit('orders:created', { id: created.id, order: full });
      logger.info('📡 socket orders:created ✅', { id: created.id });
    } catch (e) {
      logger.warn('📡 socket orders:created ⚠️', { id: created.id, error: String(e) });
    }

    // SSE
    try {
      sse.broadcast('order-created', { id: created.id, order: full });
    } catch (e) {
      logger.warn('🧵 SSE broadcast order-created ⚠️', { error: String(e) });
    }

    res.status(201).json(full);
  } catch (err) {
    logger.error('❌ [POST] /api/orders', { error: String(err) });
    res.status(500).json({ error: err.message || 'internal_error' });
  }
});

// ---------------- STATO ------------------------------------------------------
router.patch('/:id(\\d+)/status', async (req, res) => {
  const id = toId(req.params.id);
  const status = String(req.body?.status || '').toLowerCase();
  try {
    logger.info('✏️ [PATCH] /api/orders/:id/status ▶️', { id, status });

    const ok = await Orders.setStatus(id, status);
    if (!ok) return res.status(404).json({ error: 'not_found' });

    const full = await hydrateOrder(id);

    // socket
    try {
      const io = require('../sockets/index').io();
      io.emit('orders:status', { id, status, order: full });
      logger.info('📡 socket orders:status ✅', { id, status });
    } catch (e) {
      logger.warn('📡 socket orders:status ⚠️', { id, error: String(e) });
    }

    // SSE
    try {
      sse.broadcast('order-status', { id, status, order: full });
    } catch (e) {
      logger.warn('🧵 SSE broadcast order-status ⚠️', { id, error: String(e) });
    }

    // notify (cliente)
    try { await notify.onOrderStatus(full, status); }
    catch (e) { logger.error('🔔 notify STATUS ❌', { id, status, error: String(e) }); }

    res.json({ ok: true, id, status });
  } catch (err) {
    logger.error('❌ [PATCH] /api/orders/:id/status', { id, error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---------------- STREAM SSE -------------------------------------------------
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');

  res.write(`event: hello\n`);
  res.write(`data: ${JSON.stringify({ ok: true, t: Date.now() })}\n\n`);

  sse.add(res);

  const ping = setInterval(() => {
    try { res.write(`event: ping\ndata: ${Date.now()}\n\n`); } catch (_) {}
  }, 15000);

  req.on('close', () => {
    clearInterval(ping);
    sse.remove(res);
  });
});

module.exports = router;
