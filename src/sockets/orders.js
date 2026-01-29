'use strict';

// 📡 Socket.IO: canale "orders" + bus per broadcast da backend
// -------------------------------------------------------------
// - mount(io): registra i listener di connessione/disconnessione
// - broadcastOrderCreated(order): emette "order-created" a tutti gli admin
// - broadcastOrderUpdated(order): emette "order-updated" (status change)
// -------------------------------------------------------------

const logger = require('../logger');
const sockets = require('./index'); // per usare il singleton io()

/**
 * Monta il canale "orders" sul namespace di default.
 *
 * @param {import('socket.io').Server} io
 */
function mount(io) {
  io.of('/').on('connection', (socket) => {
    logger.info('🔌 socket orders ▶️ connected', { id: socket.id });

    socket.on('disconnect', () => {
      logger.info('🔌 socket orders ⏹ disconnected', { id: socket.id });
    });

    // (eventuali) azioni client → server in futuro
    // es: socket.on('orders:subscribe', () => ...)
  });
}

/**
 * Broadcast "order-created" — usato da /api/orders POST
 *
 * @param {object} order
 */
function broadcastOrderCreated(order) {
  try {
    const io = sockets.io(); // prende il singleton da sockets/index
    io.of('/').emit('order-created', order);

    logger.info('📡 order-created ▶️ broadcast', {
      id      : order && order.id,
      table_id: order && order.table_id,
      room_id : order && order.room_id,
    });
  } catch (err) {
    logger.warn('📡 order-created broadcast KO', { error: String(err) });
  }
}

/**
 * Broadcast "order-updated" — usato da PATCH /api/orders/:id/status
 *
 * @param {object} order
 */
function broadcastOrderUpdated(order) {
  try {
    const io = sockets.io();
    io.of('/').emit('order-updated', {
      id         : order && order.id,
      status     : order && order.status,
      table_id   : order && order.table_id,
      fulfillment: order && order.fulfillment,
    });

    logger.info('📡 order-updated ▶️ broadcast', {
      id         : order && order.id,
      status     : order && order.status,
      table_id   : order && order.table_id,
      fulfillment: order && order.fulfillment,
    });
  } catch (err) {
    logger.warn('📡 order-updated broadcast KO', { error: String(err) });
  }
}

module.exports = {
  mount,
  broadcastOrderCreated,
  broadcastOrderUpdated,
};
