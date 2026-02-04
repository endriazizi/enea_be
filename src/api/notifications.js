'use strict';

/**
 * api/notifications.js
 * -----------------------------------------------------------------------------
 * Rotte notifiche: Email + WhatsApp (Twilio)
 *
 * ✅ Nota importante WhatsApp:
 * - Free-text (body) è consentito SOLO dentro la finestra 24h (sessione).
 * - Fuori 24h devi usare un TEMPLATE approvato.
 * - Qui aggiungiamo:
 *    1) POST /wa/send                       -> free-text (bloccato fuori 24h se abilitato)
 *    2) POST /wa/template/reservation-confirm -> invio TEMPLATE Quick Reply (apre finestra 24h)
 *    3) POST /wa/inbound                    -> webhook Twilio inbound (tap bottoni / reply)
 *    4) POST /wa/status                     -> status callback Twilio (delivered/failed ecc.)
 *
 * Stile: log emoji + best-effort + non rompiamo le logiche esistenti.
 */

const express = require('express');
const router = express.Router();

const logger = require('../logger');
const env    = require('../env');

const mailer = require('../services/mailer.service');
const wa     = require('../services/whatsapp.service');

// Prenotazioni (per aggiornare stato da tap WhatsApp)
const reservationsSvc     = require('../services/reservations.service');
const reservationsActions = require('../services/reservations-status.service');

// ----------------------------------------------------------------------------
// Auth middleware (fallback DEV se non disponibile)
// ----------------------------------------------------------------------------
let requireAuth = (req, res, next) => next();
try {
  // eslint-disable-next-line global-require
  ({ requireAuth } = require('../middleware/auth'));
  logger.info('🔐 requireAuth caricato da ../middleware/auth', { service: 'server' });
} catch (e) {
  logger.warn('⚠️ requireAuth NON trovato (DEV bypass).', { service: 'server', error: String(e) });
}

// ----------------------------------------------------------------------------
// safeRoute helper (stile tuo)
// ----------------------------------------------------------------------------
function safeRoute(name, fn) {
  return async (req, res) => {
    try {
      const out = await fn(req, res);
      return out;
    } catch (e) {
      logger.error(`❌ notifications.${name} crash`, { service: 'server', error: String(e) });
      return res.status(500).json({ ok: false, error: String(e) });
    }
  };
}

// ----------------------------------------------------------------------------
// HEALTH
// ----------------------------------------------------------------------------
router.get('/health', safeRoute('health', async (req, res) => {
  return res.json({
    ok: true,
    mail: {
      enabled: !!env.MAIL?.enabled,
      host: env.MAIL?.smtpHost ? '[set]' : '',
    },
    wa: wa.health ? wa.health() : { note: 'wa.health() missing' }
  });
}));

// ----------------------------------------------------------------------------
// MAIL TEST (protetta)
// ----------------------------------------------------------------------------
router.post('/mail/test', requireAuth, safeRoute('mail.test', async (req, res) => {
  const to = req.body?.to || env.MAIL?.replyTo || env.MAIL?.from || null;
  if (!to) return res.status(400).json({ ok: false, error: 'missing_to' });

  const out = await mailer.sendTestEmail?.({ to }) // se esiste
    .catch(() => null);

  if (!out) {
    // fallback minimale: invio “status change” finto
    await mailer.sendStatusChangeEmail?.({
      to,
      reservation: { id: 0, start_at: new Date().toISOString(), party_size: 2 },
      status: 'TEST',
      reason: 'Email test'
    });
  }

  return res.json({ ok: true });
}));

