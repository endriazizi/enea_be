'use strict';

/**
 * api/orders.js
 * Router per gli ORDINI:
 *  - GET /api/orders?status=&hours=&from=&to=&q=
 *  - GET /api/orders/:id
 *  - POST /api/orders
 *  - PATCH /api/orders/:id/status
 *  - GET /api/orders/stream  (SSE)  ← montata da services/orders.sse
 */

const express = require('express');
const router  = express.Router();

const logger  = require('../logger');
const env     = require('../env');
const orders  = require('../services/orders.service');

// === requireAuth con fallback DEV (stile reservations) ======================
let requireAuth;
try {
  ({ requireAuth } = require('./auth'));
  if (typeof requireAuth !== 'function') throw new Error('requireAuth non è una funzione');
  logger.info('🔐 requireAuth caricato da ./auth');
} catch (_e) {
  logger.warn('⚠️ requireAuth non disponibile. Uso FALLBACK DEV (solo locale).');
  requireAuth = (req, _res, next) => {
    req.user = {
      id: Number(process.env.AUTH_DEV_ID || 0),
      email: process.env.AUTH_DEV_USER || 'dev@local'
    };
    next();
  };
}

// === SSE (robusto): se esporta mountSse → lo uso; altrimenti non crash ======
try {
  const sseBus = require('../services/orders.sse');
  if (sseBus && typeof sseBus.mountSse === 'function') {
    sseBus.mountSse(router);                // ← monta /stream
    router._ordersSse = sseBus;             // salvo riferimento (opzionale)
  } else {
    logger.warn('⚠️ orders.sse senza mountSse: SSE non attivo');
  }
} catch (err) {
  logger.warn('⚠️ orders.sse non disponibile o errore di import; continuo senza SSE', { error: String(err) });
}

// ---------------------------- LIST -----------------------------------------
router.get('/', async (req, res) => {
  try {
    const filter = {
      status: req.query.status || undefined,
      hours : req.query.hours  || undefined,
      from  : req.query.from   || undefined,
      to    : req.query.to     || undefined,
      q     : req.query.q      || undefined,
    };
    logger.info('📥 [GET] /api/orders', { filter });

    const rows = await orders.list(filter);
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/orders', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---------------------------- GET BY ID ------------------------------------
router.get('/:id(\\d+)', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  try {
    const row = await orders.getById(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/:id', { id, error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---------------------------- CREATE ---------------------------------------
router.post('/', requireAuth, async (req, res) => {
  try {
    const dto = req.body || {};
    if (!dto.customer_name) return res.status(400).json({ error: 'missing_customer_name' });
    if (!Array.isArray(dto.items) || !dto.items.length) return res.status(400).json({ error: 'empty_items' });

    const created = await orders.create(dto);
    logger.info('➕ [POST] /api/orders OK', { id: created.id });

    // SSE broadcast (se disponibile)
    try {
      const sse = router._ordersSse;
      sse?.emitCreated?.({ id: created.id, status: created.status, total: created.total, customer_name: created.customer_name });
    } catch (_) {}

    // (Opz) Notifiche lato server se abilitate da ENV
    try {
      if (String(process.env.MAIL_ENABLED || '').toLowerCase() === 'true') {
        const mailer = require('../services/mailer.service');
        await mailer.sendOrderCreatedEmail({ order: created });
        logger.info('📧 order-created mail ✅', { id: created.id });
      }
    } catch (e) {
      logger.warn('📧 order-created mail SKIP/ERR', { id: created.id, error: String(e) });
    }

    try {
      if (String(process.env.WA_ENABLED || '').toLowerCase() === 'true') {
        const provider = (process.env.WA_PROVIDER || 'twilio').toLowerCase();
        const wa = provider === 'whatsender'
          ? require('../services/whatsender.service')
          : require('../services/whatsapp-twilio.service');
        await wa.sendOrderCreated({ order: created });
        logger.info('📲 order-created WA ✅', { id: created.id, provider });
      }
    } catch (e) {
      logger.warn('📲 order-created WA SKIP/ERR', { id: created.id, error: String(e) });
    }

    res.status(201).json(created);
  } catch (err) {
    logger.error('❌ [POST] /api/orders', { error: String(err) });
    res.status(400).json({ error: err.message || 'internal_error' });
  }
});

// ---------------------------- PATCH STATUS ----------------------------------
router.patch('/:id(\\d+)/status', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const status = (req.body?.status || '').toString().trim();
  if (!status) return res.status(400).json({ error: 'missing_status' });

  try {
    const updated = await orders.updateStatus(id, status);
    if (!updated) return res.status(404).json({ error: 'not_found' });

    // SSE broadcast (se disponibile)
    try {
      const sse = router._ordersSse;
      sse?.emitStatus?.({ id, status: updated.status });
    } catch (_) {}

    // (Opz) Notifiche stato se abilitate
    try {
      if (String(process.env.MAIL_ENABLED || '').toLowerCase() === 'true') {
        const mailer = require('../services/mailer.service');
        await mailer.sendOrderStatusEmail({ order: updated });
        logger.info('📧 order-status mail ✅', { id, status: updated.status });
      }
    } catch (e) {
      logger.warn('📧 order-status mail SKIP/ERR', { id, error: String(e) });
    }

    try {
      if (String(process.env.WA_ENABLED || '').toLowerCase() === 'true') {
        const provider = (process.env.WA_PROVIDER || 'twilio').toLowerCase();
        const wa = provider === 'whatsender'
          ? require('../services/whatsender.service')
          : require('../services/whatsapp-twilio.service');
        await wa.sendOrderStatus({ order: updated });
        logger.info('📲 order-status WA ✅', { id, status: updated.status, provider });
      }
    } catch (e) {
      logger.warn('📲 order-status WA SKIP/ERR', { id, error: String(e) });
    }

    res.json(updated);
  } catch (err) {
    logger.error('❌ [PATCH] /api/orders/:id/status', { id, error: String(err) });
    res.status(400).json({ error: err.message || 'internal_error' });
  }
});

module.exports = router;
