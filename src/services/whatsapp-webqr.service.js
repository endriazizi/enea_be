// src/services/whatsapp-webqr.service.js
// [WEBQR] Singleton: state in memoria (booting/pairing/open/disconnected).
// REGOLA ANTI-FALSO-OK: "pronto per invio" SOLO con status === 'open'.
// Baileys può risultare attivo ma non realmente open (handshake incompleto / creds stale).
// Se non open, l'API risponde 409 WA_NOT_READY (no "ok" finto).
// QR tenuto 90s dopo disconnect per permettere alla UI di mostrarlo.
'use strict';

const path = require('path');
const fs = require('fs');
const provider = require('./provider.baileys');
const logger = require('../logger');
const { query } = require('../db');
const { normalizePhoneIT, toBaileysJid } = require('../utils/normalize-phone-it');

// Log a avvio modulo per verificare che .env sia letto (evita 503 per enabled=false)
logger.info('[WEBQR] env', { WHATSAPP_WEBQR_ENABLED: process.env.WHATSAPP_WEBQR_ENABLED });

const AUTH_DIR_DEFAULT = path.join(process.cwd(), 'data', 'wa-webqr');
/** ID runtime del singleton: stesso in tutti i require; se diverso tra route = doppia istanza. */
const INSTANCE_ID = Math.random().toString(36).slice(2);

const RECENT_MAX = 50;
/** Coda ultimi 50 messaggi per GET /messages e UI (coerente con MAX_MESSAGES_UI). */
const MESSAGES_RING_MAX = 50;
/** Secondi per cui mantenere il QR visibile dopo disconnect (UI può ancora mostrarlo). */
const QR_RETENTION_AFTER_DISCONNECT_MS = 90_000;

let _started = false;
let _io = null;
let _recentMessages = [];
/** Ring buffer ultimi 20 messaggi (per API /messages e lastMessage). */
let _messagesRing = [];
/** Messaggi raw per download media (messageId -> raw msg); max 30. */
const MEDIA_CACHE_MAX = 30;
let _mediaMessages = new Map();
/** Timer per azzerare state.qr dopo disconnect; evita di distruggere subito il QR. */
let _qrClearTimer = null;

/**
 * State singleton in memoria: usato da API /status e /qr.
 * status: 'booting' | 'pairing' | 'open' | 'connected' | 'disconnected' | 'disabled'
 * INVIO CONSENTITO SOLO SE status === 'open' (source of truth per "pronto").
 */
let state = {
  enabled: false,
  status: 'disconnected',
  qr: null,
  lastError: null,
  updatedAt: Date.now(),
  /** Ultimo messaggio ricevuto: { at, from, textSnippet, id } per UI e GET /last-message. */
  lastMessage: null,
  /** Info account connesso (quando status=open): jid, numberRaw, numberHuman, pushName. */
  me: null,
  /** Incrementato a ogni reset per distinguere sessioni; messaggi portano sessionId. */
  sessionId: 0,
  /** Ultimo tentativo di invio (debug + FE badge): { ts, toHuman, jid, ok, reason, msgId }. */
  lastSendAttempt: null,
};

function enabled() {
  return String(process.env.WHATSAPP_WEBQR_ENABLED || '0') === '1';
}

function _clearQrTimer() {
  if (_qrClearTimer) {
    clearTimeout(_qrClearTimer);
    _qrClearTimer = null;
  }
}

function _emitStatus() {
  if (_io) _io.to('admins').emit('whatsapp-webqr:status', {
    status: state.status,
    lastError: state.lastError,
    updatedAt: state.updatedAt,
    me: state.me,
    sessionId: state.sessionId,
    lastSendAttempt: state.lastSendAttempt,
  });
}

