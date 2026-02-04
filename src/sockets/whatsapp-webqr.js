// src/sockets/whatsapp-webqr.js
// [WEBQR] Mount: avvia il service con io per emit whatsapp-webqr:status / :qr / :error
'use strict';

const logger = require('../logger');
const webqrService = require('../services/whatsapp-webqr.service');

function mount(ioInstance) {
  webqrService.start(ioInstance);
  logger.info('📡 SOCKET [WEBQR] service started (emit: whatsapp-webqr:status, :qr, :error)');
}

module.exports = { mount };
