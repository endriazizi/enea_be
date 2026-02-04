// src/api/support.dev.js
// [DEV] Route per riavvio server Node: SOLO in dev (NODE_ENV !== 'production') e con DEV_ALLOW_RESTART=1.
// Utile per pagina /whatsapp-webqr: pulsante "Aggiorna status" in dev = restart + wait server up + reload.
// IMPORTANTE: funziona solo se il server gira sotto nodemon/pm2 che lo rialza.
'use strict';

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const logger = require('../logger');

const isProduction = process.env.NODE_ENV === 'production';
const devAllowRestart = String(process.env.DEV_ALLOW_RESTART || '0') === '1';
const RESTART_DELAY_MS = 300;

function setNoCache(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

/** POST /restart — riavvia il processo (solo dev + DEV_ALLOW_RESTART=1). */
router.post('/restart', requireAuth, (req, res) => {
  setNoCache(res);

  if (isProduction) {
    logger.warn('[DEV] 🔒 restart rifiutato: NODE_ENV=production');
    return res.status(403).json({ ok: false, error: 'restart_only_in_dev' });
  }
  if (!devAllowRestart) {
    logger.warn('[DEV] 🔒 restart rifiutato: imposta DEV_ALLOW_RESTART=1');
    return res.status(403).json({
      ok: false,
      error: 'restart_disabled',
      message: 'Imposta DEV_ALLOW_RESTART=1 e avvia con nodemon (es. npm run dev)',
    });
  }

  const by = req.user?.email || req.user?.id || 'unknown';
  const ip = req.ip || req.connection?.remoteAddress || '';
  logger.info('[DEV] 🔁 restart requested', { by, ip, reason: 'whatsapp-webqr button' });
  logger.info('[DEV] ℹ️ Assicurati di aver avviato con nodemon (npm run dev) o pm2 per il restart automatico.');
  res.json({ ok: true, restarting: true, at: Date.now() });

  setTimeout(() => {
    logger.info('[DEV] 💥 process.exit(0) in 300ms (nodemon/pm2 will restart)');
    process.exit(0);
  }, RESTART_DELAY_MS);
});

module.exports = router;
