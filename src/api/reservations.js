'use strict';

const express = require('express');
const router  = express.Router();

const logger = require('../logger');
const env    = require('../env');
const svc    = require('../services/reservations.service');

// === requireAuth con fallback DEV ============================================
let requireAuth;
try {
  ({ requireAuth } = require('./auth'));
  if (typeof requireAuth !== 'function') throw new Error('requireAuth non è una funzione');
  logger.info('🔐 requireAuth caricato da ./auth');
} catch (e) {
  logger.warn('⚠️ requireAuth non disponibile. Uso FALLBACK DEV (solo locale).');
  requireAuth = (req, _res, next) => {
    req.user = {
      id: Number(process.env.AUTH_DEV_ID || 0),
      email: process.env.AUTH_DEV_USER || 'dev@local'
    };
    next();
  };
}

// Azioni di stato + audit (state machine già esistente)
const resvActions = require('../services/reservations-status.service'); // path corretto
// Mailer (esistente)
const mailer = require('../services/mailer.service');
// WhatsApp (esistente)
const wa = require('../services/whatsapp.service');

// ================================ LIST =======================================
// GET /api/reservations?status=&from=&to=&q=
router.get('/', async (req, res) => {
  try {
    const filter = {
      status: req.query.status || undefined,
      from  : req.query.from   || undefined,
      to    : req.query.to     || undefined,
      q     : req.query.q      || undefined,
    };
    logger.info('📥 [GET] /api/reservations', { service: 'server', filter });
    const rows = await svc.list(filter);
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// ================================ SUPPORT ====================================
// GET /api/reservations/support/count-by-status?from=&to=
router.get('/support/count-by-status', async (req, res) => {
  try {
    const from = req.query.from || null;
    const to   = req.query.to   || null;
    const rows = await svc.countByStatus({ from, to });
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations/support/count-by-status', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
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
    logger.error('❌ [GET] /api/reservations/:id', { id, error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const dto = req.body || {};
    const r = await svc.create(dto, { user: req.user });
    logger.info('➕ [POST] /api/reservations OK', { id: r.id });
    res.status(201).json(r);
  } catch (err) {
    logger.error('❌ [POST] /api/reservations', { error: String(err) });
    res.status(500).json({ error: err.message || 'internal_error' });
  }
});

router.put('/:id(\\d+)', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  try {
    const dto = req.body || {};
    const r = await svc.update(id, dto, { user: req.user });
    if (!r) return res.status(404).json({ error: 'not_found' });
    logger.info('✏️ [PUT] /api/reservations/:id OK', { id });
    res.json(r);
  } catch (err) {
    logger.error('❌ [PUT] /api/reservations/:id', { id, error: String(err) });
    res.status(500).json({ error: err.message || 'internal_error' });
  }
});

// ========================== CAMBIO STATO + NOTIFICHE =========================
// PUT /api/reservations/:id/status  body { action, reason?, notify?, email?, reply_to? }
router.put('/:id(\\d+)/status', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const action   = (req.body?.action || '').toString().trim();
  const reason   = (req.body?.reason || '').toString().trim() || null;
  const notify   = (req.body?.notify !== undefined) ? !!req.body.notify : undefined; // se omesso decide env
  const toEmail  = (req.body?.email || '').toString().trim() || null;   // override
  const replyTo  = (req.body?.reply_to || '').toString().trim() || null;

  if (!action) return res.status(400).json({ error: 'missing_action' });

  try {
    // Applica la transizione (state machine già esistente con audit)
    const updated = await resvActions.updateStatus({
      reservationId: id,
      action,
      reason,
      user: req.user
    });

    // === EMAIL (stessa logica già presente nel tuo snapshot) =================
    try {
      const mustNotify = (notify === true) || (notify === undefined && !!env.RESV?.notifyAlways);
      if (mustNotify) {
        const dest = toEmail || updated.contact_email || updated.email || null;
        if (dest) {
          await mailer.sendStatusChangeEmail({
            to: dest,
            reservation: updated,
            newStatus: updated.status,
            reason,
            replyTo
          });
          logger.info('📧 status-change mail ✅', { id, to: dest, status: updated.status });
        } else {
          logger.warn('📧 status-change mail SKIP (no email)', { id, status: updated.status });
        }
      } else {
        logger.info('📧 status-change mail SKIPPED by notify/env', { id, notify });
      }
    } catch (err) {
      logger.error('📧 status-change mail ❌', { id, error: String(err) });
    }

    // === WHATSAPP (Twilio) — stessa logica esistente =========================
    try {
      const waRes = await wa.sendStatusChange({
        to: updated.contact_phone || updated.phone || null,
        reservation: updated,
        status: updated.status,
        reason
      });
      if (waRes?.ok) {
        logger.info('📲 status-change WA ✅', { id, sid: waRes.sid });
      } else {
        logger.warn('📲 status-change WA skipped', { id, why: waRes?.reason || 'unknown' });
      }
    } catch (err) {
      logger.error('📲 status-change WA ❌', { id, error: String(err) });
    }

    return res.json({ ok: true, reservation: updated });
  } catch (err) {
    logger.error('❌ [PUT] /api/reservations/:id/status', { id, error: String(err) });
    return res.status(400).json({ error: err.message || 'invalid_transition' });
  }
});

// ================== REJECT + EMAIL + WHATSAPP (dedicato) =====================
// POST /api/reservations/:id/reject-notify  body { reason, email?, reply_to? }
router.post('/:id(\\d+)/reject-notify', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const reason   = (req.body?.reason || '').toString().trim() || null;
  const toEmail  = (req.body?.email || '').toString().trim() || null;
  const replyTo  = (req.body?.reply_to || '').toString().trim() || null;

  try {
    const existing = await svc.getById(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const updated = await resvActions.updateStatus({
      reservationId: id,
      action: 'reject',
      reason,
      user: req.user
    });

    // email dedicata al rifiuto
    try {
      const dest = toEmail || updated.contact_email || updated.email || null;
      if (dest) {
        const sent = await mailer.sendReservationRejectionEmail({
          to: dest,
          reservation: updated,
          reason,
          replyTo,
        });
        logger.info('📧 reject-notify ✅', { id, to: dest, messageId: sent?.messageId });
      } else {
        logger.warn('📧 reject-notify: nessuna email disponibile', { id });
      }
    } catch (err) {
      logger.error('📧 reject-notify ❌', { id, error: String(err) });
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
        logger.info('📲 reject-notify WA ✅', { id, sid: waRes.sid });
      } else {
        logger.warn('📲 reject-notify WA skipped', { id, reason: waRes?.reason });
      }
    } catch (err) {
      logger.error('📲 reject-notify WA ❌', { id, error: String(err) });
    }

    return res.json({ ok: true, reservation: updated });
  } catch (err) {
    logger.error('❌ reject-notify', { id, error: String(err) });
    return res.status(500).json({ error: err.message || 'internal_error' });
  }
});

// ============================== DELETE (HARD) ================================
// DELETE /api/reservations/:id?force=true|false
// Regola: allowed se status='cancelled'. Se RESV_ALLOW_DELETE_ANY_STATUS=true o force=true → qualsiasi stato.
router.delete('/:id(\\d+)', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const forceParam = String(req.query.force || '').toLowerCase();
  const force = (forceParam === '1' || forceParam === 'true' || forceParam === 'yes');

  const allowAnyByEnv =
    (env.RESV && env.RESV.allowDeleteAnyStatus === true) ||
    (String(process.env.RESV_ALLOW_DELETE_ANY_STATUS || '').toLowerCase() === 'true');

  try {
    const existing = await svc.getById(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    // Policy
    const canAny = allowAnyByEnv || force;
    if (!canAny && String(existing.status || '').toLowerCase() !== 'cancelled') {
      return res.status(409).json({
        error: 'delete_not_allowed',
        message: 'Puoi eliminare solo prenotazioni in stato CANCELLED (usa ?force=true o abilita RESV_ALLOW_DELETE_ANY_STATUS).'
      });
    }

    const ok = await svc.remove(id, { user: req.user, reason: 'hard-delete' });
    if (!ok) return res.status(500).json({ error: 'delete_failed' });

    logger.info('🗑️ [DELETE] /api/reservations/:id OK', { id, force, allowAnyByEnv, status: existing.status });
    return res.json({ ok: true, id });
  } catch (err) {
    logger.error('❌ [DELETE] /api/reservations/:id', { id, error: String(err) });
    res.status(500).json({ error: err.message || 'internal_error' });
  }
});

// ================================ PRINT ======================================
const printerSvc = require('../services/thermal-printer.service');

// POST /api/reservations/print/daily  body { date, status? }
router.post('/print/daily', requireAuth, async (req, res) => {
  try {
    const date = (req.body?.date || '').toString().slice(0,10);
    const status = (req.body?.status || 'all').toString().toLowerCase();

    const rows = await svc.list({ from: date, to: date, status: status === 'all' ? undefined : status });
    const out = await printerSvc.printDailyReservations({
      date,
      rows,
      user: req.user,
      logoText: process.env.BIZ_NAME || 'LA MIA ATTIVITÀ'
    });
    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/daily', { error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// POST /api/reservations/print/placecards  body { date, status?, qr_base_url? }
router.post('/print/placecards', requireAuth, async (req, res) => {
  try {
    const date   = (req.body?.date || '').toString().slice(0,10);
    const status = (req.body?.status || 'accepted').toString().toLowerCase();
    const qrBaseUrl = req.body?.qr_base_url || process.env.QR_BASE_URL || '';

    const rows = await svc.list({ from: date, to: date, status });
    const out = await printerSvc.printPlaceCards({
      date,
      rows,
      user: req.user,
      logoText: process.env.BIZ_NAME || 'LA MIA ATTIVITÀ',
      qrBaseUrl
    });
    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/placecards', { error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

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
      rows: [r],
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

module.exports = router;
