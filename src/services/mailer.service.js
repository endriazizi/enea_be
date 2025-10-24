'use strict';

/**
 * Mailer resiliente per cambi stato prenotazioni.
 * - Gmail con App Password OK (porta 465 secure:true OPPURE 587 secure:false)
 * - Log estesi con env (masked) per diagnosi
 */

const nodemailer = require('nodemailer');
const logger = require('../logger');
const env = require('../env');

let transporter = null;

/* Helpers ------------------------------------------------------------------ */
function safe(v) {
  return (v === undefined || v === null) ? '' : String(v);
}

function statusLabelIT(s) {
  const m = {
    pending: 'in attesa',
    accepted: 'accettata',
    rejected: 'rifiutata',
    cancelled: 'cancellata',
  };
  return m[String(s || '').toLowerCase()] || String(s || 'aggiornata');
}

function buildSubject(reservation, newStatus) {
  const id = reservation?.id ?? '?';
  const biz = env.MAIL.bizName || 'Prenotazioni';
  const label = statusLabelIT(newStatus);
  return `${biz} — Prenotazione #${id} ${label}`;
}

function buildHtml({ reservation, newStatus, reason }) {
  const name =
    safe(reservation?.display_name) ||
    [safe(reservation?.customer_first), safe(reservation?.customer_last)]
      .filter(Boolean).join(' ') ||
    'Cliente';

  const dt    = safe(reservation?.start_at);
  const size  = reservation?.party_size ? Number(reservation.party_size) : '';
  const table = reservation?.table_name
    || (reservation?.table_number ? `Tavolo ${reservation.table_number}` : '');
  const statusText = statusLabelIT(newStatus);

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0 0 12px">${env.MAIL.bizName || 'La Mia Attività'}</h2>
    <p>Ciao <b>${name}</b>,</p>
    <p>Lo stato della tua prenotazione <b>#${safe(reservation?.id)}</b> per il <b>${dt}</b> (persone: <b>${size}</b>${table ? `, ${table}` : ''}) è stato aggiornato a: <b>${statusText}</b>.</p>
    ${reason ? `<p><i>Motivo: ${safe(reason)}</i></p>` : ''}
    <p>Se hai domande rispondi pure a questa email.</p>
    <p>— ${env.MAIL.bizName || 'Lo Staff'}</p>
  </div>
  `;
}

/* Transporter -------------------------------------------------------------- */
function getTransporter() {
  if (!env.MAIL.enabled) {
    logger.warn('📧 MAIL DISABLED by env', { service: 'server' });
    return null;
  }
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.MAIL.host,
    port: env.MAIL.port,
    secure: !!env.MAIL.secure, // true: 465 (SSL), false: 587 (STARTTLS)
    auth: {
      user: env.MAIL.user,
      pass: env.MAIL.pass,
    },
  });

  logger.info('📧 Transporter creato', {
    service: 'server',
    mail_env: env._debugMailConfig(),
  });

  return transporter;
}

async function verifySmtp() {
  const t = getTransporter();
  if (!t) return { ok: false, reason: 'disabled' };
  try {
    await t.verify();
    logger.info('📧 SMTP verify OK', {
      service: 'server',
      host: env.MAIL.host, port: env.MAIL.port, secure: !!env.MAIL.secure
    });
    return { ok: true };
  } catch (err) {
    logger.error('📧 SMTP verify FAILED', {
      service: 'server',
      error: String(err),
      mail_env: env._debugMailConfig(),
    });
    return { ok: false, error: err };
  }
}

/* API ---------------------------------------------------------------------- */
/**
 * Invia la mail di cambio stato.
 * @param {Object} p
 * @param {string} p.to            - destinatario (obbligatorio)
 * @param {Object} p.reservation   - snapshot prenotazione (id, start_at, etc.)
 * @param {string} p.newStatus     - stato finale (accepted/rejected/cancelled/pending)
 * @param {string} [p.reason]      - motivo (opzionale)
 * @param {string} [p.replyTo]     - reply-to (fallback a env.MAIL.replyTo)
 */
async function sendStatusChangeEmail({ to, reservation, newStatus, reason, replyTo }) {
  if (!env.MAIL.enabled) {
    logger.warn('📧 MAIL SKIPPED', {
      service: 'server',
      id: reservation?.id,
      reason: 'disabled',
      env_mail: env._debugMailConfig()
    });
    return { sent: false, reason: 'disabled' };
  }

  const dest = safe(to).trim();
  if (!dest) {
    logger.warn('📧 MAIL SKIPPED', {
      service: 'server',
      id: reservation?.id,
      reason: 'no_recipient',
      env_mail: env._debugMailConfig()
    });
    return { sent: false, reason: 'no_recipient' };
  }

  const t = getTransporter();
  if (!t) return { sent: false, reason: 'no_transporter' };

  const statusFinale = newStatus || reservation?.status || 'updated';
  const subject = buildSubject(reservation || {}, statusFinale);
  const html    = buildHtml({ reservation: reservation || {}, newStatus: statusFinale, reason });

  const mail = {
    from: env.MAIL.from,
    to: dest,
    subject,
    html,
    replyTo: safe(replyTo) || (env.MAIL.replyTo || undefined),
  };

  logger.debug('📧 MAIL OUT', {
    service: 'server',
    id: reservation?.id,
    to: dest,
    subject,
  });

  try {
    const info = await t.sendMail(mail);
    logger.info('📧 MAIL SENT', {
      service: 'server',
      id: reservation?.id,
      to: dest,
      messageId: info?.messageId
    });
    return { sent: true, messageId: info?.messageId };
  } catch (err) {
    logger.error('📧 MAIL ERROR', {
      service: 'server',
      id: reservation?.id,
      error: String(err),
      env_mail: env._debugMailConfig()
    });
    throw err;
  }
}

module.exports = {
  getTransporter,
  verifySmtp,
  sendStatusChangeEmail,
};
