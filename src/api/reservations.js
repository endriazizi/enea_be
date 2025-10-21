// src/api/reservations.js
'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../logger');
const svc = require('../services/reservations.service');

// === requireAuth con fallback DEV ============================================
let requireAuth;
try {
  ({ requireAuth } = require('./auth'));
  if (typeof requireAuth !== 'function') throw new Error('requireAuth non è una funzione');
  logger.info('🔐 requireAuth caricato da ./auth');
} catch (e) {
  logger.warn('⚠️ requireAuth non disponibile. Uso FALLBACK DEV (solo locale).');
  requireAuth = (req, _res, next) => {
    req.user = { id: 0, email: 'dev@local' };
    next();
  };
}

// Azioni di stato + audit
const resvActions = require('../services/reservations-status.service');

// GET /api/reservations?status=&from=&to=&q=
router.get('/', async (req, res) => {
  try {
    const filter = {
      status: req.query.status || undefined,
      from  : req.query.from   || undefined,
      to    : req.query.to     || undefined,
      q     : req.query.q      || undefined
    };
    logger.info('📥 [GET] /api/reservations', { filter });
    const rows = await svc.list(filter);
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---------- Supporto UI (prima di /:id per evitare ambiguità) ---------------

// Sale
router.get('/rooms', async (_req, res) => {
  try {
    const rows = await svc.listRooms();
    res.json(rows);
  } catch (err) {
    logger.error('❌ /rooms', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// Tavoli per sala
router.get('/support/tables/by-room/:roomId(\\d+)', async (req, res) => {
  try {
    const rows = await svc.listTablesByRoom(Number(req.params.roomId));
    res.json(rows);
  } catch (err) {
    logger.error('❌ /support/tables/by-room', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// Conteggi per status nel range
router.get('/support/count-by-status', async (req, res) => {
  try {
    const out = await svc.countByStatus({ from: req.query.from, to: req.query.to });
    res.json(out);
  } catch (err) {
    logger.error('❌ /support/count-by-status', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// ============================ AZIONI DI STATO ================================

router.put('/:id(\\d+)/status', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { action, reason } = req.body || {};
    if (!id || !action) return res.status(400).json({ error: 'id e action sono obbligatori' });

    const updated = await resvActions.updateStatus({
      reservationId: id,
      action,
      reason: typeof reason === 'string' ? reason.trim() : null,
      user: req.user,
    });

    return res.json({ ok: true, reservation: updated });
  } catch (err) {
    const code = err.statusCode || 500;
    logger.error('❌ status change failed', { err: String(err) });
    return res.status(code).json({ error: err.sqlMessage || err.message });
  }
});

// GET /:id/audit
router.get('/:id(\\d+)/audit', requireAuth, async (req, res) => {
  try {
    const rows = await resvActions.getAudit({
      reservationId: Number(req.params.id),
      limit: Number(req.query.limit || 50)
    });
    return res.json({ ok: true, rows });
  } catch (err) {
    const code = err.statusCode || 500;
    return res.status(code).json({ error: err.message });
  }
});

// ================================ CRUD ======================================

router.get('/:id(\\d+)', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  try {
    const r = await svc.getById(id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    res.json(r);
  } catch (err) {
    logger.error('❌ [GET] /:id', { id, error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const created = await svc.create(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    logger.error('❌ [POST] /', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.patch('/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    const updated = await svc.update(Number(req.params.id), req.body || {});
    res.json(updated);
  } catch (err) {
    const code = err.statusCode || 500;
    logger.error('❌ [PATCH] /:id', { error: String(err) });
    res.status(code).json({ error: err.message || 'internal_error' });
  }
});

router.delete('/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    await svc.remove(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    const code = err.statusCode || 500;
    logger.error('❌ [DELETE] /:id', { error: String(err) });
    res.status(code).json({ error: err.message || 'internal_error' });
  }
});

// =============================== STAMPA =====================================

const printerSvc = require('../services/thermal-printer.service');

router.post('/print/daily', requireAuth, async (req, res) => {
  try {
    const date = (req.body?.date || new Date().toISOString().slice(0,10));
    const status = req.body?.status || 'all';
    const rows = await svc.list({ from: date, to: date, status });
    logger.info('🧾 print/daily', { date, status, rows: rows.length });
    const out = await printerSvc.printDailyReservations({ date, rows, user: req.user });
    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/daily', { error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

router.post('/print/placecards', requireAuth, async (req, res) => {
  try {
    const date = (req.body?.date || new Date().toISOString().slice(0,10));
    const status = req.body?.status || 'accepted';
    const qrBaseUrl = req.body?.qr_base_url || process.env.QR_BASE_URL || '';
    const rows = await svc.list({ from: date, to: date, status });
    logger.info('🧾 print/placecards', { date, status, rows: rows.length });
    const out = await printerSvc.printPlaceCards({
      date, rows, user: req.user,
      logoText: process.env.BIZ_NAME || 'LA MIA ATTIVITÀ',
      qrBaseUrl
    });
    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/placecards', { error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// === INIZIO MODIFICA: stampa segnaposto singolo =============================
// POST /api/reservations/:id/print/placecard
router.post('/:id(\\d+)/print/placecard', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });

    const r = await svc.getById(id);
    if (!r) return res.status(404).json({ error: 'not_found' });

    const qrBaseUrl = req.body?.qr_base_url || process.env.QR_BASE_URL || '';

    const out = await printerSvc.printPlaceCards({
      date: (r.start_at || '').toString().slice(0, 10),
      rows: [r],                        // 👈 una sola prenotazione
      user: req.user,
      logoText: process.env.BIZ_NAME || 'LA MIA ATTIVITÀ',
      qrBaseUrl,
    });

    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/placecard (single)', { error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});
// === FINE MODIFICA ===========================================================

module.exports = router;
