'use strict';

/**
 * services/whatsapp.service.js
 * -----------------------------------------------------------------------------
 * ✅ UNICA FONTE DI VERITÀ WhatsApp (Twilio)
 *
 * Obiettivi:
 * 1) Inviare TEMPLATE approvato (Quick Reply) per aprire finestra 24h
 * 2) Gestire inbound webhook Twilio:
 *    - ButtonPayload / ButtonText / Body
 *    - OriginalRepliedMessageSid -> risalire a reservation_id
 * 3) BLOCCARE free-text fuori finestra 24h (evita “200 OK ma non consegnato”)
 * 4) Salvare tracking su DB (best-effort) + fallback in-memory in DEV
 *
 * ENV principali:
 * - WA_ENABLED=true|false
 * - TWILIO_ACCOUNT_SID=AC...
 * - TWILIO_AUTH_TOKEN=...
 * - WA_FROM=whatsapp:+1...   (numero WhatsApp abilitato su Twilio)
 * - WA_DEFAULT_CC=+39
 *
 * Template SID:
 * - WA_TEMPLATE_RESERVATION_CONFIRM_SID=HX...  (QUICK REPLY conferma prenotazione)
 * - WA_TEMPLATE_STATUS_CHANGE_SID=HX...        (template cambio stato - opzionale)
 *
 * Webhook:
 * - WA_WEBHOOK_BASE_URL=https://.... (PUBBLICO, raggiungibile da Twilio!)
 * - WA_BLOCK_FREE_TEXT_OUTSIDE_24H=true|false
 */

const logger = require('../logger');
const env    = require('../env');

// ----------------------------------------------------------------------------
// DB best-effort (se non c’è, fallback in-memory)
// ----------------------------------------------------------------------------
let dbQuery = null;
try {
  // eslint-disable-next-line global-require
  const db = require('../db');
  dbQuery = db.query || null;
} catch (e) {
  dbQuery = null;
}

// mysql2 compat: a volte query() ritorna [rows, fields]
async function dbExec(sql, params) {
  if (!dbQuery) return null;
  const out = await dbQuery(sql, params);
  if (Array.isArray(out) && Array.isArray(out[0])) return out[0];
  return out;
}

// ----------------------------------------------------------------------------
// Config letta da env.js + fallback process.env (così NON rompiamo nulla)
// ----------------------------------------------------------------------------
function envStr(v, fb = '') {
  const s = (v === undefined || v === null) ? '' : String(v);
  return s.trim() || fb;
}
function envBool(v, fb = false) {
  const s = envStr(v, '');
  if (!s) return fb;
  return ['1', 'true', 'yes', 'y', 'on'].includes(s.toLowerCase());
}

const CFG = {
  enabled : envBool(process.env.WA_ENABLED, !!env.WA?.enabled),
  sid     : envStr(process.env.TWILIO_ACCOUNT_SID, env.WA?.accountSid || ''),
  token   : envStr(process.env.TWILIO_AUTH_TOKEN, env.WA?.authToken || ''),
  from    : envStr(process.env.WA_FROM, env.WA?.from || ''),
  defaultCc: envStr(process.env.WA_DEFAULT_CC, env.WA?.defaultCc || '+39'),

  templateReservationConfirmSid: envStr(
    process.env.WA_TEMPLATE_RESERVATION_CONFIRM_SID,
    env.WA?.templateReservationConfirmSid || ''
  ),
  templateStatusChangeSid: envStr(
    process.env.WA_TEMPLATE_STATUS_CHANGE_SID,
    // fallback vecchio nome
    env.WA?.templateStatusChangeSid || env.WA?.templateSid || ''
  ),

  webhookBaseUrl: envStr(
    process.env.WA_WEBHOOK_BASE_URL,
    env.WA?.webhookBaseUrl || env.PUBLIC_BASE_URL || ''
  ),

  blockFreeTextOutside24h: envBool(
    process.env.WA_BLOCK_FREE_TEXT_OUTSIDE_24H,
    !!env.WA?.blockFreeTextOutside24h
  ),

  logContent: envBool(process.env.WA_LOG_CONTENT, !!env.WA?.logContent),
};