// ----------------------------------------------------------------------------
// POST /whatsapp/twilio — FE invia { kind: 'reservation-pending', reservation } o { kind: 'order-created', order }
// Se Twilio disabilitato: 200 { ok: true, disabled: true } (no regressione FE)
// ----------------------------------------------------------------------------
router.post('/whatsapp/twilio', requireAuth, safeRoute('whatsapp.twilio', async (req, res) => {
  const kind = req.body?.kind || null;
  const reservation = req.body?.reservation || null;
  const order = req.body?.order || null;

  if (kind === 'reservation-pending' && reservation) {
    const phone = reservation.contact_phone || reservation.phone || null;
    const name = [reservation.customer_first, reservation.customer_last].filter(Boolean).join(' ') || reservation.display_name || 'Cliente';
    const start = reservation.start_at ? new Date(reservation.start_at) : null;
    const dateStr = start ? new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(start) : '';
    const timeStr = start ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}` : '';
    const peopleStr = reservation.party_size != null ? String(reservation.party_size) : '';
    const out = await wa.sendReservationConfirmTemplate({
      to: phone,
      name,
      dateStr,
      timeStr,
      peopleStr,
      reservationId: reservation.id || null,
    });
    return res.json(out);
  }

  if (kind === 'order-created' && order) {
    const to = order.customer_phone || order.phone || order.contact_phone || null;
    const text = (req.body?.text || 'Ordine ricevuto. Grazie.').toString().trim();
    const out = await wa.sendText({ to, text });
    return res.json(out);
  }

  return res.status(400).json({ ok: false, error: 'missing_kind_or_payload' });
}));

// ----------------------------------------------------------------------------
// WA FREE TEXT (protetta) - dentro finestra 24h (se blocco attivo)
// ----------------------------------------------------------------------------
router.post('/wa/send', requireAuth, safeRoute('wa.send', async (req, res) => {
  const to       = req.body?.to || null;
  const text     = req.body?.text || req.body?.body || null;
  const mediaUrl = req.body?.mediaUrl ?? null;

  // Se vuoi forzare invio anche fuori finestra (sconsigliato): allowOutsideWindow=true
  const allowOutsideWindow = !!req.body?.allowOutsideWindow;

  const out = await wa.sendText({
    to,
    text,
    mediaUrl,
    allowOutsideWindow
  });

  return res.json(out);
}));

// ----------------------------------------------------------------------------
// WA TEMPLATE: prenotazione conferma (protetta)
// ----------------------------------------------------------------------------
router.post('/wa/template/reservation-confirm', requireAuth, safeRoute('wa.template.reservationConfirm', async (req, res) => {
  const to           = req.body?.to || null;
  const name         = req.body?.name || null;
  const dateStr      = req.body?.dateStr || req.body?.date || null;   // es "mercoledì 21/01/2026"
  const timeStr      = req.body?.timeStr || req.body?.time || null;   // es "20:30"
  const peopleStr    = req.body?.peopleStr || req.body?.people || req.body?.partySize || null;
  const reservationId = req.body?.reservationId || null;

  const out = await wa.sendReservationConfirmTemplate({
    to,
    name,
    dateStr,
    timeStr,
    peopleStr,
    reservationId
  });

  return res.json(out);
}));

// ----------------------------------------------------------------------------
// WEBHOOK Twilio INBOUND (PUBBLICA)
// ⚠️ Twilio manda x-www-form-urlencoded: usiamo express.urlencoded solo su questa route
// ----------------------------------------------------------------------------
router.post('/wa/inbound',
  express.urlencoded({ extended: false }),
  safeRoute('wa.inbound', async (req, res) => {
    const out = await wa.handleInboundWebhook(req.body || {});

    // ✅ Se riconosciamo un tap su template collegato a reservationId -> aggiorniamo stato
    if (out?.action && out?.reservationId) {
      const id = Number(out.reservationId);
      const action = String(out.action);

      logger.info('🧩 WA tap -> aggiorno prenotazione', { service: 'server', id, action });

      // Mapping azioni:
      // - confirm -> accepted
      // - cancel  -> cancelled
      const mappedAction = (action === 'confirm') ? 'accept' : (action === 'cancel' ? 'cancel' : null);

      if (mappedAction) {
        await reservationsActions.updateStatus({
          id,
          action: mappedAction,
          reason: `WA tap: ${action}`,
          user_email: 'wa:webhook'
        });

        // Ricarico la prenotazione “bella” (per broadcast + notify)
        const reservation = await reservationsSvc.getById(id).catch(() => null);

        if (reservation) {
          // Best-effort notify (email + WA status change)
          try {
            if (reservation.contact_email) {
              await mailer.sendStatusChangeEmail?.({
                to: reservation.contact_email,
                reservation,
                status: reservation.status,
                reason: `Confermato da WhatsApp (${action})`
              });
            }
          } catch (e) {
            logger.warn('⚠️ Email status change fallita (ok)', { service: 'server', error: String(e) });
          }

          try {
            if (reservation.contact_phone) {
              await wa.sendStatusChange({
                to: reservation.contact_phone,
                reservation,
                status: reservation.status,
                reason: `Confermato da WhatsApp (${action})`
              });
            }
          } catch (e) {
            logger.warn('⚠️ WA status change fallito (ok)', { service: 'server', error: String(e) });
          }

          // Broadcast realtime (se io è disponibile)
          try {
            const io = req.app?.get('io');
            if (io) {
              io.to('admins').emit('reservation-updated', reservation);
              logger.info('📡 Socket reservation-updated', { service: 'server', id: reservation.id });
            }
          } catch (e) {
            logger.warn('⚠️ Socket broadcast fallito (ok)', { service: 'server', error: String(e) });
          }
        }
      }
    }

    // ✅ Risposta “safe” per Twilio (va bene anche 200 vuoto, ma così è pulito)
    res.set('Content-Type', 'text/xml');
    return res.status(200).send('<Response></Response>');
  })
);

// ----------------------------------------------------------------------------
// STATUS CALLBACK Twilio (PUBBLICA)
// ----------------------------------------------------------------------------
router.post('/wa/status',
  express.urlencoded({ extended: false }),
  safeRoute('wa.status', async (req, res) => {
    const messageSid    = req.body?.MessageSid || null;
    const messageStatus = req.body?.MessageStatus || null;
    const errorCode     = req.body?.ErrorCode || null;
    const errorMessage  = req.body?.ErrorMessage || null;

    await wa.updateWaMessageStatus?.(messageSid, messageStatus, errorCode, errorMessage, req.body);

    res.set('Content-Type', 'text/xml');
    return res.status(200).send('<Response></Response>');
  })
);

module.exports = router;