/** TASK 2: guard idempotente — start() può essere chiamato più volte, parte una sola volta. */
function start(ioInstance) {
  if (!enabled()) {
    logger.info('[WEBQR] 📲 disabled (WHATSAPP_WEBQR_ENABLED!=1)');
    return;
  }
  if (_started) {
    logger.warn('[WEBQR] ⚠️ already started', { INSTANCE_ID });
    return;
  }
  logger.info('[WEBQR] 🧩 service instance', { INSTANCE_ID });
  _io = ioInstance;
  _started = true;
  state.enabled = true;
  state.status = 'booting';
  state.qr = null;
  state.lastError = null;
  state.updatedAt = Date.now();
  _clearQrTimer();

  provider.registerCallbacks({
    onStatus: (payload) => {
      const raw = payload.status;
      // Mappatura: ready -> open (SOLO open = pronto per invio), qr -> pairing, connecting -> booting
      if (raw === 'ready') {
        state.status = 'open';
        state.qr = null;
        state.lastError = null;
        state.updatedAt = Date.now();
        _clearQrTimer();
        logger.info('[WEBQR] 🟢 open (pronto per invio)');
      } else if (raw === 'qr') {
        state.status = 'pairing';
        state.updatedAt = payload.updatedAt || Date.now();
        logger.info('[WEBQR] 🔳 pairing (QR pronto)');
      } else if (raw === 'connecting') {
        state.status = 'booting';
        state.updatedAt = payload.updatedAt || Date.now();
        logger.info('[WEBQR] 🟡 booting');
      } else {
        state.status = 'disconnected';
        state.lastError = payload.lastError || state.lastError;
        state.updatedAt = payload.updatedAt || Date.now();
        _clearQrTimer();
        _qrClearTimer = setTimeout(() => {
          state.qr = null;
          state.updatedAt = Date.now();
          _qrClearTimer = null;
          if (_io) _io.to('admins').emit('whatsapp-webqr:status', { status: state.status, lastError: state.lastError, updatedAt: state.updatedAt });
          logger.info('[WEBQR] 🔳 QR azzerato dopo retention (disconnected)');
        }, QR_RETENTION_AFTER_DISCONNECT_MS);
        logger.warn('[WEBQR] 🔴 disconnected', { lastError: state.lastError });
      }
      _emitStatus();
    },
    onQr: (dataUrl) => {
      state.status = 'pairing';
      state.qr = dataUrl;
      state.lastError = null;
      state.updatedAt = Date.now();
      _clearQrTimer();
      logger.info('[WEBQR] 🔳 QR ricevuto (pairing)');
      if (_io) {
        _io.to('admins').emit('whatsapp-webqr:qr', { qr: dataUrl, updatedAt: state.updatedAt });
        _io.to('admins').emit('whatsapp-webqr:status', { status: state.status, lastError: null, updatedAt: state.updatedAt });
      }
    },
    onError: (msg) => {
      state.lastError = msg;
      state.updatedAt = Date.now();
      if (_io) _io.to('admins').emit('whatsapp-webqr:error', { message: msg });
    },
    onMe: (me) => {
      state.me = me;
      state.updatedAt = Date.now();
      logger.info('[WEBQR] 👤 me', { numberHuman: me?.numberHuman });
      _emitStatus();
    },
    onMessage: (message, rawMsg) => {
      // Se riceviamo messaggi ma lo status era "disconnected", la connessione è attiva — allinea a open (evita badge "disconnected" errato)
      if (state.status === 'disconnected' && state.me) {
        state.status = 'open';
        state.lastError = null;
        state.updatedAt = Date.now();
        logger.info('[WEBQR] 🟢 status → open (msg ricevuto)');
      }
      if (rawMsg && message.id) {
        _mediaMessages.set(message.id, rawMsg);
        if (_mediaMessages.size > MEDIA_CACHE_MAX) {
          const firstKey = _mediaMessages.keys().next().value;
          if (firstKey != null) _mediaMessages.delete(firstKey);
        }
      }
      const tagged = { ...message, sessionId: state.sessionId };
      _recentMessages.push(tagged);
      if (_recentMessages.length > RECENT_MAX) _recentMessages.shift();
      insertMessageToDb(tagged).catch(() => {});
      const snippet = (message.text && message.text.length > 0)
        ? String(message.text).slice(0, 80).replace(/\n/g, ' ')
        : (message.rawType && message.rawType !== 'conversation' && message.rawType !== 'extendedTextMessage' ? '[media]' : '[no-text]');
      state.lastMessage = {
        at: message.ts || Date.now(),
        from: message.fromNumber || message.from || '',
        textSnippet: snippet,
        id: message.id || '',
      };
      _messagesRing.push(tagged);
      if (_messagesRing.length > MESSAGES_RING_MAX) _messagesRing.shift();
      logger.info('[WEBQR] ✉️ msg ricevuto', { from: state.lastMessage.from, snippet: state.lastMessage.textSnippet.slice(0, 40), at: state.lastMessage.at });
      if (_io) {
        _io.to('admins').emit('whatsapp-webqr:message', { message, lastMessage: state.lastMessage });
        _io.to('admins').emit('whatsapp-webqr:status', { status: state.status, lastError: state.lastError, updatedAt: state.updatedAt });
      }
    },
  });
  provider.connect(logger).catch((err) => {
    logger.error('[WEBQR] ❌ start KO', err);
  });
}

