'use strict';

/**
 * src/api/orders.js
 * Router ORDINI (liste, dettaglio, create, change-status, SSE)
 * Esporta DIRETTAMENTE un Router Express → module.exports = router
 * Stile: commenti lunghi, log con emoji, errori chiari.
 */

const express = require('express');
const router  = express.Router();

const logger  = require('../logger');
const { query } = require('../db');

const Orders  = require('../services/orders.service');  // CRUD + liste
const notify  = require('../services/notify.service');  // orchestratore email/WA (abilitato da ENV)
const sse     = require('../services/orders.sse');      // broadcaster SSE

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
const toId = (v) => Number.parseInt(v, 10);

async function hydrateOrder(orderId) {
  const [order] = await query('SELECT * FROM orders WHERE id=? LIMIT 1', [orderId]);
  if (!order) return null;
  const items = await query('SELECT * FROM order_items WHERE order_id=? ORDER BY id ASC', [orderId]);
  return { ...order, items };
}

// -----------------------------------------------------------------------------
// LISTE
// -----------------------------------------------------------------------------
router.get('/', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders');
    const rows = await Orders.listHeaders();
    res.json(rows);
  } catch (err) {
    logger.error('❌ /api/orders', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/all', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/all');
    res.json(await Orders.listFull());
  } catch (err) {
    logger.error('❌ /api/orders/all', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/pending', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/pending');
    res.json(await Orders.listByStatus('pending'));
  } catch (err) {
    logger.error('❌ /api/orders/pending', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/completed', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/completed');
    res.json(await Orders.listByStatus('completed'));
  } catch (err) {
    logger.error('❌ /api/orders/completed', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/today', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/today');
    res.json(await Orders.listLastHours(24));
  } catch (err) {
    logger.error('❌ /api/orders/today', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// -----------------------------------------------------------------------------
// DETTAGLIO
// -----------------------------------------------------------------------------
router.get('/:id(\\d+)', async (req, res) => {
  const id = toId(req.params.id);
  try {
    const full = await hydrateOrder(id);
    if (!full) return res.status(404).json({ error: 'not_found' });
    res.json(full);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/:id', { id, error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// -----------------------------------------------------------------------------
// CREA
// -----------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const payload = req.body || {};
    logger.info('🆕 [POST] /api/orders', { payload });

    const created = await Orders.create(payload);

    // SSE → tutte le sessioni live ricevono l’evento
    sse.broadcast('created', created);

    // Notifiche (solo se abilitate)
    try { await notify.onOrderCreated(created); }
    catch (e) { logger.warn('📧/📲 NOTIFY onCreate ⚠️', { error: String(e) }); }

    res.status(201).json(created);
  } catch (err) {
    logger.error('💥 [POST] /api/orders', { error: String(err) });
    res.status(400).json({ error: 'bad_request', detail: String(err) });
  }
});

// -----------------------------------------------------------------------------
// CAMBIO STATO (accetto PATCH/PUT e anche POST body {id,status} come fallback)
// -----------------------------------------------------------------------------
async function handleStatusChange(id, status, res) {
  await Orders.setStatus(id, status);
  const full = await hydrateOrder(id);
  if (!full) return res.status(404).json({ error: 'not_found' });

  // SSE: broadcast ad altre sessioni
  sse.broadcast('status', { id, status });

  // Notifica “short update” (se abilitate)
  try { await notify.onOrderStatus(full, status); }
  catch (e) { logger.warn('📧/📲 NOTIFY onStatus ⚠️', { error: String(e) }); }

  return res.json(full);
}

// RESTful: /api/orders/:id/status
router.patch('/:id(\\d+)/status', async (req, res) => {
  const id = toId(req.params.id);
  const status = String(req.body?.status || '').trim();
  try {
    logger.info('✏️ [PATCH] /api/orders/:id/status', { id, status });
    await handleStatusChange(id, status, res);
  } catch (err) {
    logger.error('💥 [PATCH] /api/orders/:id/status', { id, error: String(err) });
    res.status(400).json({ error: 'bad_request', detail: String(err) });
  }
});

// Alias PUT (alcune FE usano PUT)
router.put('/:id(\\d+)/status', async (req, res) => {
  const id = toId(req.params.id);
  const status = String(req.body?.status || '').trim();
  try {
    logger.info('✏️ [PUT] /api/orders/:id/status', { id, status });
    await handleStatusChange(id, status, res);
  } catch (err) {
    logger.error('💥 [PUT] /api/orders/:id/status', { id, error: String(err) });
    res.status(400).json({ error: 'bad_request', detail: String(err) });
  }
});

// Fallback legacy: POST /api/orders/status  body:{id,status}
router.post('/status', async (req, res) => {
  const id = toId(req.body?.id);
  const status = String(req.body?.status || '').trim();
  try {
    logger.info('✏️ [POST] /api/orders/status', { id, status });
    await handleStatusChange(id, status, res);
  } catch (err) {
    logger.error('💥 [POST] /api/orders/status', { id, error: String(err) });
    res.status(400).json({ error: 'bad_request', detail: String(err) });
  }
});

// -----------------------------------------------------------------------------
// STREAM (SSE) — live updates
// -----------------------------------------------------------------------------
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sse.add(res);
  req.on('close', () => sse.remove(res));
});

// 👇 EXPORT
module.exports = router;
