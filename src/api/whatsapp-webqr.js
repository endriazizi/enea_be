// src/api/whatsapp-webqr.js
// [WEBQR] REST: GET /status, GET /qr, POST /send, GET /last-message, POST /restart, POST /reset (con guard ENV).
// Invio consentito SOLO se status === 'open'; altrimenti 409 WA_NOT_READY (anti-falso-OK).
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
  try {
    const { io } = require('../sockets');
    webqrService.ensureStarted(io());
  } catch (_) {}
  const data = webqrService.getStatus();
  logger.info('[WEBQR] 📡 /status hit', { status: data.status, hasQr: !!data.qr, lastError: data.lastError ?? null, lastSendOk: data.lastSendAttempt?.ok ?? null });
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

// POST /restart — soft restart (ricrea socket, non cancella auth)
router.post('/restart', requireAuth, (req, res) => {
  if (!webqrService.enabled()) {
    return res.status(503).json({ ok: false, error: 'whatsapp_webqr_disabled' });
  }
  try {
    const { io } = require('../sockets');
    webqrService.restart(io());
    const data = webqrService.getStatus();
    logger.info('[WEBQR] 📡 /restart ok', { statusPost: data.status });
    res.json({ ok: true, restart: true, status: data.status, updatedAt: data.updatedAt });
  } catch (e) {
    const msg = e?.message || String(e);
    logger.warn('[WEBQR] /restart KO', { error: msg });
    res.status(500).json({ ok: false, error: 'restart_failed', message: msg });
  }
});

// Reset: cancella sessione auth e riavvia (solo se WA_RESET_ENABLED=1 o NODE_ENV=development)
router.post('/reset', requireAuth, (req, res) => {
  if (!webqrService.enabled()) {
    return res.status(503).json({ ok: false, error: 'whatsapp_webqr_disabled' });
  }
  try {
    const { io } = require('../sockets');
    webqrService.reset(io());
    res.json({ ok: true, reset: true });
  } catch (e) {
    const code = e?.code || 'reset_failed';
    const msg = e?.message || String(e);
    if (code === 'RESET_DISABLED') {
      return res.status(403).json({ ok: false, error: code, message: msg });
    }
    res.status(500).json({ ok: false, error: 'reset_failed', message: msg });
  }
});

// GET /last-message — ultimo messaggio ricevuto (debug)
router.get('/last-message', requireAuth, (req, res) => {
  setNoCache(res);
  if (!webqrService.enabled()) {
    return res.status(503).json({ ok: false, error: 'whatsapp_webqr_disabled' });
  }
  const last = webqrService.getLastMessage();
  logger.info('[WEBQR] 📡 /last-message hit', { hasLast: !!last });
  res.json({ ok: true, lastMessage: last || null });
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
    const result = await webqrService.send({ to: toStr, text: textStr });
    logger.info('[WEBQR] 📡 /send 200', { to: toStr, msgId: result?.msgId ?? null });
    res.json({ ok: true, sent: true, msgId: result?.msgId ?? null });
  } catch (e) {
    const code = e?.code || '';
    const msg = e?.message || String(e);
    if (code === 'WA_NOT_READY' || code === 'WA_DISABLED') {
      return res.status(409).json({ ok: false, error: code, message: msg });
    }
    if (code === 'INVALID_PHONE') {
      return res.status(400).json({ ok: false, error: code, message: msg });
    }
    if (msg.includes('disabled') || msg.includes('non connesso')) {
      return res.status(409).json({ ok: false, error: 'WA_NOT_READY', message: msg });
    }
    res.status(500).json({ ok: false, error: 'send_failed', message: msg });
  }
});

// POST /test-send — alias di POST /send (stesse guardie e reason codes)
router.post('/test-send', requireAuth, checkSendRateLimit, async (req, res) => {
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
    const result = await webqrService.send({ to: toStr, text: textStr || 'Test' });
    logger.info('[WEBQR] 📡 /test-send 200', { to: toStr, msgId: result?.msgId ?? null });
    res.json({ ok: true, sent: true, msgId: result?.msgId ?? null });
  } catch (e) {
    const code = e?.code || '';
    const msg = e?.message || String(e);
    if (code === 'WA_NOT_READY' || code === 'WA_DISABLED') {
      return res.status(409).json({ ok: false, error: code, message: msg });
    }
    if (code === 'INVALID_PHONE') {
      return res.status(400).json({ ok: false, error: code, message: msg });
    }
    res.status(500).json({ ok: false, error: 'send_failed', message: msg });
  }
});

module.exports = router;
