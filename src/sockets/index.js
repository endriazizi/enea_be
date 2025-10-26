// src/sockets/index.js
'use strict';

/**
 * Socket entry — singleton + bootstrap canali
 * -------------------------------------------------------------
 * - Mantiene i tuoi log di connessione/disconnessione
 * - Mantiene il ping/pong ("🏓") per diagnostica rapida
 * - Espone un singleton io() richiamabile dai router/service
 * - Monta il canale ordini (orders.channel) per eventi live
 */

const logger = require('../logger');

let _io = null;

/**
 * Inizializza una sola volta il socket server.
 * @param {import('socket.io').Server} io
 */
function init(io) {
  if (_io) {
    // Già inizializzato: evito doppio wiring degli handler
    logger.warn('🔌 SOCKET init chiamato più volte — uso il singleton esistente');
    return _io;
  }

  _io = io;

  // === HANDLER BASE (il tuo file locale) ====================================
  io.on('connection', (socket) => {
    logger.info('🔌 SOCKET connected', { id: socket.id });

    // Ping/Pong diagnostico
    socket.on('ping', () => {
      logger.info('🏓 ping from', { id: socket.id });
      socket.emit('pong');
    });

    socket.on('disconnect', (reason) => {
      logger.info('🔌 SOCKET disconnected', { id: socket.id, reason });
    });
  });

  // === CANALI MODULARI ======================================================
  // Canale "orders" (emette orders:created / orders:status / ...)
  try {
    require('./orders.channel')(io);
    logger.info('📡 SOCKET channel mounted: orders');
  } catch (err) {
    logger.warn('📡 SOCKET channel orders non disponibile', { error: String(err) });
  }

  logger.info('🔌 SOCKET bootstrap completato ✅');
  return _io;
}

/**
 * Restituisce l'istanza singleton di socket.io
 * (utile nei router/service per emettere eventi).
 */
function io() {
  if (!_io) throw new Error('socket.io non inizializzato');
  return _io;
}

module.exports = (serverOrIo) => init(serverOrIo);
module.exports.io = io;
