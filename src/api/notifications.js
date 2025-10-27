// src/api/notifications.js
'use strict';

const express = require('express');
const router  = express.Router();

const logger = require('../logger');
const env    = require('../env');

// servizi già presenti nel tuo BE
const mailer = require('../services/mailer.service');      // ✉️
const wa     = require('../services/whatsapp.service');    // 📲 (Twilio)

/**
 * POST /api/notifications/email
 * Body: { kind: 'reservation-pending-admin' | 'reservation-pending-customer', reservation: {...} }
 */
router.post('/email', async (req, res) => {
  const kind = String(req.body?.kind || '').trim();
  const reservation = req.body?.reservation || null;

  if (!kind || !reservation) {
    return res.status(400).json({ ok: false, error: 'missing_kind_or_reservation' });
  }

  if (!env.MAIL?.enabled) {
    logger.warn('📧 notifications/email SKIP (MAIL disabled)', { kind });
    return res.json({ ok: false, reason: 'mail_disabled' });
  }

  try {
    let to, subject, html;
    const status = reservation.status || 'pending';

    if (kind === 'reservation-pending-admin') {
      to = env.MAIL?.user || env.MAIL?.from; // admin predefinito: usa SMTP_USER o MAIL_FROM
      subject = `[PENDING] Prenotazione #${reservation.id || '?'} — ${reservation.start_at || ''}`;
      html = `
        <p>C'è una nuova prenotazione <b>in attesa</b>.</p>
        <ul>
          <li>#${reservation.id || '?'}</li>
          <li>Quando: ${reservation.start_at || '-'}</li>
          <li>Cliente: ${(reservation.customer_first || '')} ${(reservation.customer_last || '')}</li>
          <li>Coperti: ${reservation.party_size || '-'}</li>
          <li>Telefono: ${reservation.phone || '-'}</li>
          <li>Email: ${reservation.email || '-'}</li>
        </ul>
      `;
    } else if (kind === 'reservation-pending-customer') {
      to = reservation.email || null;
      if (!to) {
        logger.warn('📧 pending-customer SKIP (no email)', { id: reservation.id });
        return res.json({ ok: false, reason: 'no_customer_email' });
      }
      subject = `${env.MAIL?.bizName || 'Prenotazioni'} — richiesta ricevuta`;
      html = `
        <p>Ciao ${(reservation.customer_first || '')} ${(reservation.customer_last || '')},</p>
        <p>abbiamo ricevuto la tua richiesta di prenotazione per <b>${reservation.start_at || '-'}</b> (persone: <b>${reservation.party_size || '-'}</b>).</p>
        <p>Stato attuale: <b>${String(status).toUpperCase()}</b>. Ti avviseremo appena viene confermata.</p>
      `;
    } else {
      return res.status(400).json({ ok: false, error: 'unknown_kind' });
    }

    const sent = await mailer.sendRaw({ to, subject, html });
    logger.info('📧 notifications/email ✅', { kind, to, messageId: sent?.messageId });
    return res.json({ ok: true, messageId: sent?.messageId || null });
  } catch (err) {
    logger.error('📧 notifications/email ❌', { kind, error: String(err) });
    return res.status(500).json({ ok: false, error: 'send_failed' });
  }
});

/**
 * POST /api/notifications/whatsapp/twilio
 * Body: { kind: 'reservation-pending', reservation: {...} }
 */
router.post('/whatsapp/twilio', async (req, res) => {
  const kind = String(req.body?.kind || '').trim();
  const reservation = req.body?.reservation || null;

  if (!kind || !reservation) {
    return res.status(400).json({ ok: false, error: 'missing_kind_or_reservation' });
  }

  if (!env.WA?.enabled) {
    logger.warn('📲 WA SKIP (disabled)', { kind });
    return res.json({ ok: false, reason: 'wa_disabled' });
  }

  try {
    if (kind !== 'reservation-pending') {
      return res.status(400).json({ ok: false, error: 'unknown_kind' });
    }
    // testo generico "in attesa"
    const result = await wa.sendStatusChange({
      to: reservation.phone || reservation.contact_phone || null,
      reservation,
      status: reservation.status || 'pending'
    });
    logger.info('📲 WA pending ▶️', { id: reservation.id, ok: !!result?.ok, reason: result?.reason });
    return res.json({ ok: !!result?.ok, sid: result?.sid || null, reason: result?.reason || null });
  } catch (err) {
    logger.error('📲 WA pending ❌', { error: String(err) });
    return res.status(500).json({ ok: false, error: 'wa_failed' });
  }
});

module.exports = router;
