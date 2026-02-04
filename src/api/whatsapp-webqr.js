// src/api/whatsapp-webqr.js
// [WEBQR] REST: GET /status, GET /qr, POST /send — auth admin + rate limit /send
// TASK 2: lazy-start su GET /status e GET /qr. TASK 3: no-cache. TASK 7: GET /debug.
'use strict';

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const webqrService = require('../services/whatsapp-webqr.service');
const logger = require('../logger');

/** TASK 3: no 304/ETag — imposta header per evitare cache browser. */
function setNoCache(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.removeHeader('ETag');
}

const SEND_RATE_LIMIT = 20;   // max richieste per finestra
const SEND_WINDOW_MS = 60_000; // 1 minuto
let sendCount = 0;
let sendWindowStart = Date.now();

function checkSendRateLimit(_req, res, next) {
  const now = Date.now();
  if (now - sendWindowStart >= SEND_WINDOW_MS) {
    sendCount = 0;
    sendWindowStart = now;
  }
  sendCount++;
  if (sendCount > SEND_RATE_LIMIT) {
    return res.status(429).json({ ok: false, error: 'rate_limit', message: 'Troppi invii, riprova più tardi' });
  }
  next();
}

router.get('/status', requireAuth, (req, res) => {
  setNoCache(res);
  // TASK 2: lazy-start — avvia il service se enabled e non ancora started (non dipende da socket connection)
  try {
    const { io } = require('../sockets');
    webqrService.ensureStarted(io());
  } catch (_) {}
  const data = webqrService.getStatus();
  logger.info('[WEBQR] 📡 /status hit', { status: data.status, hasQr: !!data.qr, lastError: data.lastError ?? null });
  res.json({ ok: true, ...data });
});

router.get('/qr', requireAuth, (req, res) => {
  if (!webqrService.enabled()) {
    return res.status(503).json({ ok: false, error: 'whatsapp_webqr_disabled' });
  }
  setNoCache(res);
  try {
    const { io } = require('../sockets');
    webqrService.ensureStarted(io());
  } catch (_) {}
  const st = webqrService.getStatus();
  logger.info('[WEBQR] 📡 /qr hit', { status: st.status, hasQr: !!st.qr });
  res.json({
    ok: true,
    status: st.status,
    qr: st.qr || null,
    updatedAt: st.updatedAt,
    lastError: st.lastError,
    me: st.me || null,
    sessionId: st.sessionId ?? 0,
  });
});

// TASK 7: diagnostica — enabled, started, INSTANCE_ID, authDir, retryCount, proxy, ecc.
router.get('/debug', requireAuth, (_req, res) => {
  setNoCache(res);
  const info = webqrService.getDebugInfo();
  res.json({ ok: true, ...info });
});

router.get('/messages', requireAuth, async (_req, res) => {
  setNoCache(res);
  try {
    if (!webqrService.enabled()) {
      return res.status(503).json({ ok: false, error: 'whatsapp_webqr_disabled' });
    }
    const { messages, lastMessage } = await webqrService.getMessagesForApi();
    const count = Array.isArray(messages) ? messages.length : 0;
    logger.info('[WEBQR] 📡 /messages hit', { count, hasLast: !!lastMessage });
    res.json({ ok: true, messages: messages || [], lastMessage: lastMessage || null });
  } catch (e) {
    logger.warn('[WEBQR] /messages fallback vuoto', { error: String(e?.message || e) });
    res.json({ ok: true, messages: [], lastMessage: null });
  }
});

// GET /media/:messageId — scarica il media del messaggio (immagine, video, documento, ecc.)
router.get('/media/:messageId', requireAuth, async (req, res) => {
  if (!webqrService.enabled()) {
    return res.status(503).json({ ok: false, error: 'whatsapp_webqr_disabled' });
  }
  const messageId = (req.params.messageId || '').trim();
  if (!messageId) return res.status(400).json({ ok: false, error: 'missing_message_id' });
  try {
    const result = await webqrService.getMediaBuffer(messageId);
    if (!result) return res.status(404).json({ ok: false, error: 'media_not_found' });
    res.set('Content-Type', result.contentType);
    res.send(result.buffer);
  } catch (e) {
    const msg = e?.message || String(e);
    logger.warn('[WEBQR] /media/:messageId KO', { messageId, error: msg });
    res.status(500).json({ ok: false, error: 'download_failed', message: msg });
  }
});

// Reset: cancella sessione auth e riavvia il service (utile se sessione corrotta)
router.post('/reset', requireAuth, (req, res) => {
  if (!webqrService.enabled()) {
    return res.status(503).json({ ok: false, error: 'whatsapp_webqr_disabled' });
  }
  try {
    const { io } = require('../sockets');
    webqrService.reset(io());
    res.json({ ok: true, reset: true });
  } catch (e) {
    const msg = e?.message || String(e);
    res.status(500).json({ ok: false, error: 'reset_failed', message: msg });
  }
});

router.post('/send', requireAuth, checkSendRateLimit, async (req, res) => {
  if (!webqrService.enabled()) {
    return res.status(503).json({ ok: false, error: 'whatsapp_webqr_disabled' });
  }
  const { to, text } = req.body || {};
  const toStr = (to != null && String(to).trim()) ? String(to).trim() : '';
  const textStr = (text != null && String(text).trim()) ? String(text).trim() : '';
  if (!toStr) {
    return res.status(400).json({ ok: false, error: 'missing_to' });
  }
  try {
    await webqrService.send({ to: toStr, text: textStr });
    res.json({ ok: true, sent: true });
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes('disabled') || msg.includes('non connesso')) {
      return res.status(503).json({ ok: false, error: 'whatsapp_webqr_not_ready', message: msg });
    }
    res.status(500).json({ ok: false, error: 'send_failed', message: msg });
  }
});

module.exports = router;
