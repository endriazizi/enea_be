// src/services/provider.baileys.js
// [WEBQR] Provider Baileys: sessione persistente, QR dataUrl, stati, retry backoff
'use strict';

const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage: baileysDownloadMedia } = require('@whiskeysockets/baileys');

const LOG = '[WEBQR]';
const RETRY_DELAYS_MS = [5000, 15000, 60000];
const AUTH_DIR_DEFAULT = path.join(process.cwd(), 'data', 'wa-webqr');

let sock = null;
let status = 'disconnected';
let lastQrDataUrl = null;
let lastError = null;
let updatedAt = Date.now();
let retryCount = 0;
let retryTimer = null;
/** Per evitare heap out of memory: logghiamo connection.update solo quando connection o hasQr cambiano (Baileys invia tantissimi update). */
let _lastLoggedConnection = null;
let _lastLoggedHasQr = null;

let onStatusCb = null;
let onQrCb = null;
let onErrorCb = null;
let onMessageCb = null;
let onMeCb = null;

function setStatus(s, err = null) {
  status = s;
  if (err) lastError = String(err.message || err);
  updatedAt = Date.now();
  if (onStatusCb) onStatusCb({ status, lastError, updatedAt });
}

function emitQr(dataUrl) {
  lastQrDataUrl = dataUrl;
  if (onQrCb) onQrCb(dataUrl);
}

function emitError(err) {
  lastError = String(err?.message || err);
  if (onErrorCb) onErrorCb(lastError);
}

function getAuthDir() {
  const dir = (process.env.WHATSAPP_WEBQR_AUTH_DIR || '').trim() || AUTH_DIR_DEFAULT;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn(`${LOG} ⚠️ auth dir create KO`, dir, e);
  }
  return dir;
}

