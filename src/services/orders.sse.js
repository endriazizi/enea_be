'use strict';

/**
 * services/orders.sse.js
 * -----------------------------------------------------------------------------
 * Semplice broadcaster SSE in-memory.
 * - add(res): registra un client
 * - remove(res): deregistra
 * - broadcast(event, payload): invia a tutti
 */
'use strict';

/**
 * services/orders.sse.js
 * Mantiene i client SSE connessi e spara eventi (created/status).
 */

const clients = new Set();

function add(res) {
  clients.add(res);
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
}

function remove(res) {
  clients.delete(res);
}

function broadcast(type, payload) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { /* no-op */ }
  }
}

module.exports = { add, remove, broadcast };
