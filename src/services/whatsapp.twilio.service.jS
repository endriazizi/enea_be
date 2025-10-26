'use strict';

// services/whatsapp.twilio.service.js — Twilio adapter
// Richiede: WA_ENABLED=true, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, WA_FROM='whatsapp:+39...'

const env    = require('../env');
const logger = require('../logger');

let twilio = null;
try { twilio = require('twilio'); } catch {
  logger.warn('📲 twilio package non installato; eseguire: npm i twilio@5');
}

function cli() {
  if (!twilio) throw new Error('twilio_module_missing');
  if (!env.WA?.accountSid || !env.WA?.authToken) throw new Error('twilio_env_missing');
  return twilio(env.WA.accountSid, env.WA.authToken);
}

function fmtWa(to) {
  const t = String(to).trim();
  if (t.startsWith('whatsapp:')) return t;
  const cc = env.WA?.defaultCc || '+39';
  const norm = t.startsWith('+') ? t : cc + t.replace(/\D+/g, '');
  return 'whatsapp:' + norm;
}

async function sendOrder({ to, order }) {
  if (!env.WA?.enabled) return { ok: false, reason: 'disabled' };
  const c = cli();
  const msg =
    `Grazie ${order.customer_name}!\n` +
    `Ordine #${order.id} ricevuto.\n` +
    `Totale: € ${order.total}\n` +
    `Vi aggiorneremo sullo stato.`;

  const r = await c.messages.create({
    from: env.WA.from, to: fmtWa(to), body: msg,
    mediaUrl: env.WA.mediaLogo ? [env.WA.mediaLogo] : undefined
  });
  logger.info('📲 Twilio WA sent', { sid: r.sid, to: fmtWa(to) });
  return { ok: true, sid: r.sid };
}

async function sendOrderStatus({ to, order, status }) {
  if (!env.WA?.enabled) return { ok: false, reason: 'disabled' };
  const c = cli();
  const msg = `Aggiornamento ordine #${order.id}: ${status.toUpperCase()}`;
  const r = await c.messages.create({ from: env.WA.from, to: fmtWa(to), body: msg });
  logger.info('📲 Twilio WA status sent', { sid: r.sid, to: fmtWa(to), status });
  return { ok: true, sid: r.sid };
}

module.exports = { sendOrder, sendOrderStatus };
