// C:\Users\Endri Azizi\progetti-dev\my_dev\be\src\api\reservations.js
'use strict';

/**
 * Router REST per /api/reservations
 * - Mantiene il tuo stile: commenti lunghi, log emoji, diagnostica chiara.
 * - Usa i tuoi services:
 *   • svc         = ../services/reservations.service        (CRUD + query DB)
 *   • resvActions = ../services/reservations-status.service (state machine + audit)
 *   • mailer, wa, printerSvc                                (notifiche/stampe)
 * - 🆕 Rotte esplicite:
 *   • POST /:id/checkin   → persiste checkin_at (idempotente) + emit socket
 *   • POST /:id/checkout  → persiste checkout_at + dwell_sec (idempotente) + emit socket {table_id, cleaning_until}
 * - ✅ FIX mail: dopo updateStatus ricarico la riga “idratata” via svc.getById(id)
 * - ✅ FIX date: accetta string o oggetto {date:'...'} senza più .slice() su oggetto
 */

const express = require('express');
const router  = express.Router();

const logger = require('../logger');
const env    = require('../env');

const svc          = require('../services/reservations.service');          // ✅
const resvActions  = require('../services/reservations-status.service');   // ✅
const mailer       = require('../services/mailer.service');                // ✅
const wa           = require('../services/whatsapp.service');              // ✅
const printerSvc   = require('../services/thermal-printer.service');       // ✅

// === requireAuth con fallback DEV ============================================
let requireAuth;
try {
  ({ requireAuth } = require('../middleware/auth'));
  if (typeof requireAuth !== 'function') throw new Error('requireAuth non è una funzione');
  logger.info('🔐 requireAuth caricato da ../middleware/auth');
} catch {
  logger.warn('⚠️ requireAuth non disponibile. Uso FALLBACK DEV (solo locale).');
  requireAuth = (req, _res, next) => {
    req.user = { id: 0, email: process.env.AUTH_DEV_USER || 'dev@local' };
    next();
  };
}

// helper
const norm = (v) => (v ?? '').toString().trim();
function pickAction(body = {}) {
  const raw = norm(body.action ?? body.status ?? body.next).toLowerCase();
  if (!raw) return null;
  const map = {
    confirm:'confirm', confirmed:'confirm', accept:'confirm', accepted:'confirm', approve:'confirm', approved:'confirm',
    cancel:'cancel', cancelled:'cancel',
    reject:'reject', rejected:'reject',
    prepare:'prepare', preparing:'prepare',
    ready:'ready',
    complete:'complete', completed:'complete'
  };
  return map[raw] || raw;
}
function pickDate10(input) {
  if (!input) return new Date().toISOString().slice(0,10);
  if (typeof input === 'string') return input.slice(0,10);
  const s = input.date || input.day || input.ymd || input.value || '';
  return String(s).slice(0,10);
}

// ------------------------------ LIST -----------------------------------------
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
    return res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations', { error: String(err) });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ------------------------------ SUPPORT --------------------------------------
