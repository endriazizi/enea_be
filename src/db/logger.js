'use strict';

/**
 * src/db/logger.js
 * -----------------------------------------------------------------------------
 * Bridge semplice: i file in src/db/ possono continuare a fare:
 *   const logger = require('./logger');
 *
 * e noi reindirizziamo al logger vero in src/logger.js
 */

module.exports = require('../logger');