// ----------------------------------------------------------------------------
// Fallback in-memory (DEV)
// ----------------------------------------------------------------------------
const mem = {
  lastInboundAtByPhone: new Map(), // phone_e164 -> Date
  outboundLinkBySid: new Map(),    // templateSid(MessageSid) -> { reservationId, kind, toPhone, createdAt }
};

// ----------------------------------------------------------------------------
// Twilio lazy require
// ----------------------------------------------------------------------------
let _twilioFactory = null;
function _loadTwilioFactory() {
  if (_twilioFactory) return _twilioFactory;
  try {
    // eslint-disable-next-line global-require
    _twilioFactory = require('twilio');
    return _twilioFactory;
  } catch (e) {
    logger.warn('📲 WA: modulo "twilio" non risolvibile (non installato?)', { error: String(e) });
    _twilioFactory = null;
    return null;
  }
}

let _client = null;
function getClient() {
  if (!CFG.enabled) return null;

  const twilioFactory = _loadTwilioFactory();
  if (!twilioFactory) return null;

  if (!CFG.sid || !CFG.token) {
    logger.warn('📲 WA: credenziali Twilio mancanti', {
      wa_env: { enabled: CFG.enabled, hasSid: !!CFG.sid, hasToken: !!CFG.token, hasFrom: !!CFG.from }
    });
    return null;
  }

  if (!_client) {
    _client = twilioFactory(CFG.sid, CFG.token);
    logger.info('📳 WA client inizializzato', {
      wa_env: { enabled: CFG.enabled, hasSid: !!CFG.sid, hasToken: !!CFG.token, from: CFG.from ? '[set]' : '' }
    });
  }

  return _client;
}

// ----------------------------------------------------------------------------
// Helpers phone
// ----------------------------------------------------------------------------
function _stripWhatsappPrefix(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  return s.startsWith('whatsapp:') ? s.slice('whatsapp:'.length) : s;
}

function normalizeToE164(phone) {
  if (!phone) return null;

  let p = _stripWhatsappPrefix(phone);
  p = String(p).trim();
  p = p.replace(/[^\d+]/g, '');

  if (!p) return null;
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return '+' + p.slice(2);

  // fallback: aggiungo prefisso default (es +39)
  return (CFG.defaultCc || '+39') + p.replace(/^0+/, '');
}

function toWhatsAppAddress(phoneE164) {
  const p = normalizeToE164(phoneE164);
  if (!p) return null;
  return `whatsapp:${p}`;
}

function fromWhatsAppAddress(addr) {
  if (!addr) return null;
  const a = String(addr);
  return a.startsWith('whatsapp:') ? a.replace('whatsapp:', '') : a;
}

function _normalizeFrom(from) {
  const raw = String(from || '').trim();
  if (!raw) return '';

  if (raw.startsWith('whatsapp:')) return raw;

  const e164 = normalizeToE164(raw);
  if (!e164) return '';
  return `whatsapp:${e164}`;
}

function safeJson(obj) {
  try { return JSON.stringify(obj); } catch (e) { return '{"_error":"json_stringify_failed"}'; }
}

// ----------------------------------------------------------------------------
// DB helpers (best-effort)
// ----------------------------------------------------------------------------
async function upsertContactInbound(phoneE164, waId, profileName, inboundAtUtc) {
  if (!phoneE164) return;

  mem.lastInboundAtByPhone.set(phoneE164, inboundAtUtc);

  if (!dbQuery) return;
  try {
    await dbExec(
      `
      INSERT INTO wa_contacts (phone_e164, wa_id, profile_name, last_inbound_at)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        wa_id = VALUES(wa_id),
        profile_name = VALUES(profile_name),
        last_inbound_at = VALUES(last_inbound_at)
      `,
      [phoneE164, waId || null, profileName || null, inboundAtUtc]
    );
  } catch (e) {
    logger.warn(`⚠️ WA contacts upsert fallito (ok in DEV): ${e.message}`, { service: 'server' });
  }
}

