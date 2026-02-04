// ============================================================================
// voucher-notify.service.js
// - Email + SMS conferma attivazione buono regalo (best-effort)
// - Stile: commenti 🇮🇹 + log con emoji
// ============================================================================

'use strict';

const nodemailer = require('nodemailer');
const logger = require('../logger');
const env = require('../env');
const wa = require('./whatsapp.service');
const twilioService = require('./twilio.service');

let _transport = null;
function getTransporter() {
  if (!env.MAIL?.enabled) return null;
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host  : env.MAIL.host,
    port  : Number(env.MAIL.port || 587),
    secure: !!env.MAIL.secure,
    auth  : { user: env.MAIL.user, pass: env.MAIL.pass },
  });
  return _transport;
}

function fmtDateIt(isoLike) {
  try {
    const d = isoLike ? new Date(isoLike) : new Date();
    if (Number.isNaN(d.getTime())) return String(isoLike || '');
    return new Intl.DateTimeFormat('it-IT', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return String(isoLike || '');
  }
}

function buildOptOutUrl(params = {}) {
  const base =
    process.env.PUBLIC_BASE_URL ||
    env.WA?.webhookBaseUrl ||
    '';
  if (!base) return null;
  const qp = new URLSearchParams();
  if (params.email) qp.set('email', String(params.email));
  if (params.phone) qp.set('phone', String(params.phone));
  if (params.channel) qp.set('channel', String(params.channel));
  return `${base.replace(/\/+$/, '')}/optout?${qp.toString()}`;
}

function buildOptInUrl(token) {
  const base =
    process.env.PUBLIC_BASE_URL ||
    env.WA?.webhookBaseUrl ||
    '';
  if (!base || !token) return null;
  const qp = new URLSearchParams({ token: String(token) });
  return `${base.replace(/\/+$/, '')}/optin?${qp.toString()}`;
}

async function sendActivationEmail({ to, voucher, contact }) {
  if (!env.MAIL?.enabled) {
    logger.warn('📧 [Voucher] email skipped (disabled)');
    return { ok: false, reason: 'disabled' };
  }
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  const t = getTransporter();
  if (!t) return { ok: false, reason: 'no_transporter' };

  const biz = env.MAIL?.bizName || 'La tua attività';
  const subject = `${biz} — Attivazione Buono Regalo`;
  const name = [contact?.customer_first, contact?.customer_last].filter(Boolean).join(' ') || 'Cliente';
  const valueEUR = (Number(voucher?.value_cents || 0) / 100).toFixed(2);
  const validUntil = voucher?.valid_until ? fmtDateIt(voucher.valid_until) : '';
  const optUrl = buildOptOutUrl({ email: dest, channel: 'email' });

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0 0 12px">${biz}</h2>
    <p>Ciao <b>${name}</b>,</p>
    <p>Il tuo <b>Buono Regalo</b> è stato attivato correttamente.</p>
    <p><b>Valore:</b> ${valueEUR} EUR</p>
    ${validUntil ? `<p><b>Valido fino al:</b> ${validUntil}</p>` : ''}
    <p>Conserva questo messaggio per qualsiasi necessità.</p>
    ${optUrl ? `<p style="font-size:12px">Per disiscriverti: <a href="${optUrl}">${optUrl}</a></p>` : ''}
    <p>— ${biz}</p>
  </div>`;

  const mail = {
    from: env.MAIL.from,
    to: dest,
    subject,
    html,
    replyTo: env.MAIL.replyTo || undefined,
  };

  const info = await t.sendMail(mail);
  logger.info('📧 [Voucher] email sent', { to: dest, messageId: info?.messageId });
  return { ok: true, messageId: info?.messageId };
}

async function sendActivationSms({ to, voucher }) {
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  const valueEUR = (Number(voucher?.value_cents || 0) / 100).toFixed(2);
  const validUntil = voucher?.valid_until ? fmtDateIt(voucher.valid_until) : '';
  const optUrl = buildOptOutUrl({ phone: dest, channel: 'sms' });
  const text = `Buono Regalo attivato. Valore ${valueEUR} EUR${validUntil ? `, valido fino al ${validUntil}` : ''}. Per disiscriverti rispondi STOP.${optUrl ? ` ${optUrl}` : ''}`;

  const res = await twilioService.sendSms({ to: dest, body: text, meta: { kind: 'voucher_activation' } });
  if (res.disabled) return { ok: true, disabled: true };
  if (res.simulated) return { ok: true, simulated: true, sid: null };
  if (!res.ok) return { ok: false, reason: res.reason || res.lastError || 'twilio_error' };
  logger.info('📱 [Voucher] SMS sent', { to: dest, sid: res.sid ? res.sid.slice(0, 10) + '…' : '' });
  return { ok: true, sid: res.sid };
}

async function sendMarketingConfirmEmail({ to, contact, token }) {
  if (!env.MAIL?.enabled) {
    logger.warn('📧 [Voucher] confirm email skipped (disabled)');
    return { ok: false, reason: 'disabled' };
  }
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  const t = getTransporter();
  if (!t) return { ok: false, reason: 'no_transporter' };

  const biz = env.MAIL?.bizName || 'La tua attività';
  const subject = `${biz} — Conferma consenso marketing`;
  const name = [contact?.customer_first, contact?.customer_last].filter(Boolean).join(' ') || 'Cliente';
  const confirmUrl = buildOptInUrl(token);

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0 0 12px">${biz}</h2>
    <p>Ciao <b>${name}</b>,</p>
    <p>Per confermare il consenso marketing, clicca qui:</p>
    <p><a href="${confirmUrl}">${confirmUrl}</a></p>
    <p>Se non sei stato tu, ignora questo messaggio.</p>
    <p>— ${biz}</p>
  </div>`;

  const mail = {
    from: env.MAIL.from,
    to: dest,
    subject,
    html,
    replyTo: env.MAIL.replyTo || undefined,
  };

  const info = await t.sendMail(mail);
  logger.info('📧 [Voucher] confirm email sent', { to: dest, messageId: info?.messageId });
  return { ok: true, messageId: info?.messageId };
}

async function sendMarketingConfirmSms({ to, token }) {
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  const confirmUrl = buildOptInUrl(token);
  const text = `Conferma consenso marketing: ${confirmUrl}`;
  const res = await twilioService.sendSms({ to: dest, body: text, meta: { kind: 'voucher_confirm_sms' } });
  if (res.disabled) return { ok: true, disabled: true };
  if (res.simulated) return { ok: true, simulated: true, sid: null };
  if (!res.ok) return { ok: false, reason: res.reason || res.lastError || 'twilio_error' };
  logger.info('📱 [Voucher] confirm SMS sent', { to: dest, sid: res.sid ? res.sid.slice(0, 10) + '…' : '' });
  return { ok: true, sid: res.sid };
}

async function sendMarketingConfirmWhatsapp({ to, token }) {
  const confirmUrl = buildOptInUrl(token);
  const text = `Conferma consenso marketing: ${confirmUrl}`;
  const res = await wa.sendText({ to, text });
  return res;
}

async function sendMarketingOptInEmail({ to, contact }) {
  if (!env.MAIL?.enabled) {
    logger.warn('📧 [Voucher] marketing email skipped (disabled)');
    return { ok: false, reason: 'disabled' };
  }
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  const t = getTransporter();
  if (!t) return { ok: false, reason: 'no_transporter' };

  const biz = env.MAIL?.bizName || 'La tua attività';
  const subject = `${biz} — Consenso marketing ricevuto`;
  const name = [contact?.customer_first, contact?.customer_last].filter(Boolean).join(' ') || 'Cliente';
  const optUrl = buildOptOutUrl({ email: dest, channel: 'email' });

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0 0 12px">${biz}</h2>
    <p>Ciao <b>${name}</b>,</p>
    <p>Abbiamo registrato il tuo <b>consenso marketing</b>.</p>
    <p>Potrai ricevere comunicazioni promozionali.</p>
    ${optUrl ? `<p style="font-size:12px">Per disiscriverti: <a href="${optUrl}">${optUrl}</a></p>` : '<p style="font-size:12px">Per disiscriverti rispondi a questa email.</p>'}
    <p>— ${biz}</p>
  </div>`;

  const mail = {
    from: env.MAIL.from,
    to: dest,
    subject,
    html,
    replyTo: env.MAIL.replyTo || undefined,
  };

  const info = await t.sendMail(mail);
  logger.info('📧 [Voucher] marketing email sent', { to: dest, messageId: info?.messageId });
  return { ok: true, messageId: info?.messageId };
}

async function sendMarketingOptInSms({ to }) {
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  const optUrl = buildOptOutUrl({ phone: dest, channel: 'sms' });
  const text = `Consenso marketing registrato. Per revocarlo rispondi STOP.${optUrl ? ` ${optUrl}` : ''}`;
  const res = await twilioService.sendSms({ to: dest, body: text, meta: { kind: 'voucher_marketing_optin' } });
  if (res.disabled) return { ok: true, disabled: true };
  if (res.simulated) return { ok: true, simulated: true, sid: null };
  if (!res.ok) return { ok: false, reason: res.reason || res.lastError || 'twilio_error' };
  logger.info('📱 [Voucher] marketing SMS sent', { to: dest, sid: res.sid ? res.sid.slice(0, 10) + '…' : '' });
  return { ok: true, sid: res.sid };
}

async function sendMarketingOptInWhatsapp({ to }) {
  const optUrl = buildOptOutUrl({ phone: to, channel: 'whatsapp' });
  const text = `Consenso marketing registrato. Per revocarlo rispondi STOP.${optUrl ? ` ${optUrl}` : ''}`;
  const res = await wa.sendText({ to, text });
  return res;
}

module.exports = {
  sendActivationEmail,
  sendActivationSms,
  sendMarketingConfirmEmail,
  sendMarketingConfirmSms,
  sendMarketingConfirmWhatsapp,
  sendMarketingOptInEmail,
  sendMarketingOptInSms,
  sendMarketingOptInWhatsapp,
};