/** TASK 2: lazy-start — se enabled e non ancora started, avvia il service (GET /status e /qr lo usano). */
function ensureStarted(ioInstance) {
  if (!enabled()) return;
  if (!_started) {
    if (ioInstance) {
      start(ioInstance);
    } else {
      logger.warn('[WEBQR] ⚠️ ensureStarted senza io: messaggi in tempo reale via socket non disponibili (usa GET /messages per polling)');
    }
  }
}

function isStarted() {
  return _started;
}

function getStatus() {
  if (!enabled()) {
    return { status: 'disabled', enabled: false, updatedAt: Date.now(), lastError: null, qr: null, me: null, sessionId: 0, lastSendAttempt: null };
  }
  return {
    enabled: state.enabled,
    status: state.status,
    qr: state.qr,
    lastError: state.lastError,
    updatedAt: state.updatedAt,
    me: state.me || null,
    sessionId: state.sessionId ?? 0,
    lastSendAttempt: state.lastSendAttempt || null,
  };
}

/** Restituisce lo state completo per /qr (qr, status, updatedAt, lastError). */
function getQr() {
  if (!enabled()) return null;
  return state.qr;
}

/** Ultimi 50 messaggi (dal più recente al più vecchio). Solo in memoria, no DB. */
function getRecentMessages() {
  return [..._recentMessages].reverse();
}

/** Inserisce un messaggio in DB (idempotente: UNIQUE su session_id + message_id). */
async function insertMessageToDb(message) {
  const sessionId = state.sessionId ?? 0;
  const id = message.id || '';
  const ts = message.ts || Date.now();
  const from = message.from || '';
  const fromNumber = message.fromNumber || message.from || '';
  const pushName = (message.pushName != null && String(message.pushName).trim()) ? String(message.pushName).trim().slice(0, 255) : null;
  const text = (message.text != null) ? String(message.text).slice(0, 1024) : null;
  const rawType = (message.rawType != null) ? String(message.rawType).slice(0, 64) : null;
  const hasMedia = message.hasMedia ? 1 : 0;
  const mediaType = (message.mediaType != null) ? String(message.mediaType).slice(0, 32) : null;
  try {
    await query(
      `INSERT INTO wa_webqr_messages (session_id, message_id, ts, from_jid, from_number, push_name, text, raw_type, has_media, media_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE ts = ts`,
      [sessionId, id, ts, from.slice(0, 128), fromNumber.slice(0, 32), pushName, text, rawType, hasMedia, mediaType]
    );
  } catch (e) {
    logger.warn('[WEBQR] insertMessageToDb KO', { messageId: id, error: String(e?.message || e) });
  }
}

/** Legge ultimi N messaggi della sessione da DB (dal più recente). */
async function getMessagesFromDb(sessionId, limit = 50) {
  const rows = await query(
    `SELECT message_id AS id, ts, from_jid AS \`from\`, from_number AS fromNumber, push_name AS pushName, text, raw_type AS rawType, has_media AS hasMedia, media_type AS mediaType, session_id AS sessionId
     FROM wa_webqr_messages
     WHERE session_id = ?
     ORDER BY ts DESC
     LIMIT ?`,
    [sessionId, limit]
  );
  return (rows || []).map((r) => ({
    id: r.id,
    ts: Number(r.ts),
    from: r.from || '',
    fromNumber: r.fromNumber || r.from || '',
    pushName: r.pushName || undefined,
    text: r.text || '',
    rawType: r.rawType || 'unknown',
    hasMedia: !!r.hasMedia,
    mediaType: r.mediaType || undefined,
    sessionId: r.sessionId ?? sessionId,
  }));
}

