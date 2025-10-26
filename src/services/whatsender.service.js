'use strict';

// services/whatsender.service.js — adapter stile api2.whatsender.it (stub sicuro)
// Qui non chiamiamo nulla in esterno: forniamo le stesse funzioni di Twilio
// per permettere il wiring BE → se deciderai il vero endpoint, basta
// rimpiazzare l'HTTP client qui dentro.

const logger = require('../logger');

async function sendOrder({ to, order }) {
  logger.info('🟧 [Whatsender] sendOrder (stub)', { to, orderId: order?.id });
  return { ok: true, sid: 'stub-' + order?.id };
}

async function sendOrderStatus({ to, order, status }) {
  logger.info('🟧 [Whatsender] sendOrderStatus (stub)', { to, orderId: order?.id, status });
  return { ok: true, sid: 'stub-status-' + order?.id };
}

module.exports = { sendOrder, sendOrderStatus };