async function connect(logger = console) {
  if (sock) {
    try { sock.end(undefined); } catch (_) {}
    sock = null;
  }
  setStatus('connecting');
  lastQrDataUrl = null;
  _lastLoggedConnection = null;
  _lastLoggedHasQr = null;

  const authDir = getAuthDir();
  try {
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
  } catch (e) {
    logger.warn(`${LOG} ⚠️ auth dir create KO`, authDir, e);
  }
  logger.info(`${LOG} 📲 connect start`, { attempt: retryCount + 1, authDir });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    // TASK 5: versione WA web (riduce handshake fail); opzionale se fetch fallisce
    let waVersion = null;
    try {
      const baileys = require('@whiskeysockets/baileys');
      if (typeof baileys.fetchLatestBaileysVersion === 'function') {
        const v = await baileys.fetchLatestBaileysVersion();
        waVersion = v?.version;
        logger.info(`${LOG} 🧪 wa-web version`, { version: waVersion });
      }
    } catch (e) {
      logger.warn(`${LOG} ⚠️ fetch version KO (uso default)`, { error: String(e?.message || e) });
    }
    const sockOpts = { auth: state };
    if (waVersion) sockOpts.version = waVersion;
    // printQRInTerminal rimosso: deprecato da Baileys; il QR viene gestito da connection.update (qr) e convertito in dataUrl qui sotto
    sock = makeWASocket(sockOpts);

    sock.ev.on('creds.update', saveCreds);

    function hasDownloadableMedia(message) {
      if (!message || typeof message !== 'object') return false;
      const m = message.ephemeralMessage?.message || message.viewOnceMessage?.message || message.viewOnceMessageV2?.message || message.documentWithCaptionMessage?.message || message;
      const content = m.imageMessage || m.videoMessage || m.documentMessage || m.audioMessage || m.stickerMessage;
      return content && typeof content === 'object' && ('url' in content || 'thumbnailDirectPath' in content);
    }

    sock.ev.on('messages.upsert', ({ type, messages }) => {
      if ((type !== 'notify' && type !== 'append') || !onMessageCb) return;
      const list = messages || [];
      logger.info(`${LOG} 📥 messages.upsert`, { type, count: list.length });
      for (const msg of list) {
        if (msg.key?.fromMe) continue;
        try {
          const m = msg.message || {};
          const rawType = Object.keys(m).find(k => k !== 'messageContextInfo') || 'unknown';
          const isMedia = rawType !== 'conversation' && rawType !== 'extendedTextMessage';
          let text = m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text) || null;
          if (text == null) text = isMedia ? '[media]' : '[non-text]';
          const from = msg.key.participant || msg.key.remoteJid || '';
          const fromNumber = (from && typeof from === 'string') ? from.replace(/\D/g, '').slice(-12) || from : '';
          const pushName = (msg.pushName && typeof msg.pushName === 'string') ? msg.pushName.trim() : null;
          const mediaType = isMedia ? rawType.replace(/Message$/i, '') : null; // imageMessage -> image, videoMessage -> video, etc.
          const normalized = {
            id: msg.key?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            ts: Number(msg.messageTimestamp) * 1000 || Date.now(),
            from,
            fromNumber: fromNumber || from,
            pushName: pushName || undefined,
            text: String(text).slice(0, 1024),
            rawType,
            hasMedia: !!isMedia,
            mediaType: mediaType || undefined,
          };
          const canDownloadMedia = isMedia && hasDownloadableMedia(msg.message);
          logger.info(`${LOG} 📩 message received`, { from: normalized.fromNumber, id: normalized.id, hasMedia: isMedia, canDownload: canDownloadMedia });
          onMessageCb(normalized, canDownloadMedia ? msg : null);
        } catch (e) {
          logger.warn(`${LOG} ⚠️ message normalize KO`, e);
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      const hasQr = !!qr;
      const conn = connection ?? 'undefined';
      // Log solo quando connection o hasQr cambiano (evita migliaia di log e heap out of memory)
      if (conn !== _lastLoggedConnection || hasQr !== _lastLoggedHasQr) {
        _lastLoggedConnection = conn;
        _lastLoggedHasQr = hasQr;
        const lastDisconnectCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message;
        logger.info(`${LOG} 🔌 connection.update`, { connection: conn, hasQr, lastDisconnectCode: lastDisconnectCode ?? null, reason: reason ?? null });
      }
      if (qr) {
        setStatus('qr');
        try {
          const dataUrl = await QRCode.toDataURL(qr, { type: 'image/png', margin: 1 });
          emitQr(dataUrl);
          logger.info(`${LOG} 🧾 qr generated`);
        } catch (e) {
          logger.warn(`${LOG} ⚠️ qr toDataURL KO`, e);
        }
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message;
        setStatus('disconnected', lastDisconnect?.error);
        logger.warn(`${LOG} ⚠️ connection close`, { code, reason });
        if (code === DisconnectReason.loggedOut) {
          emitError('Sessione disconnessa (logged out)');
          return;
        }
        const delay = RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)];
        retryCount++;
        logger.info(`${LOG} 🔁 retry in ${delay}ms (attempt ${retryCount})`, { code, reason });
        retryTimer = setTimeout(() => connect(logger), delay);
      }
      if (connection === 'open') {
        retryCount = 0;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        setStatus('ready');
        lastQrDataUrl = null;
        // Esponi "me" (jid, numberHuman, pushName) per UI "numero connesso"
        try {
          const jid = sock?.user?.id || null;
          if (jid && onMeCb) {
            // JID può essere "390737642142@s.whatsapp.net" o "390737642142:15@s.whatsapp.net" — rimuovi :XX prima di estrarre le cifre
            const jidPart = (jid && typeof jid === 'string') ? jid.split('@')[0] || '' : '';
            const withoutSuffix = jidPart.replace(/:\d+$/, '');
            let digits = withoutSuffix.replace(/\D/g, '').slice(-12) || '';
            // Normalizza numeri italiani: se inizia con 0 e ha 10 cifre (formato nazionale) → 39 + 10 cifre
            if (digits.startsWith('0') && digits.length === 10) {
              digits = '39' + digits;
            }
            digits = digits.slice(-12);
            const numberHuman = digits ? '+' + digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})/, '$1 $2 $3 $4').trim() : '';
            onMeCb({
              jid,
              number: digits,
              numberHuman: numberHuman || jid,
              pushName: sock?.user?.name || null,
            });
            logger.info(`${LOG} 👤 me`, { jid, numberHuman: numberHuman || jid });
          }
        } catch (e) {
          logger.warn(`${LOG} ⚠️ onMe KO`, { error: String(e?.message || e) });
        }
        logger.info(`${LOG} ✅ ready`);
      }
    });

    return sock;
  } catch (err) {
    setStatus('error', err);
    emitError(err);
    logger.error(`${LOG} ❌ connect KO`, err);
    throw err;
  }
}

function getStatus() {
  return { status, lastError, updatedAt };
}

function getRetryCount() {
  return retryCount;
}

function getQrDataUrl() {
  return status === 'qr' ? lastQrDataUrl : null;
}

function getSock() {
  return sock;
}

async function sendMessage(to, text, logger = console) {
  if (!sock || status !== 'ready') {
    throw new Error('WhatsApp WebQR non connesso (status: ' + status + ')');
  }
  const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text });
  logger.info(`${LOG} 📤 send ok`, { to: jid });
}

function registerCallbacks({ onStatus, onQr, onError, onMessage, onMe }) {
  onStatusCb = onStatus;
  onQrCb = onQr;
  onErrorCb = onError;
  onMessageCb = onMessage;
  onMeCb = onMe || null;
}

function shutdown() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (sock) {
    try { sock.end(undefined); } catch (_) {}
    sock = null;
  }
  setStatus('disconnected');
}

/** Scarica il media di un messaggio (per GET /media/:id). message = raw msg da messages.upsert. */
async function downloadMediaMessage(message, loggerInstance = console) {
  if (!message) throw new Error('message required');
  return baileysDownloadMedia(message, 'buffer', {}, { logger: loggerInstance });
}

module.exports = {
  connect,
  getStatus,
  getRetryCount,
  getAuthDir,
  getQrDataUrl,
  getSock,
  sendMessage,
  registerCallbacks,
  shutdown,
  downloadMediaMessage,
};
