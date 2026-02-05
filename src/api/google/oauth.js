// src/api/google/oauth.js
'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../logger');
const { exchangeCode } = require('../../services/google.service');

// POST /api/google/oauth/exchange  { code }
// Scambia il "code" ottenuto dal popup GIS e persiste i token.
router.post('/exchange', async (req, res) => {
  const code = String(req.body?.code || '');
  logger.info('[Google BE] POST /api/google/oauth/exchange ricevuto', { codeLength: code.length });
  if (!code) {
    logger.warn('[Google BE] OAuth exchange: code mancante');
    return res.status(400).json({ ok: false, message: 'Missing code' });
  }

  try {
    await exchangeCode(code);
    logger.info('[Google BE] OAuth exchange OK, token salvati in google_tokens');
    return res.json({ ok: true });
  } catch (e) {
    logger.error('[Google BE] OAuth exchange KO', { error: String(e) });
    return res.status(500).json({ ok: false, message: 'oauth_exchange_failed' });
  }
});

// (opzionale) GET /api/google/oauth/callback — per eventuale redirect flow classico
router.get('/callback', (req, res) => {
  res.send('OK: callback non usato con GIS popup. Usa /oauth/exchange con `code`.');
});

module.exports = router;
