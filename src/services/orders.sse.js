'use strict';

/**
 * services/orders.sse.js
 * -----------------------------------------------------------------------------
 * Semplice broadcaster SSE in-memory.
 * - add(res): registra un client
 * - remove(res): deregistra
 * - broadcast(event, payload): invia a tutti
 */

const logger = require('../logger');

const clients = new Set();

function add(res) {
  clients.add(res);
  logger.info('🧵 SSE client +1', { total: clients.size });
}
function remove(res) {
  clients.delete(res);
  logger.info('🧵 SSE client -1', { total: clients.size });
}
function send(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    // client probabilmente chiuso
    remove(res);
  }
}
function broadcast(event, data) {
  for (const res of Array.from(clients)) {
    send(res, event, data);
  }
}

module.exports = { add, remove, broadcast };