/** Per GET /messages: da DB (ultimi 50 della sessione) con fallback a memoria. Non va mai in 500. */
async function getMessagesForApi() {
  const currentSessionId = state.sessionId ?? 0;
  let lastMessage = state.lastMessage;
  try {
    const messages = await getMessagesFromDb(currentSessionId, MESSAGES_RING_MAX);
    if (messages.length > 0) {
      if (!lastMessage && messages[0]) {
        const m = messages[0];
        lastMessage = { at: m.ts, from: m.fromNumber || m.from, textSnippet: (m.text || '').slice(0, 80), id: m.id };
      }
      return { messages, lastMessage };
    }
  } catch (e) {
    logger.warn('[WEBQR] getMessagesFromDb KO, fallback memoria', { error: String(e?.message || e) });
  }
  const messages = [..._messagesRing]
    .filter((m) => (m.sessionId ?? 0) === currentSessionId)
    .reverse();
  return { messages, lastMessage: lastMessage || state.lastMessage };
}

/** Restituisce il raw message per messageId (per download media). */
function getMediaMessage(messageId) {
  return _mediaMessages.get(messageId) || null;
}

/** Scarica il buffer del media e restituisce { buffer, contentType }. Restituisce null se messaggio non presente o download fallisce (es. view-once già visualizzato). */
async function getMediaBuffer(messageId) {
  const rawMsg = getMediaMessage(messageId);
  if (!rawMsg || !rawMsg.message) return null;
  const m = rawMsg.message || {};
  const contentTypeKey = Object.keys(m).find((k) => k !== 'messageContextInfo' && /Message$/.test(k));
  const media = contentTypeKey ? m[contentTypeKey] : null;
  const mimetype = (media && typeof media.mimetype === 'string') ? media.mimetype : 'application/octet-stream';
  try {
    const buffer = await provider.downloadMediaMessage(rawMsg, logger);
    return buffer ? { buffer, contentType: mimetype } : null;
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg && (msg.includes('No message present') || msg.includes('not a media message'))) {
      logger.warn('[WEBQR] getMediaBuffer: messaggio non scaricabile', { messageId, reason: msg });
      return null;
    }
    throw e;
  }
}

async function send({ to, text }) {
  if (!enabled()) {
    logger.warn('[WEBQR] send rifiutato: disabled');
    throw Object.assign(new Error('whatsapp_webqr_disabled'), { code: 'WA_DISABLED' });
  }
  if (state.status !== 'open') {
    logger.warn('[WEBQR] send rifiutato: WA_NOT_READY', { status: state.status });
    state.lastSendAttempt = { ts: Date.now(), toHuman: to, jid: null, ok: false, reason: 'WA_NOT_READY', msgId: null };
    state.updatedAt = Date.now();
    _emitStatus();
    throw Object.assign(new Error('WA non pronto (status: ' + state.status + ')'), { code: 'WA_NOT_READY' });
  }
  let e164, jid;
  try {
    e164 = normalizePhoneIT(to);
    jid = toBaileysJid(e164);
  } catch (err) {
    const code = (err && err.code) ? err.code : 'INVALID_PHONE';
    logger.warn('[WEBQR] send: numero non valido', { to, code });
    state.lastSendAttempt = { ts: Date.now(), toHuman: to, jid: null, ok: false, reason: code, msgId: null };
    state.updatedAt = Date.now();
    _emitStatus();
    throw err;
  }
  const toHuman = e164.replace(/(\d{2})(\d{3})(\d{3})(\d{4})/, '+$1 $2 $3 $4').trim() || e164;
  logger.info('[WEBQR] tentativo invio', { toHuman, jid, preview: (text || '').toString().slice(0, 40) });
  try {
    const result = await provider.sendMessage(jid, text, logger);
    const msgId = (result && result.key && result.key.id) ? result.key.id : null;
    state.lastSendAttempt = { ts: Date.now(), toHuman, jid, ok: true, reason: null, msgId };
    state.updatedAt = Date.now();
    _emitStatus();
    logger.info('[WEBQR] invio ok', { toHuman, msgId });
    return { msgId };
  } catch (err) {
    const msg = (err && err.message) ? String(err.message) : String(err);
    const reason = msg.indexOf('non connesso') !== -1 ? 'WA_NOT_READY' : 'SEND_FAILED';
    state.lastSendAttempt = { ts: Date.now(), toHuman, jid, ok: false, reason, msgId: null };
    state.updatedAt = Date.now();
    _emitStatus();
    logger.warn('[WEBQR] invio fallito', { toHuman, reason });
    throw err;
  }
  // Se l’invio va a buon fine ma lo status era "disconnected", la connessione è attiva — allinea lo status
}