router.get('/support/count-by-status', async (req, res) => {
  try {
    const rows = await svc.countByStatus({ from: req.query.from || null, to: req.query.to || null });
    return res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations/support/count-by-status', { error: String(err) });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ------------------------------ DETAIL ---------------------------------------
router.get('/:id(\\d+)', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  try {
    const r = await svc.getById(id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    return res.json(r);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations/:id', { id, error: String(err) });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ------------------------------ CREATE ---------------------------------------
router.post('/', requireAuth, async (req, res) => {
  try {
    const created = await svc.create(req.body || {}, { user: req.user });
    return res.status(201).json(created);
  } catch (err) {
    logger.error('❌ [POST] /api/reservations', { error: String(err) });
    return res.status(400).json({ error: err.message || 'bad_request' });
  }
});

// ------------------------------ UPDATE ---------------------------------------
router.put('/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const updated = await svc.update(id, req.body || {}, { user: req.user });
    if (!updated) return res.status(404).json({ error: 'not_found' });
    return res.json(updated);
  } catch (err) {
    logger.error('❌ [PUT] /api/reservations/:id', { id, error: String(err) });
    const status = /invalid|missing|bad/i.test(String(err.message || err)) ? 400 : 500;
    return res.status(status).json({ error: err.message || 'internal_error' });
  }
});

// ----------- CAMBIO STATO + NOTIFICHE ----------------------------------------
router.put('/:id(\\d+)/status', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const action  = pickAction(req.body);
  const reason  = norm(req.body?.reason) || null;
  const notify  = (req.body?.notify !== undefined) ? !!req.body.notify : undefined;
  const toEmail = norm(req.body?.email) || null;
  const replyTo = norm(req.body?.reply_to) || null;

  if (!action) {
    logger.warn('⚠️ /status missing params', { id, raw: req.body });
    return res.status(400).json({ error: 'missing_action' });
  }

  try {
    // (1) state machine + audit (riga “spoglia”)
    await resvActions.updateStatus({
      id,
      action,
      reason,
      user_email: req.user?.email || 'dev@local'
    });

    // (2) ricarico riga “idratata”
    const updated = await svc.getById(id);

    // (3) email best-effort
    try {
      const mustNotify = (notify === true) || (notify === undefined && !!env.RESV?.notifyAlways);
      if (mustNotify) {
        const dest = toEmail || updated?.contact_email || updated?.email || null;
        if (dest && mailer?.sendStatusChangeEmail) {
          await mailer.sendStatusChangeEmail({
            to: dest, reservation: updated, newStatus: updated.status, reason, replyTo
          });
          logger.info('📧 status-change mail ✅', { id, to: dest, status: updated.status });
        } else {
          logger.warn('📧 status-change mail SKIP (no email or mailer)', { id, status: updated?.status || '' });
        }
      }
    } catch (e) { logger.error('📧 status-change mail ❌', { id, error: String(e) }); }

    // (4) whatsapp best-effort
    try {
      if (wa?.sendStatusChange) {
        await wa.sendStatusChange({
          to: updated?.contact_phone || updated?.phone || null,
          reservation: updated,
          status: updated.status,
          reason
        });
      }
    } catch (e) { logger.error('📲 status-change WA ❌', { id, error: String(e) }); }

    return res.json({ ok: true, reservation: updated });
  } catch (err) {
    logger.error('❌ [PUT] /api/reservations/:id/status', { id, action, error: String(err) });
    const status = /missing_id_or_action|invalid_action/i.test(String(err)) ? 400 : 500;
    return res.status(status).json({ error: String(err.message || err) });
  }
});

// ------------------------------ 🆕 CHECK-IN ----------------------------------
router.post('/:id(\\d+)/checkin', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  try {
    const at = norm(req.body?.at) || null; // ISO opzionale
    const r = await svc.checkIn(id, { at, user: req.user });
    // socket (se presente)
    try {
      const io = req.app.get('io');
      if (io) {
        io.to('admins').emit('reservation-checkin', { id: r.id, table_id: r.table_id || null });
        logger.info('📡 emit reservation-checkin', { id: r.id, table_id: r.table_id || null });
      }
    } catch {}
    logger.info('✅ RESV check-in', { service:'server', id: r.id, checkin_at: r.checkin_at, status: r.status });
    return res.json({ ok: true, reservation: r });
  } catch (err) {
    logger.error('❌ [POST] /api/reservations/:id/checkin', { id, error: String(err) });
    return res.status(400).json({ error: err.message || 'checkin_failed' });
  }
});

// ----------------------------- 🆕 CHECK-OUT ----------------------------------
router.post('/:id(\\d+)/checkout', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  try {
    const at = norm(req.body?.at) || null;  // ISO opzionale
    const r  = await svc.checkOut(id, { at, user: req.user });

    // finestra pulizia 5:00 per FE (anche se idempotente)
    const cleaningSecs  = Number(process.env.CLEANING_SECS || 300);
    const cleaningUntil = new Date(Date.now() + cleaningSecs * 1000).toISOString();

    // socket broadcast (SEMPRE) + log
    try {
      const io = req.app.get('io');
      if (io) {
        io.to('admins').emit('reservation-checkout', {
          id: r.id, table_id: r.table_id || null, cleaning_until: cleaningUntil
        });
        logger.info('📡 emit reservation-checkout', { id: r.id, table_id: r.table_id || null, cleaning_until: cleaningUntil });
      }
    } catch {}

    logger.info('✅ RESV checkout', { service:'server', id: r.id, checkout_at: r.checkout_at, dwell_sec: r.dwell_sec });
    return res.json({ ok: true, reservation: r, cleaning_until: cleaningUntil });
  } catch (err) {
    logger.error('❌ [POST] /api/reservations/:id/checkout', { id, error: String(err) });
    return res.status(400).json({ error: err.message || 'checkout_failed' });
  }
});

// Alias "ricco" per eventuali FE
router.post('/:id(\\d+)/checkout-with-meta', requireAuth, async (req, res) => {
  req.url = `/api/reservations/${req.params.id}/checkout`;
  return router.handle(req, res);
});

// ------------------------------ DELETE (hard) --------------------------------
router.delete('/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await svc.getById(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const force  = String(req.query.force || '').toLowerCase() === 'true';
    const allowAny =
      (env.RESV && env.RESV.allowDeleteAnyStatus === true) ||
      (String(process.env.RESV_ALLOW_DELETE_ANY_STATUS || '').toLowerCase() === 'true') ||
      force;

    const statusNorm = String(existing.status || '').toLowerCase();
    const isCancelled = (statusNorm === 'cancelled' || statusNorm === 'canceled');
    if (!allowAny && !isCancelled) {
      return res.status(409).json({
        error: 'delete_not_allowed',
        message: 'Puoi eliminare solo prenotazioni in stato CANCELLED (usa ?force=true o abilita RESV_ALLOW_DELETE_ANY_STATUS).'
      });
    }

    const ok = await svc.remove(id, { user: req.user, reason: 'hard-delete' });
    if (!ok) return res.status(500).json({ error: 'delete_failed' });
    logger.info('🗑️ [DELETE] /api/reservations/:id OK', { id, force, status: existing.status });
    return res.json({ ok: true, id });
  } catch (err) {
    logger.error('❌ [DELETE] /api/reservations/:id', { error: String(err) });
    return res.status(500).json({ error: err.message || 'internal_error' });
  }
});

// ------------------------------ PRINT ----------------------------------------
router.post('/print/daily', requireAuth, async (req, res) => {
  try {
    const date = pickDate10(req.body?.date || req.body);
    const status = norm(req.body?.status || 'all').toLowerCase();
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

router.post('/print/placecards', requireAuth, async (req, res) => {
  try {
    const date   = pickDate10(req.body?.date || req.body);
    const status = norm(req.body?.status || 'accepted').toLowerCase();
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

router.post('/:id(\\d+)/print/placecard', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const r = await svc.getById(id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    const out = await printerSvc.printSinglePlaceCard({ reservation: r, user: req.user });
    return res.json({ ok: true, job_id: out.jobId });
  } catch (err) {
    logger.error('❌ print/placecard', { error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

module.exports = router;
