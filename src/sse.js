// src/sse.js
// ============================================================================
// SSE per ORDERS (Server-Sent Events).
// - mount(router) → GET /stream
// - emitCreated(order), emitStatus({id,status})
// ============================================================================
'use strict';
const logger = require('./logger');

let nextClientId = 1;
const clients = new Map(); // id -> { res }

function headers() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };
}

function write(res, type, data) {
  try {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch { /* client chiuso */ }
}

function mount(router) {
  router.get('/stream', (req, res) => {
    const id = nextClientId++;
    res.writeHead(200, headers());
    res.write(`: connected ${id}\n\n`);
    clients.set(id, { res });
    logger.info('🧵 SSE client connected', { id, total: clients.size });

    req.on('close', () => {
      clients.delete(id);
      logger.info('🧵 SSE client disconnected', { id, total: clients.size });
    });
  });
}

function emitCreated(order) {
  logger.info('🧵 SSE emit created', { id: order?.id });
  for (const { res } of clients.values()) write(res, 'created', { order });
}

function emitStatus(payload) {
  logger.info('🧵 SSE emit status', { id: payload?.id, status: payload?.status });
  for (const { res } of clients.values()) write(res, 'status', payload);
}

module.exports = { mount, emitCreated, emitStatus };
