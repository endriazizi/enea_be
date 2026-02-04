'use strict';

/**
 * api/whatsapp-templates.js
 * -----------------------------------------------------------------------------
 * Router per template WhatsApp prenotazione:
 * - GET /templates/reservation-received/preview — anteprima testo (debug + FE compose)
 * - POST /send/reservation-received — invio messaggio prenotazione ricevuta
 *
 * Mount: app.use('/api/whatsapp', require('./api/whatsapp-templates'))
 */

const express = require('express');
const router = express.Router();

const logger = require('../logger');
const env = require('../env');
const {
  buildReservationReceivedMessage,
  getMapsUrl,
} = require('../utils/whatsapp-templates');

const reservationsSvc = require('../services/reservations.service');
const waService = require('../services/whatsapp.service');
const webqrService = require('../services/whatsapp-webqr.service');
const twilioService = require('../services/twilio.service');

// ----------------------------------------------------------------------------
// Auth middleware (fallback DEV)
// ----------------------------------------------------------------------------
let requireAuth = (req, res, next) => next();
try {
  ({ requireAuth } = require('../middleware/auth'));
} catch (_) {}

// ----------------------------------------------------------------------------
// GET /templates/reservation-received/preview
// Query: name, date, time, people (opzionali) — per test e FE compose
// Risponde: { ok, text, mapsUrl, brand }
// ----------------------------------------------------------------------------
router.get('/templates/reservation-received/preview', requireAuth, (req, res) => {
  const name = (req.query.name || '').toString().trim() || 'Cliente';
  const date = (req.query.date || '').toString().trim() || '04/02';
  const time = (req.query.time || '').toString().trim() || '18:30';
  const people = Math.max(0, Math.floor(Number(req.query.people) || 2));

  const payload = {
    customerName: name,
    dateStr: date,
    timeStr: time,
    people,
  };

  const cfg = env.WHATSAPP_TEMPLATE || {};
  const text = buildReservationReceivedMessage(payload, cfg);
  const mapsUrl = getMapsUrl(cfg);

  // Formato telefono umano
  const brandPhone = (cfg.brandPhone || '0737642142').toString();
  const phoneFormatted = brandPhone.length >= 6
    ? `${brandPhone.slice(0, 4)} ${brandPhone.slice(4)}`
    : brandPhone;

  return res.json({
    ok: true,
    text,
    mapsUrl,
    brand: {
      name: cfg.brandName || 'Pizzeria La Lanterna',
      city: cfg.brandCity || 'Castelraimondo',
      phone: phoneFormatted,
      addressLine: cfg.brandAddressLine || 'Largo della Libertà, 4',
    },
  });
});

// ----------------------------------------------------------------------------
// POST /send/reservation-received
// Body: { to: "39339...", reservationId: 123 }
// Recupera prenotazione dal DB, compone testo, invia via WebQR o Twilio.
// Se entrambi disabilitati: 200 { ok: true, disabled: true, textPreview }
// ----------------------------------------------------------------------------
router.post('/send/reservation-received', requireAuth, async (req, res) => {
  const to = (req.body?.to || '').toString().trim();
  const reservationId = Number(req.body?.reservationId);

  if (!to) {
    return res.status(400).json({ ok: false, error: 'missing_to' });
  }

  let reservation = null;
  if (reservationId && Number.isFinite(reservationId)) {
    try {
      reservation = await reservationsSvc.getById(reservationId);
    } catch (e) {
      logger.warn('🧩 [WA-TPL] reservation not found', { reservationId, error: String(e) });
    }
  }

  // Payload per builder: da reservation o da body
  const payload = reservation
    ? {
        customer_first: reservation.customer_first,
        customer_last: reservation.customer_last,
        display_name: reservation.display_name,
        start_at: reservation.start_at,
        party_size: reservation.party_size,
        reservationId: reservation.id,
      }
    : {
        customerName: req.body?.name || 'Cliente',
        dateStr: req.body?.date || '--/--',
        timeStr: req.body?.time || '--:--',
        people: Math.max(0, Math.floor(Number(req.body?.people) || 1)),
      };

  const cfg = env.WHATSAPP_TEMPLATE || {};
  const text = buildReservationReceivedMessage(payload, cfg);
  const customerName = payload.customer_first && payload.customer_last
    ? `${payload.customer_first} ${payload.customer_last}`.trim()
    : payload.customerName || payload.display_name || '';

  logger.info('🧩 [WA-TPL] reservation-received built', {
    to: `${String(to).slice(0, 6)}…`,
    name: customerName || '(no-name)',
    preview: text.length > 80 ? `${text.slice(0, 80)}…` : text,
  });

  const webqrEnabled = String(process.env.WHATSAPP_WEBQR_ENABLED || '0') === '1';
  const twilioEnabled = twilioService?.isTwilioEnabled?.() ?? false;

  // 1) Prova WebQR (se abilitato e connesso)
  if (webqrEnabled && webqrService?.enabled?.()) {
    try {
      const st = webqrService.getStatus?.();
      if (st?.status === 'open') {
        const result = await webqrService.send({ to, text });
        if (result?.msgId) {
          logger.info('📲 [WA-TPL] inviato via WebQR', { to: `${to.slice(0, 6)}…`, msgId: result.msgId });
          return res.json({ ok: true, sent: true, channel: 'webqr', msgId: result.msgId });
        }
      }
    } catch (e) {
      logger.warn('📲 [WA-TPL] WebQR send KO (fallback Twilio)', { error: String(e) });
    }
  }

  // 2) Prova Twilio (se abilitato)
  if (twilioEnabled && waService?.sendText) {
    try {
      const result = await waService.sendText({
        to,
        text,
        allowOutsideWindow: true, // messaggio iniziale prenotazione
      });
      if (result?.ok && !result?.skipped) {
        logger.info('📲 [WA-TPL] inviato via Twilio', { to: `${to.slice(0, 6)}…`, sid: result?.sid });
        return res.json({ ok: true, sent: true, channel: 'twilio', sid: result?.sid });
      }
      if (result?.disabled) {
        logger.info('🛑 [WA-TPL] Twilio disabled — skip send');
        return res.json({
          ok: true,
          disabled: true,
          textPreview: text.length > 80 ? `${text.slice(0, 80)}…` : text,
        });
      }
    } catch (e) {
      logger.warn('📲 [WA-TPL] Twilio send KO', { error: String(e) });
    }
  }

  // 3) Entrambi disabilitati o falliti
  logger.info('🛑 [WA-TPL] canali disabilitati — skip send', {
    webqrEnabled,
    twilioEnabled,
  });
  return res.json({
    ok: true,
    disabled: true,
    textPreview: text.length > 80 ? `${text.slice(0, 80)}…` : text,
  });
});

module.exports = router;