async function insertWaMessage(row) {
  if (!row || !row.sid) return;

  // Fallback in-memory per link (importantissimo per OriginalRepliedMessageSid)
  if (row.direction === 'out') {
    mem.outboundLinkBySid.set(row.sid, {
      reservationId: row.reservation_id || null,
      kind: row.kind,
      toPhone: row.to_phone || null,
      createdAt: new Date(),
    });
  }

  if (!dbQuery) return;
  try {
    await dbExec(
      `
      INSERT INTO wa_messages
        (sid, direction, kind, to_phone, from_phone, reservation_id, status, payload_json, created_at)
      VALUES
        (?,   ?,         ?,    ?,        ?,          ?,             ?,      ?,           UTC_TIMESTAMP())
      `,
      [
        row.sid,
        row.direction,
        row.kind,
        row.to_phone || null,
        row.from_phone || null,
        row.reservation_id || null,
        row.status || null,
        row.payload_json || null,
      ]
    );
  } catch (e) {
    logger.warn(`⚠️ WA messages insert fallito (ok in DEV): ${e.message}`, { service: 'server' });
  }
}

async function updateWaMessageStatus(messageSid, status, errorCode, errorMessage, payload) {
  if (!messageSid) return;

  if (!dbQuery) return;
  try {
    await dbExec(
      `
      UPDATE wa_messages
      SET status = ?, error_code = ?, error_message = ?, payload_json = COALESCE(payload_json, ?)
      WHERE sid = ?
      `,
      [status || null, errorCode || null, errorMessage || null, payload ? safeJson(payload) : null, messageSid]
    );
  } catch (e) {
    logger.warn(`⚠️ WA status update fallito (ok in DEV): ${e.message}`, { service: 'server' });
  }
}

async function getLastInboundAt(phoneE164) {
  if (!phoneE164) return null;

  if (dbQuery) {
    try {
      const rows = await dbExec(`SELECT last_inbound_at FROM wa_contacts WHERE phone_e164 = ? LIMIT 1`, [phoneE164]);
      const r = Array.isArray(rows) ? rows[0] : null;
      if (r && r.last_inbound_at) return new Date(r.last_inbound_at);
    } catch (e) {
      // ignore
    }
  }

  return mem.lastInboundAtByPhone.get(phoneE164) || null;
}

async function findOutboundLinkBySid(originalSid) {
  if (!originalSid) return null;

  if (dbQuery) {
    try {
      const rows = await dbExec(
        `
        SELECT reservation_id, kind, to_phone
        FROM wa_messages
        WHERE sid = ? AND direction = 'out'
        ORDER BY id DESC
        LIMIT 1
        `,
        [originalSid]
      );
      const r = Array.isArray(rows) ? rows[0] : null;
      if (r) {
        return { reservationId: r.reservation_id || null, kind: r.kind || null, toPhone: r.to_phone || null };
      }
    } catch (e) {
      // ignore
    }
  }

  return mem.outboundLinkBySid.get(originalSid) || null;
}

async function isWithin24hSession(phoneE164) {
  const last = await getLastInboundAt(phoneE164);
  if (!last) return false;
  const diffMs = Date.now() - last.getTime();
  return diffMs >= 0 && diffMs <= 24 * 60 * 60 * 1000;
}

