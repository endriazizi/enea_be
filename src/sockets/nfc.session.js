'use strict';
/**
 * Canale Socket — NFC Session
 * - join_session { session_id }
 * - leave_session { session_id }
 * Stanza: "session:<SID>"
 */

const logger = require('../logger');

/** @param {import('socket.io').Server} io */
module.exports = function(io) {
  io.on('connection', (socket) => {

    socket.on('join_session', (p) => {
      try{
        const sid = Number(p?.session_id || 0) || 0;
        if (!sid) return;
        const room = `session:${sid}`;
        socket.join(room);
        logger.info('🔗 [SOCKET] join_session', { sid, socket: socket.id });
      }catch(e){
        logger.warn('⚠️ [SOCKET] join_session KO', { error: String(e) });
      }
    });

    socket.on('leave_session', (p) => {
      try{
        const sid = Number(p?.session_id || 0) || 0;
        if (!sid) return;
        const room = `session:${sid}`;
        socket.leave(room);
        logger.info('🔗 [SOCKET] leave_session', { sid, socket: socket.id });
      }catch(e){
        logger.warn('⚠️ [SOCKET] leave_session KO', { error: String(e) });
      }
    });

  });
};
