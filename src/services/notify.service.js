'use strict';

/**
 * services/notify.service.js
 * -----------------------------------------------------------------------------
 * Orchestratore notifiche per ORDINI:
 * - EMAIL (riusa env.MAIL; usa nodemailer direttamente se il tuo mailer non ha metodi “order”)
 * - WHATSAPP (riusa services/whatsapp.service se presente; fallback Twilio diretto)
 */

const logger = require('../logger');
const env = require('../env');
const nodemailer = require('nodemailer');

let cachedTransport = null;
function getTransport() {
  if (cachedTransport) return cachedTransport;
  const m = env.MAIL;
  if (!m || !m.enabled) return null;
  cachedTransport = nodemailer.createTransport({
    host: m.host, port: m.port, secure: m.secure,
    auth: (m.user && m.pass) ? { user: m.user, pass: m.pass } : undefined
  });
  return cachedTransport;
}

function fmtOrderLines(order) {
  const lines = (order.items || []).map(it =>
    `• ${it.qty}× ${it.name}${it.notes ? ' (' + it.notes + ')' : ''} — € ${(Number(it.price) * Number(it.qty)).toFixed(2)}`
  );
  return lines.join('\n');
}
function subjectNew(order) {
  return `${env.MAIL?.bizName || 'Pizzeria'} — Nuovo ordine #${order.id}`;
}
function subjectStatus(order, status) {
  const lab = String(status).toUpperCase();
  return `${env.MAIL?.bizName || 'Pizzeria'} — Ordine #${order.id} ${lab}`;
}

async function sendEmailNew(order) {
  const t = getTransport();
  if (!t) {
    logger.warn('📧 email disabled, skip new-order', env._debugMailConfig());
    return { ok: false, reason: 'mail_disabled' };
  }
  const adminTo = process.env.MAIL_ADMIN || env.MAIL?.user || '';
  const customerTo = order.email || '';

  const text = [
    `Nuovo ordine #${order.id}`,
    `Cliente: ${order.customer_name || '-'}`,
    `Telefono: ${order.phone || '-'}`,
    `Email: ${order.email || '-'}`,
    `Persone: ${order.people || 1}`,
    `Programmazione: ${order.scheduled_at || '-'}`,
    `Canale: ${order.channel || 'online'}`,
    '',
    `Righe:\n${fmtOrderLines(order)}`,
    '',
    `Totale: € ${Number(order.total).toFixed(2)}`,
    '',
    `Note: ${order.note || '-'}`,
  ].join('\n');

  const opts = {
    from: env.MAIL?.from,
    to: adminTo,
    subject: subjectNew(order),
    text,
    replyTo: env.MAIL?.replyTo || undefined
  };

  const out = { admin: null, customer: null };

  try {
    out.admin = await t.sendMail(opts);
    logger.info('📧 ordine NEW → admin ✅', { id: order.id, messageId: out.admin?.messageId });
  } catch (e) {
    logger.error('📧 ordine NEW → admin ❌', { id: order.id, error: String(e) });
  }

  if (customerTo) {
    try {
      out.customer = await t.sendMail({ ...opts, to: customerTo });
      logger.info('📧 ordine NEW → customer ✅', { id: order.id, messageId: out.customer?.messageId });
    } catch (e) {
      logger.error('📧 ordine NEW → customer ❌', { id: order.id, error: String(e) });
    }
  }
  return { ok: true, out };
}

async function sendEmailStatus(order, status) {
  const t = getTransport();
  if (!t) {
    logger.warn('📧 email disabled, skip status', env._debugMailConfig());
    return { ok: false, reason: 'mail_disabled' };
  }
  const to = order.email || '';
  if (!to) return { ok: false, reason: 'no_customer_email' };

  const text = [
    `Ciao ${order.customer_name || ''},`,
    `il tuo ordine #${order.id} è ora: ${String(status).toUpperCase()}.`,
    '',
    `Righe:\n${fmtOrderLines(order)}`,
    '',
    `Totale: € ${Number(order.total).toFixed(2)}`
  ].join('\n');

  try {
    const r = await t.sendMail({
      from: env.MAIL?.from,
      to,
      subject: subjectStatus(order, status),
      text,
      replyTo: env.MAIL?.replyTo || undefined
    });
    logger.info('📧 ordine STATUS → customer ✅', { id: order.id, status, messageId: r?.messageId });
    return { ok: true, r };
  } catch (e) {
    logger.error('📧 ordine STATUS → customer ❌', { id: order.id, status, error: String(e) });
    return { ok: false, reason: String(e) };
  }
}

