'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../logger');
const env = require('../env');
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
    req.user = { id: Number(process.env.AUTH_DEV_ID || 0), email: process.env.AUTH_DEV_USER || 'dev@local' };
    next();
  };
}

// Azioni di stato + audit
const resvActions = require('../services/reservations-status.service');
// Mailer
const mailer = require('../services/mailer.service');
// WhatsApp
const wa = require('../services/whatsapp.service');

// GET /api/reservations?status=&from=&to=&q=
router.get('/', async (req, res) => {
  try {
    const filter = {
      status: req.query.status || undefined,
      from  : req.query.from   || undefined,
      to    : req.query.to     || undefined,
      q     : req.query.q      || undefined
    };
    logger.info('📥 [GET] /api/reservations', { service: 'server', filter });
    const rows = await svc.list(filter);
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations', { service: 'server', error: String(err) });
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
    logger.error('❌ /rooms', { service: 'server', error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// Tavoli per sala
router.get('/support/tables/by-room/:roomId(\\d+)', async (req, res) => {
  try {
    const rows = await svc.listTablesByRoom(Number(req.params.roomId));
    res.json(rows);
  } catch (err) {
    logger.error('❌ /support/tables/by-room', { service: 'server', error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// Conteggi per status nel range
router.get('/support/count-by-status', async (req, res) => {
  try {
    const out = await svc.countByStatus({ from: req.query.from, to: req.query.to });
    res.json(out);
  } catch (err) {
    logger.error('❌ /support/count-by-status', { service: 'server', error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// ============================ AZIONI DI STATO ================================

router.put('/:id(\\d+)/status', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { action, reason, notify, email, reply_to } = req.body || {};
  if (!id || !action) return res.status(400).json({ error: 'id e action sono obbligatori' });

  try {
    // 1) Transizione stato (con override/backtrack secondo .env)
    const updated = await resvActions.updateStatus({
      reservationId: id,
      action,
      reason: typeof reason === 'string' ? reason.trim() : null,
      user: req.user,
    });

    // 2) Notifiche (mail + WhatsApp)
    const willNotify = (notify !== false) || env.RESV.notifyAlways === true;

    if (willNotify) {
      // --- EMAIL ------------------------------------------------------------
      try {
        const sent = await mailer.sendStatusChangeEmail({
          to: email || updated.contact_email || updated.email || null,
          reservation: updated,
          status: updated.status,
          reason,
          replyTo: reply_to || undefined
        });
        if (sent?.messageId) {
          logger.info('📧 MAIL OK', { service: 'server', id, messageId: sent.messageId });
        }
      } catch (err) {
        logger.error('📧 MAIL ERROR', { service: 'server', id, error: String(err) });
      }

      // --- WHATSAPP ---------------------------------------------------------
      try {
        const waRes = await wa.sendStatusChange({
          to: updated.contact_phone || updated.phone || null,
          reservation: updated,
          status: updated.status,
          reason,
        });
        if (waRes?.ok) {
          logger.info('📲 WA OK', { service: 'server', id, sid: waRes.sid, template: !!waRes.template });
        } else {
          logger.warn('📲 WA SKIPPED', { service: 'server', id, reason: waRes?.reason || 'unknown' });
        }
      } catch (err) {
        logger.error('📲 WA ERROR', { service: 'server', id, error: String(err) });
      }
    } else {
      logger.warn('🔕 Notifiche disabilitate per questa richiesta', {
        service: 'server', id, notify, notifyAlwaysEnv: env.RESV.notifyAlways
      });
    }

    return res.json({ ok: true, reservation: updated });
  } catch (err) {
    const code = err.statusCode || 500;
    logger.error('❌ status change failed', { service: 'server', err: String(err) });
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

// ================== REJECT + EMAIL + WHATSAPP ================================
// POST /api/reservations/:id/reject-notify
router.post('/:id(\\d+)/reject-notify', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const reason = (req.body?.reason || '').toString().trim() || null;
  const forcedEmail = (req.body?.email || '').toString().trim() || null;
  const replyTo = (req.body?.reply_to || '').toString().trim() || null;

  try {
    const r = await svc.getById(id);
    if (!r) return res.status(404).json({ error: 'not_found' });

    const updated = await resvActions.updateStatus({
      reservationId: id,
      action: 'reject',
      reason,
      user: req.user
    });

    // email
    try {
      const to = forcedEmail || updated.contact_email || updated.email || null;
      if (to) {
        const sent = await mailer.sendReservationRejectionEmail({
          to,
          reservation: updated,
          reason,
          replyTo,
        });
        logger.info('📧 reject-notify ✅', { service: 'server', id, to, messageId: sent?.messageId });
      } else {
        logger.warn('📧 reject-notify: nessuna email disponibile', { service: 'server', id });
      }
    } catch (err) {
      logger.error('📧 reject-notify ❌', { service: 'server', id, error: String(err) });
    }

    // whatsapp
    try {
      const waRes = await wa.sendStatusChange({
        to: updated.contact_phone || updated.phone || null,
        reservation: updated,
        status: updated.status,
        reason,
      });
      if (waRes?.ok) {
        logger.info('📲 reject-notify WA ✅', { service: 'server', id, sid: waRes.sid });
      } else {
        logger.warn('📲 reject-notify WA skipped', { service: 'server', id, reason: waRes?.reason });
      }
    } catch (err) {
      logger.error('📲 reject-notify WA ❌', { service: 'server', id, error: String(err) });
    }

    return res.json({
      ok: true,
      reservation: updated,
      email: { attempted: true },
      wa: { attempted: true }
    });
  } catch (err) {
    logger.error('📧 reject-notify ❌ errore', { service: 'server', id, error: String(err) });
    return res.status(500).json({ error: err.message || 'internal_error' });
  }
});

// ================================ CRUD =======================================

router.get('/:id(\\d+)', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  try {
    const r = await svc.getById(id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    res.json(r);
  } catch (err) {
    logger.error('❌ [GET] /:id', { service: 'server', id, error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const created = await svc.create(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    logger.error('❌ [POST] /', { service: 'server', error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.patch('/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    const updated = await svc.update(Number(req.params.id), req.body || {});
    res.json(updated);
  } catch (err) {
    const code = err.statusCode || 500;
    logger.error('❌ [PATCH] /:id', { service: 'server', error: String(err) });
    res.status(code).json({ error: err.message || 'internal_error' });
  }
});

router.delete('/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    await svc.remove(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    const code = err.statusCode || 500;
    logger.error('❌ [DELETE] /:id', { service: 'server', error: String(err) });
    res.status(code).json({ error: err.message || 'internal_error' });
  }
});

// =============================== STAMPA ======================================

const printerSvc = require('../services/thermal-printer.service');

router.post('/print/daily', requireAuth, async (req, res) => {
  try {
    const date = (req.body?.date || new Date().toISOString().slice(0,10));
    const status = req.body?.status || 'all';
    const rows = await svc.list({ from: date, to: date, status });
    logger.info('🧾 print/daily', { service: 'server', date, status, rows: rows.length });
    const out = await printerSvc.printDailyReservations({ date, rows, user: req.user });
    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/daily', { service: 'server', error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

router.post('/print/placecards', requireAuth, async (req, res) => {
  try {
    const date = (req.body?.date || new Date().toISOString().slice(0,10));
    const status = req.body?.status || 'accepted';
    const qrBaseUrl = req.body?.qr_base_url || process.env.QR_BASE_URL || '';
    const rows = await svc.list({ from: date, to: date, status });
    logger.info('🧾 print/placecards', { service: 'server', date, status, rows: rows.length });
    const out = await printerSvc.printPlaceCards({
      date, rows, user: req.user,
      logoText: process.env.BIZ_NAME || 'LA MIA ATTIVITÀ',
      qrBaseUrl
    });
    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/placecards', { service: 'server', error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Segnaposto singolo
router.post('/:id(\\d+)/print/placecard', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });

    const r = await svc.getById(id);
    if (!r) return res.status(404).json({ error: 'not_found' });

    const qrBaseUrl = req.body?.qr_base_url || process.env.QR_BASE_URL || '';

    const out = await printerSvc.printPlaceCards({
      date: (r.start_at || '').toString().slice(0, 10),
      rows: [r],
      user: req.user,
      logoText: process.env.BIZ_NAME || 'LA MIA ATTIVITÀ',
      qrBaseUrl,
    });

    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/placecard (single)', { service: 'server', error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

module.exports = router;
