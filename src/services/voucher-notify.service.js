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
  const sid = process.env.TWILIO_ACCOUNT_SID || env.WA?.accountSid || '';
  const token = process.env.TWILIO_AUTH_TOKEN || env.WA?.authToken || '';
  const from = process.env.SMS_FROM || process.env.TWILIO_SMS_FROM || '';
  if (!sid || !token || !from) {
    logger.warn('📱 [Voucher] SMS skipped (missing config)', { hasSid: !!sid, hasToken: !!token, hasFrom: !!from });
    return { ok: false, reason: 'missing_config' };
  }
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  let twilio;
  try {
    twilio = require('twilio')(sid, token);
  } catch (e) {
    logger.warn('📱 [Voucher] SMS skipped (twilio not available)', { error: String(e?.message || e) });
    return { ok: false, reason: 'no_twilio' };
  }

  const valueEUR = (Number(voucher?.value_cents || 0) / 100).toFixed(2);
  const validUntil = voucher?.valid_until ? fmtDateIt(voucher.valid_until) : '';
  const optUrl = buildOptOutUrl({ phone: dest, channel: 'sms' });
  const text = `Buono Regalo attivato. Valore ${valueEUR} EUR${validUntil ? `, valido fino al ${validUntil}` : ''}. Per disiscriverti rispondi STOP.${optUrl ? ` ${optUrl}` : ''}`;

  const msg = await twilio.messages.create({ from, to: dest, body: text });
  logger.info('📱 [Voucher] SMS sent', { to: dest, sid: msg?.sid });
  return { ok: true, sid: msg?.sid };
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
  const sid = process.env.TWILIO_ACCOUNT_SID || env.WA?.accountSid || '';
  const tokenEnv = process.env.TWILIO_AUTH_TOKEN || env.WA?.authToken || '';
  const from = process.env.SMS_FROM || process.env.TWILIO_SMS_FROM || '';
  if (!sid || !tokenEnv || !from) {
    logger.warn('📱 [Voucher] confirm SMS skipped (missing config)', { hasSid: !!sid, hasToken: !!tokenEnv, hasFrom: !!from });
    return { ok: false, reason: 'missing_config' };
  }
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  let twilio;
  try {
    twilio = require('twilio')(sid, tokenEnv);
  } catch (e) {
    logger.warn('📱 [Voucher] confirm SMS skipped (twilio not available)', { error: String(e?.message || e) });
    return { ok: false, reason: 'no_twilio' };
  }

  const confirmUrl = buildOptInUrl(token);
  const text = `Conferma consenso marketing: ${confirmUrl}`;
  const msg = await twilio.messages.create({ from, to: dest, body: text });
  logger.info('📱 [Voucher] confirm SMS sent', { to: dest, sid: msg?.sid });
  return { ok: true, sid: msg?.sid };
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
  const sid = process.env.TWILIO_ACCOUNT_SID || env.WA?.accountSid || '';
  const token = process.env.TWILIO_AUTH_TOKEN || env.WA?.authToken || '';
  const from = process.env.SMS_FROM || process.env.TWILIO_SMS_FROM || '';
  if (!sid || !token || !from) {
    logger.warn('📱 [Voucher] marketing SMS skipped (missing config)', { hasSid: !!sid, hasToken: !!token, hasFrom: !!from });
    return { ok: false, reason: 'missing_config' };
  }
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  let twilio;
  try {
    twilio = require('twilio')(sid, token);
  } catch (e) {
    logger.warn('📱 [Voucher] marketing SMS skipped (twilio not available)', { error: String(e?.message || e) });
    return { ok: false, reason: 'no_twilio' };
  }

  const optUrl = buildOptOutUrl({ phone: dest, channel: 'sms' });
  const text = `Consenso marketing registrato. Per revocarlo rispondi STOP.${optUrl ? ` ${optUrl}` : ''}`;
  const msg = await twilio.messages.create({ from, to: dest, body: text });
  logger.info('📱 [Voucher] marketing SMS sent', { to: dest, sid: msg?.sid });
  return { ok: true, sid: msg?.sid };
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
