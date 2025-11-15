'use strict';
/**
 * Socket entry — singleton + bootstrap canali
 * -------------------------------------------------------------
 * - Mantiene i tuoi log di connessione/disconnessione
 * - Mantiene il ping/pong ("🏓") per diagnostica rapida
 * - Espone un singleton io() richiamabile dai router/service
 * - Monta i canali modulari (orders, nfc.session)
 */

const logger = require('../logger');
let _io = null;

/** @param {import('socket.io').Server} io */
function init(io) {
  if (_io) {
    logger.warn('🔌 SOCKET init chiamato più volte — uso il singleton esistente');
    return _io;
  }
  _io = io;

  // === HANDLER BASE =========================================================
  io.on('connection', (socket) => {
    logger.info('🔌 SOCKET connected', { id: socket.id });

    socket.on('ping', () => {
      logger.info('🏓 ping from', { id: socket.id });
      socket.emit('pong');
    });

    socket.on('disconnect', (reason) => {
      logger.info('🔌 SOCKET disconnected', { id: socket.id, reason });
    });
  });

  // === CANALI MODULARI ======================================================
  try {
    require('./orders.channel')(io);
    logger.info('📡 SOCKET channel mounted: orders');
  } catch (err) {
    logger.warn('📡 SOCKET channel orders non disponibile', { error: String(err) });
  }

  // 🆕 canale NFC session (join/leave stanza session:<SID>)
  try {
    require('./nfc.session')(io);
    logger.info('📡 SOCKET channel mounted: nfc.session');
  } catch (err) {
    logger.warn('📡 SOCKET channel nfc.session non disponibile', { error: String(err) });
  }

  logger.info('🔌 SOCKET bootstrap completato ✅');
  return _io;
}

function io() {
  if (!_io) throw new Error('socket.io non inizializzato');
  return _io;
}

module.exports = (serverOrIo) => init(serverOrIo);
module.exports.io = io;
