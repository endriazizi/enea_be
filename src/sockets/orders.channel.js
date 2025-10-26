'use strict';

/**
 * sockets/orders.channel.js
 * -----------------------------------------------------------------------------
 * Canale Socket.IO per “orders”.
 * - Solo ping e join di stanze per futuri filtri (per ora broadcast generale).
 */

const logger = require('../logger');

module.exports = (io) => {
  io.on('connection', (socket) => {
    logger.info('🔌 [SOCKET] orders: connection', { id: socket.id });

    socket.on('orders:ping', () => {
      logger.info('🏓 [SOCKET] orders:ping', { id: socket.id });
      socket.emit('orders:pong', { t: Date.now() });
    });

    socket.on('disconnect', (reason) => {
      logger.info('🔌 [SOCKET] orders: disconnect', { id: socket.id, reason });
    });
  });
};
