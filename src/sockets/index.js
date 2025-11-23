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

/**
 * Inizializza socket.io una sola volta e monta i canali modulari.
 *
 * @param {import('socket.io').Server} ioInstance
 * @returns {import('socket.io').Server}
 */
function init(ioInstance) {
  if (_io) {
    logger.warn(
      '🔌 SOCKET init chiamato più volte — uso il singleton esistente',
    );
    return _io;
  }

  _io = ioInstance;

  // === HANDLER BASE =========================================================
  ioInstance.on('connection', (socket) => {
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
  // ORDERS: canale + bus per broadcast "order-created"/"order-updated"
  try {
    const ordersMod = require('./orders');
    if (ordersMod && typeof ordersMod.mount === 'function') {
      ordersMod.mount(ioInstance);
      logger.info('📡 SOCKET channel mounted: orders');
    } else if (typeof ordersMod === 'function') {
      // compat vecchia versione: module.exports = (io) => { ... }
      ordersMod(ioInstance);
      logger.info('📡 SOCKET channel mounted (legacy fn): orders');
    } else {
      logger.warn(
        '📡 SOCKET channel orders non montato (export inatteso, manca mount(io))',
      );
    }
  } catch (err) {
    logger.warn('📡 SOCKET channel orders non disponibile', {
      error: String(err),
    });
  }

  // 🆕 canale NFC session (join/leave stanza session:<SID>)
  try {
    const nfcMod = require('./nfc.session');
    if (nfcMod && typeof nfcMod.mount === 'function') {
      nfcMod.mount(ioInstance);
      logger.info('📡 SOCKET channel mounted: nfc.session');
    } else if (typeof nfcMod === 'function') {
      nfcMod(ioInstance);
      logger.info('📡 SOCKET channel mounted (legacy fn): nfc.session');
    } else {
      logger.warn(
        '📡 SOCKET channel nfc.session non montato (export inatteso, manca mount(io))',
      );
    }
  } catch (err) {
    logger.warn('📡 SOCKET channel nfc.session non disponibile', {
      error: String(err),
    });
  }

  logger.info('🔌 SOCKET bootstrap completato ✅');
  return _io;
}

/**
 * Restituisce il singleton io() per i router/service BE.
 *
 * @returns {import('socket.io').Server}
 */
function getIo() {
  if (!_io) throw new Error('socket.io non inizializzato');
  return _io;
}

// Funzione principale esportata (compat con require('./sockets/index')(io))
function socketsEntry(serverOrIo) {
  return init(serverOrIo);
}

// Espongo anche metodi nominati
socketsEntry.init = init;
socketsEntry.io = getIo;

module.exports = socketsEntry;
module.exports.io = getIo;
module.exports.init = init;