function shutdown() {
  _clearQrTimer();
  provider.shutdown();
  _started = false;
  _io = null;
  _recentMessages = [];
  _mediaMessages.clear();
  const preservedSessionId = state.sessionId ?? 0;
  state = {
    enabled: false,
    status: 'disconnected',
    qr: null,
    lastError: null,
    updatedAt: Date.now(),
    lastMessage: null,
    me: null,
    sessionId: preservedSessionId,
    lastSendAttempt: null,
  };
}

/** Soft restart: shutdown + start (ricrea socket senza cancellare auth). */
function restart(ioInstance) {
  logger.info('[WEBQR] 🔁 restart requested', { statusPre: state.status });
  shutdown();
  if (ioInstance && enabled()) {
    start(ioInstance);
  }
  logger.info('[WEBQR] 🔁 restart done', { statusPost: state.status });
}

/** Ultimo messaggio ricevuto (per GET /last-message debug). */
function getLastMessage() {
  return state.lastMessage || null;
}

/**
 * Reset: shutdown, cancella cartella auth (sessione corrotta), riavvia il service.
 * Consentito solo se WA_RESET_ENABLED=1 o NODE_ENV=development.
 */
function reset(ioInstance) {
  const allowReset = String(process.env.WA_RESET_ENABLED || '0') === '1' ||
    process.env.NODE_ENV === 'development';
  if (!allowReset) {
    logger.warn('[WEBQR] ❌ reset rifiutato: WA_RESET_ENABLED non attivo e NODE_ENV!=development');
    throw Object.assign(new Error('reset non consentito'), { code: 'RESET_DISABLED' });
  }
  logger.info('[WEBQR] ♻️ reset requested');
  // Azzera buffer messaggi, lastMessage, qr, lastError, me; incrementa sessionId per distinguere sessioni
  state.sessionId = (state.sessionId ?? 0) + 1;
  _messagesRing = [];
  _mediaMessages.clear();
  _recentMessages = [];
  state.lastMessage = null;
  state.qr = null;
  state.lastError = null;
  state.me = null;
  state.updatedAt = Date.now();
  shutdown();
  const authDir = path.resolve((process.env.WHATSAPP_WEBQR_AUTH_DIR || '').trim() || AUTH_DIR_DEFAULT);
  try {
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true });
      logger.info('[WEBQR] 🗑️ auth dir rimossa', { authDir });
    }
  } catch (e) {
    logger.warn('[WEBQR] ⚠️ rimozione auth dir KO', { authDir, error: String(e) });
  }
  if (ioInstance && enabled()) {
    start(ioInstance);
  }
}

/** Per debug: INSTANCE_ID, authDir, retryCount, ecc. */
function getDebugInfo() {
  const authDir = (process.env.WHATSAPP_WEBQR_AUTH_DIR || '').trim() || AUTH_DIR_DEFAULT;
  let authExists = false;
  let authFilesCount = 0;
  try {
    authExists = fs.existsSync(authDir);
    if (authExists) {
      const files = fs.readdirSync(authDir);
      authFilesCount = files.length;
    }
  } catch (_) {}
  return {
    enabled: enabled(),
    started: _started,
    INSTANCE_ID,
    authDir,
    authExists,
    authFilesCount,
    retryCount: provider.getRetryCount ? provider.getRetryCount() : null,
    lastError: state.lastError,
    status: state.status,
    nodeVersion: process.version,
    envProxyPresent: !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.NO_PROXY),
  };
}

module.exports = {
  enabled,
  start,
  ensureStarted,
  isStarted,
  getStatus,
  getQr,
  getRecentMessages,
  getMessagesForApi,
  getMediaMessage,
  getMediaBuffer,
  getLastMessage,
  send,
  shutdown,
  restart,
  reset,
  getDebugInfo,
  INSTANCE_ID,
};
