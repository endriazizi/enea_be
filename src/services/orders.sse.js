'use strict';

/**
 * services/orders.sse.js
 * Semplice broadcaster SSE per gli ORDINI.
 *
 * Export (COMMONJS):
 *  - mountSse(router)   → GET /stream (event-stream)
 *  - emitCreated(order) → event: created
 *  - emitStatus(patch)  → event: status
 *
 * NOTE:
 *  - Mantiene un Set di client { res }.
 *  - Log minimal a runtime (manteniamo lo stile del progetto).
 */

const logger = require('../logger');

const clients = new Set();

/** Registra l'endpoint /stream sull'istanza router passata. */
function mountSse(router) {
  if (!router || typeof router.get !== 'function') {
    logger.warn('⚠️ [orders.sse] router non valido, SSE non montato');
    return;
  }

  router.get('/stream', (req, res) => {
    // Intestazioni SSE
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
    });
    // flush immediato
    res.flushHeaders?.();

    // Consigliato: retry di default
    res.write('retry: 2000\n\n');

    const client = { res };
    clients.add(client);
    logger.info('🧵 [SSE] client +1', { count: clients.size });

    req.on('close', () => {
      clients.delete(client);
      logger.info('🧵 [SSE] client -1', { count: clients.size });
    });
  });

  logger.info('🧵 [SSE] mount /stream OK (orders)');
}

/** Broadcast generico */
function _broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try { c.res.write(payload); } catch (_) { /* ignoro */ }
  }
}

/** Evento: ordine creato */
function emitCreated(order) {
  _broadcast('created', order);
}

/** Evento: cambio stato */
function emitStatus(patch) {
  _broadcast('status', patch);
}

module.exports = {
  mountSse,
  emitCreated,
  emitStatus,
  // opzionale: utile in debug, NON usato in produzione
  _clients: clients,
};
