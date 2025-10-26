'use strict';

/**
 * Mailer resiliente per cambi stato prenotazioni.
 * - Gmail con App Password OK (465 secure:true OPPURE 587 secure:false)
 * - Log estesi con env (masked) per diagnosi
 */

const nodemailer = require('nodemailer');
const logger = require('../logger');
const env    = require('../env');

let transporter = null;

/* Helpers ------------------------------------------------------------------ */
function safe(v) { return (v === undefined || v === null) ? '' : String(v); }

function statusLabelIT(s) {
  const m = { pending:'in attesa', accepted:'accettata', rejected:'rifiutata', cancelled:'cancellata' };
  return m[String(s || '').toLowerCase()] || String(s || 'aggiornata');
}

function buildSubject(reservation, newStatus) {
  const id = reservation?.id ?? '?';
  const biz = env.MAIL?.bizName || 'Prenotazioni';
  const label = statusLabelIT(newStatus);
  return `${biz} — Prenotazione #${id} ${label}`;
}

function buildStatusHtml({ reservation, newStatus, reason }) {
  const name =
    safe(reservation?.display_name) ||
    [safe(reservation?.customer_first), safe(reservation?.customer_last)].filter(Boolean).join(' ') ||
    'Cliente';

  const dt    = safe(reservation?.start_at);
  const size  = reservation?.party_size ? Number(reservation.party_size) : '';
  const table = reservation?.table_name
    || (reservation?.table_number ? `Tavolo ${reservation.table_number}` : '');
  const statusText = statusLabelIT(newStatus);

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0 0 12px">${env.MAIL?.bizName || 'La Mia Attività'}</h2>
    <p>Ciao <b>${name}</b>,</p>
    <p>Lo stato della tua prenotazione <b>#${safe(reservation?.id)}</b> per il <b>${dt}</b> (persone: <b>${size}</b>${table ? `, ${table}` : ''}) è stato aggiornato a: <b>${statusText}</b>.</p>
    ${reason ? `<p><i>Motivo: ${safe(reason)}</i></p>` : ''}
    <p>Se hai domande rispondi pure a questa email.</p>
    <p>— ${env.MAIL?.bizName || 'Lo Staff'}</p>
  </div>`;
}

function buildRejectHtml({ reservation, reason }) {
  const name =
    safe(reservation?.display_name) ||
    [safe(reservation?.customer_first), safe(reservation?.customer_last)].filter(Boolean).join(' ') ||
    'Cliente';

  const dt    = safe(reservation?.start_at);
  const size  = reservation?.party_size ? Number(reservation.party_size) : '';
  const table = reservation?.table_name
    || (reservation?.table_number ? `Tavolo ${reservation.table_number}` : '');

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0 0 12px">${env.MAIL?.bizName || 'La Mia Attività'}</h2>
    <p>Ciao <b>${name}</b>,</p>
    <p>Ci dispiace, la tua prenotazione <b>#${safe(reservation?.id)}</b> per il <b>${dt}</b> (persone: <b>${size}</b>${table ? `, ${table}` : ''}) è stata <b>rifiutata</b>.</p>
    ${reason ? `<p><i>Motivo: ${safe(reason)}</i></p>` : ''}
    <p>Per qualsiasi esigenza puoi rispondere a questa email.</p>
    <p>— ${env.MAIL?.bizName || 'Lo Staff'}</p>
  </div>`;
}

/* Transporter -------------------------------------------------------------- */
function getTransporter() {
  if (!env.MAIL?.enabled) {
    logger.warn('📧 MAIL DISABLED by env', { service: 'server' });
    return null;
  }
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host  : env.MAIL.host,
    port  : Number(env.MAIL.port || 465),
    secure: !!env.MAIL.secure,
    auth  : { user: env.MAIL.user, pass: env.MAIL.pass }
  });

  return transporter;
}

async function verifySmtp() {
  const t = getTransporter();
  if (!t) return { ok: false, reason: 'disabled' };
  try {
    await t.verify();
    logger.info('📧 SMTP verify OK', { env: env._debugMailConfig?.() });
    return { ok: true };
  } catch (err) {
    logger.error('📧 SMTP verify FAILED', { error: String(err), env: env._debugMailConfig?.() });
    return { ok: false, error: String(err) };
  }
}

/* API ----------------------------------------------------------------------- */
async function sendStatusChangeEmail({ to, reservation, newStatus, reason, replyTo }) {
  if (!env.MAIL?.enabled) {
    logger.warn('📧 MAIL SKIPPED (disabled)', { id: reservation?.id });
    return { sent: false, reason: 'disabled' };
  }

  const dest = safe(to).trim();
  if (!dest) {
    logger.warn('📧 MAIL SKIPPED (no_recipient)', { id: reservation?.id, env_mail: env._debugMailConfig?.() });
    return { sent: false, reason: 'no_recipient' };
  }

  const t = getTransporter();
  if (!t) return { sent: false, reason: 'no_transporter' };

  const subject = buildSubject(reservation || {}, newStatus || reservation?.status || 'updated');
  const html    = buildStatusHtml({ reservation: reservation || {}, newStatus, reason });

  const mail = {
    from   : env.MAIL.from,
    to     : dest,
    subject,
    html,
    replyTo: safe(replyTo) || (env.MAIL.replyTo || undefined),
  };

  logger.debug('📧 MAIL OUT', { id: reservation?.id, to: dest, subject });
  const info = await t.sendMail(mail);
  logger.info('📧 MAIL SENT', { id: reservation?.id, to: dest, messageId: info?.messageId });
  return { sent: true, messageId: info?.messageId };
}

async function sendReservationRejectionEmail({ to, reservation, reason, replyTo }) {
  if (!env.MAIL?.enabled) {
    logger.warn('📧 MAIL SKIPPED (disabled)', { id: reservation?.id });
    return { sent: false, reason: 'disabled' };
  }
  const dest = safe(to).trim();
  if (!dest) {
    logger.warn('📧 MAIL SKIPPED (no_recipient)', { id: reservation?.id });
    return { sent: false, reason: 'no_recipient' };
  }
  const t = getTransporter();
  if (!t) return { sent: false, reason: 'no_transporter' };

  const subject = (env.MAIL?.bizName || 'Prenotazioni') + ` — Prenotazione #${reservation?.id} rifiutata`;
  const html    = buildRejectHtml({ reservation, reason });

  const mail = {
    from: env.MAIL.from,
    to: dest,
    subject,
    html,
    replyTo: safe(replyTo) || (env.MAIL.replyTo || undefined),
  };

  logger.debug('📧 MAIL OUT (reject)', { id: reservation?.id, to: dest, subject });
  const info = await t.sendMail(mail);
  logger.info('📧 MAIL SENT (reject)', { id: reservation?.id, to: dest, messageId: info?.messageId });
  return { sent: true, messageId: info?.messageId };
}

module.exports = {
  getTransporter,
  verifySmtp,
  sendStatusChangeEmail,
  sendReservationRejectionEmail,
};