// ----------------------------------------------------------------------------
// URL callback status
// ----------------------------------------------------------------------------
function buildStatusCallbackUrl() {
  const base = envStr(CFG.webhookBaseUrl, '');
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/api/notifications/wa/status`;
}

// ----------------------------------------------------------------------------
// API: FREE TEXT
// ----------------------------------------------------------------------------
async function sendText(arg1, arg2, arg3) {
  // Firma compat:
  // - sendText(to, text, mediaUrl?)
  // - sendText({ to, text, mediaUrl?, from?, allowOutsideWindow? })
  let to = null;
  let text = null;
  let mediaUrl = null;
  let from = null;
  let allowOutsideWindow = false;

  if (arg1 && typeof arg1 === 'object') {
    to = arg1.to;
    text = arg1.text ?? arg1.body ?? arg1.message ?? null;
    mediaUrl = arg1.mediaUrl ?? null;
    from = arg1.from ?? null;
    allowOutsideWindow = !!arg1.allowOutsideWindow;
  } else {
    to = arg1;
    text = arg2;
    mediaUrl = arg3 ?? null;
  }

  if (!CFG.enabled) {
    logger.warn('📲 WA SKIPPED (disabled)', { to: String(to || '') });
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  const client = getClient();
  if (!client) {
    logger.warn('📲 WA SKIPPED (client_unavailable)', { to: String(to || '') });
    return { ok: false, skipped: true, reason: 'client_unavailable' };
  }

  const phone = normalizeToE164(to);
  if (!phone) {
    logger.warn('📲 WA SKIPPED (no_phone)', { to: String(to || '') });
    return { ok: false, skipped: true, reason: 'no_phone' };
  }

  const body = String(text || '').trim();
  if (!body) {
    logger.warn('📲 WA SKIPPED (empty_text)', { to: phone });
    return { ok: false, skipped: true, reason: 'empty_text' };
  }

  // BLOCCO fuori 24h (se attivo)
  if (CFG.blockFreeTextOutside24h && !allowOutsideWindow) {
    const inSession = await isWithin24hSession(phone);
    if (!inSession) {
      logger.warn('⛔ WA free-text BLOCCATO (fuori finestra 24h) -> usa TEMPLATE', { service: 'server', to: phone });
      return { ok: false, skipped: true, reason: 'outside_24h_window_use_template' };
    }
  }

  const waFrom = _normalizeFrom(from || CFG.from);
  if (!waFrom) {
    logger.warn('📲 WA SKIPPED (missing_from)', { to: phone });
    return { ok: false, skipped: true, reason: 'missing_from' };
  }

  const payload = {
    from: waFrom,
    to: toWhatsAppAddress(phone),
    body,
  };

  const cb = buildStatusCallbackUrl();
  if (cb) payload.statusCallback = cb;

  if (mediaUrl) {
    if (Array.isArray(mediaUrl)) {
      const arr = mediaUrl.map(x => String(x || '').trim()).filter(Boolean);
      if (arr.length) payload.mediaUrl = arr;
    } else {
      const u = String(mediaUrl).trim();
      if (u) payload.mediaUrl = [u];
    }
  }

  logger.info('📲 WA sendText ▶️', {
    service: 'server',
    to: phone,
    hasMedia: !!payload.mediaUrl,
    body: CFG.logContent ? body : '[hidden]'
  });

  const msg = await client.messages.create(payload);

  logger.info('📲 WA sendText OK ✅', { service: 'server', sid: msg.sid, to: phone });

  await insertWaMessage({
    sid: msg.sid,
    direction: 'out',
    kind: 'free_text',
    to_phone: phone,
    from_phone: fromWhatsAppAddress(waFrom),
    reservation_id: null,
    status: msg.status || null,
    payload_json: safeJson({ payload }),
  });

  return { ok: true, sid: msg.sid, skipped: false, reason: null };
}

// Alias compat
async function sendMessage(...args) {
  return sendText(...args);
}

// ----------------------------------------------------------------------------
// API: TEMPLATE (Content API)
// ----------------------------------------------------------------------------
async function sendTemplate({ to, contentSid, variables = {}, kind = 'template', reservationId = null }) {
  const phone = normalizeToE164(to);
  if (!phone) return { ok: false, skipped: true, reason: 'invalid_to' };
  if (!contentSid) return { ok: false, skipped: true, reason: 'missing_contentSid' };

  if (!CFG.enabled) return { ok: false, skipped: true, reason: 'disabled' };

  const client = getClient();
  if (!client) return { ok: false, skipped: true, reason: 'client_unavailable' };

  const waFrom = _normalizeFrom(CFG.from);
  if (!waFrom) return { ok: false, skipped: true, reason: 'missing_from' };

  const payload = {
    from: waFrom,
    to: toWhatsAppAddress(phone),
    contentSid,
    contentVariables: safeJson(variables),
  };

  const cb = buildStatusCallbackUrl();
  if (cb) payload.statusCallback = cb;

  logger.info('📲 WA template send ▶️', {
    service: 'server',
    to: phone,
    kind,
    reservationId: reservationId || null,
    contentSid
  });

  const msg = await client.messages.create(payload);

  logger.info('📲 WA template OK ✅', {
    service: 'server',
    sid: msg.sid,
    to: phone,
    kind,
    reservationId: reservationId || null
  });

  // IMPORTANTISSIMO: link SID template -> reservationId
  await insertWaMessage({
    sid: msg.sid,
    direction: 'out',
    kind,
    to_phone: phone,
    from_phone: fromWhatsAppAddress(waFrom),
    reservation_id: reservationId,
    status: msg.status || null,
    payload_json: safeJson({ payload }),
  });

  return { ok: true, sid: msg.sid, skipped: false, reason: null };
}

// ----------------------------------------------------------------------------
// TEMPLATE: Prenotazione - conferma (quello che hai creato)
// Variabili:
//  {{1}} Nome
//  {{2}} Data
//  {{3}} Ora
//  {{4}} Coperti
// ----------------------------------------------------------------------------
async function sendReservationConfirmTemplate({ to, name, dateStr, timeStr, peopleStr, reservationId }) {
  const sid = CFG.templateReservationConfirmSid;
  if (!sid) {
    logger.error('❌ WA_TEMPLATE_RESERVATION_CONFIRM_SID mancante in .env', { service: 'server' });
    return { ok: false, skipped: true, reason: 'missing_env_template_sid' };
  }

  const vars = {
    1: String(name || '').trim() || 'Cliente',
    2: String(dateStr || '').trim() || '-',
    3: String(timeStr || '').trim() || '-',
    4: String(peopleStr || '').trim() || '-',
  };

  return sendTemplate({
    to,
    contentSid: sid,
    variables: vars,
    kind: 'reservation_confirm',
    reservationId: reservationId || null,
  });
}

// ----------------------------------------------------------------------------
// STATUS CHANGE (compat + template opzionale)
// ----------------------------------------------------------------------------
function buildStatusText({ status, dateYmd, timeHm, partySize, name, tableName }) {
  const S = String(status || '').toUpperCase();
  const n = name ? ` ${name}` : '';
  const when = (dateYmd && timeHm) ? ` per il ${dateYmd} alle ${timeHm}` : '';
  const pax = partySize ? ` (persone: ${partySize})` : '';
  const tbl = tableName ? ` • ${tableName}` : '';
  return `🟢 Aggiornamento prenotazione${n}:\nStato: ${S}${when}${pax}${tbl}\n— ${env.MAIL?.bizName || 'La tua attività'}`;
}

async function sendStatusChange({ to, reservation, status, reason }) {
  if (!CFG.enabled) {
    logger.warn('📲 WA SKIPPED (disabled)', { id: reservation?.id });
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  const phone = normalizeToE164(to || reservation?.contact_phone || reservation?.phone);
  if (!phone) {
    logger.warn('📲 WA SKIPPED (no phone)', { id: reservation?.id });
    return { ok: false, skipped: true, reason: 'no_phone' };
  }

  // Ricavo data/ora dal start_at (best-effort)
  const start = reservation?.start_at ? new Date(reservation.start_at) : null;
  const ymd = start ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}` : null;
  const hm  = start ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}` : null;

  const name = reservation?.display_name || [reservation?.customer_first, reservation?.customer_last].filter(Boolean).join(' ');
  const body = buildStatusText({
    status,
    dateYmd: ymd,
    timeHm: hm,
    partySize: reservation?.party_size,
    name,
    tableName: reservation?.table_name
  });

  // Se hai un template status-change lo uso (fuori finestra va bene)
  if (CFG.templateStatusChangeSid) {
    const vars = {
      '1': name || 'Cliente',
      '2': String(status || '').toUpperCase(),
      '3': `${ymd || ''} ${hm || ''}`.trim(),
      '4': String(reservation?.party_size || ''),
      '5': reservation?.table_name || '',
      '6': reason || ''
    };

    return sendTemplate({
      to: phone,
      contentSid: CFG.templateStatusChangeSid,
      variables: vars,
      kind: 'status_change',
      reservationId: reservation?.id || null,
    });
  }

  // Freeform: dentro 24h (se blocco attivo)
  return sendText({ to: phone, text: body });
}

// ----------------------------------------------------------------------------
// Webhook inbound: parsing + action detect
// ----------------------------------------------------------------------------
function detectAction({ bodyText, buttonText, buttonPayload }) {
  const t  = String(bodyText || '').trim().toLowerCase();
  const bt = String(buttonText || '').trim().toLowerCase();
  const bp = String(buttonPayload || '').trim().toLowerCase();
  const hay = `${t} ${bt} ${bp}`.trim();

  // Nel tuo caso:
  // - bottone "CONFERMO" (ID magari "CAMBIA ORARIO") -> confirm
  // - bottone "ANNULLA" (ID "cancel") -> cancel
  if (hay.includes('confermo') || hay.includes('confirm') || hay.includes('cambia orario')) return 'confirm';
  if (hay.includes('annulla') || hay.includes('cancel')) return 'cancel';

  return null;
}

async function handleInboundWebhook(form) {
  const messageSid = form.MessageSid || form.SmsSid || null;
  const fromAddr   = form.From || null; // whatsapp:+39...
  const toAddr     = form.To || null;

  const fromPhone = normalizeToE164(fromWhatsAppAddress(fromAddr));
  const toPhone   = normalizeToE164(fromWhatsAppAddress(toAddr));

  const bodyText      = form.Body || '';
  const buttonText    = form.ButtonText || '';
  const buttonPayload = form.ButtonPayload || '';

  const originalSid = form.OriginalRepliedMessageSid || null;

  const profileName = form.ProfileName || null;
  const waId        = form.WaId || null;

  // 1) aggiorno inbound (apre finestra 24h)
  await upsertContactInbound(fromPhone, waId, profileName, new Date());

  // 2) salvo inbound in tabella
  if (messageSid) {
    await insertWaMessage({
      sid: messageSid,
      direction: 'in',
      kind: 'inbound',
      to_phone: toPhone,
      from_phone: fromPhone,
      reservation_id: null,
      status: null,
      payload_json: safeJson(form),
    });
  }

  // 3) azione
  const action = detectAction({ bodyText, buttonText, buttonPayload });

  // 4) link reservation via OriginalRepliedMessageSid
  let link = null;
  if (action && originalSid) {
    link = await findOutboundLinkBySid(originalSid);
  }

  const out = {
    ok: true,
    messageSid,
    fromPhone,
    toPhone,
    bodyText,
    buttonText,
    buttonPayload,
    originalSid,
    action, // 'confirm' | 'cancel' | null
    reservationId: link ? link.reservationId : null,
    linkedKind: link ? link.kind : null,
  };

  logger.info('📩 WA inbound', {
    service: 'server',
    from: fromPhone,
    action: out.action,
    reservationId: out.reservationId,
    originalSid: out.originalSid,
  });

  return out;
}

// ----------------------------------------------------------------------------
// Health
// ----------------------------------------------------------------------------
function health() {
  const hasTwilioModule = !!_loadTwilioFactory();
  return {
    enabled: !!CFG.enabled,
    hasTwilioModule,
    hasSid: !!CFG.sid,
    hasToken: !!CFG.token,
    hasFrom: !!CFG.from,
    defaultCc: CFG.defaultCc || '+39',
    webhookBaseUrl: CFG.webhookBaseUrl ? '[set]' : '',
    blockFreeTextOutside24h: !!CFG.blockFreeTextOutside24h,
    hasTemplateReservationConfirm: !!CFG.templateReservationConfirmSid,
    hasTemplateStatusChange: !!CFG.templateStatusChangeSid,
  };
}

module.exports = {
  getClient,

  // Send
  sendText,
  sendMessage,
  sendTemplate,
  sendReservationConfirmTemplate,
  sendStatusChange,

  // Webhook
  handleInboundWebhook,
  updateWaMessageStatus,

  // Utils
  _normalizeToE164: normalizeToE164,

  // Debug
  health,
};