async function sendWhatsAppNew(order) {
  // Prova a riusare il tuo services/whatsapp.service (se presente).
  try {
    const wa = require('./whatsapp.service');
    if (typeof wa.sendText === 'function') {
      const body = `Nuovo ordine #${order.id}\n${order.customer_name || ''}\nTotale € ${Number(order.total).toFixed(2)}`;
      return await wa.sendText(order.phone, body);
    }
  } catch (_) {}

  // Fallback Twilio diretto (se WA_ENABLED e credenziali presenti)
  if (!env.WA?.enabled) return { ok: false, reason: 'wa_disabled' };
  const { accountSid, authToken, from } = env.WA;
  if (!accountSid || !authToken || !from) return { ok: false, reason: 'wa_misconfigured' };

  const twilio = require('twilio')(accountSid, authToken);
  const to = (order.phone || '').startsWith('whatsapp:') ? order.phone : `whatsapp:${order.phone}`;
  try {
    const msg = await twilio.messages.create({
      from,
      to,
      body: `Ciao! Abbiamo ricevuto il tuo ordine #${order.id}. Totale € ${Number(order.total).toFixed(2)}. Ti avviseremo sugli aggiornamenti.`
    });
    logger.info('📲 WA NEW ✅', { sid: msg.sid });
    return { ok: true, sid: msg.sid };
  } catch (e) {
    logger.error('📲 WA NEW ❌', { error: String(e) });
    return { ok: false, reason: String(e) };
  }
}

async function sendWhatsAppStatus(order, status) {
  try {
    const wa = require('./whatsapp.service');
    if (typeof wa.sendText === 'function') {
      const body = `Aggiornamento ordine #${order.id}: ${String(status).toUpperCase()}`;
      return await wa.sendText(order.phone, body);
    }
  } catch (_) {}

  if (!env.WA?.enabled) return { ok: false, reason: 'wa_disabled' };
  const { accountSid, authToken, from } = env.WA;
  if (!accountSid || !authToken || !from) return { ok: false, reason: 'wa_misconfigured' };
  const twilio = require('twilio')(accountSid, authToken);
  const to = (order.phone || '').startsWith('whatsapp:') ? order.phone : `whatsapp:${order.phone}`;
  try {
    const msg = await twilio.messages.create({
      from, to,
      body: `Aggiornamento: il tuo ordine #${order.id} è ora ${String(status).toUpperCase()}.`
    });
    logger.info('📲 WA STATUS ✅', { sid: msg.sid, status });
    return { ok: true, sid: msg.sid };
  } catch (e) {
    logger.error('📲 WA STATUS ❌', { error: String(e), status });
    return { ok: false, reason: String(e) };
  }
}

module.exports = {
  async onOrderCreated(order) {
    // Email admin + cliente
    try { await sendEmailNew(order); } catch (e) { logger.error('🔔 email NEW ❌', { error: String(e) }); }
    // WhatsApp cliente (se configurato)
    try { await sendWhatsAppNew(order); } catch (e) { logger.error('🔔 WA NEW ❌', { error: String(e) }); }
  },
  async onOrderStatus(order, status) {
    try { await sendEmailStatus(order, status); } catch (e) { logger.error('🔔 email STATUS ❌', { error: String(e) }); }
    try { await sendWhatsAppStatus(order, status); } catch (e) { logger.error('🔔 WA STATUS ❌', { error: String(e) }); }
  }
};
