'use strict';

/**
 * services/whatsapp.service.js
 * -----------------------------------------------------------------------------
 * ✅ UNICA FONTE DI VERITÀ per WhatsApp nel backend (provider: Twilio).
 *
 * OBIETTIVI (superset: nuovo + vecchio):
 * 1) Manteniamo API STABILE già usata nel progetto:
 *    - sendText(to, text, mediaUrl?)
 *    - sendText({ to, text, mediaUrl?, from?, allowOutsideWindow? })
 *    - sendMessage(...) alias
 *    - sendStatusChange({ to, reservation, status, reason?, mediaLogo? })
 *    - _normalizeToE164(phone)
 *    - health()
 *
 * 2) Aggiungiamo la logica “vecchia” richiesta per TEMPLATE + WEBHOOK:
 *    - sendTemplate({ to, contentSid, variables, kind?, reservationId? })
 *    - sendReservationConfirmTemplate({ to, name, dateStr, timeStr, peopleStr, reservationId })
 *    - handleInboundWebhook(form)  // Twilio inbound (ButtonText/ButtonPayload/Body)
 *    - handleStatusCallback(form)  // Twilio status callback
 *
 * 3) BLOCCO free-text fuori finestra 24h (opzionale via ENV) per evitare:
 *    “200 OK ma non consegnato” su WhatsApp.
 *
 * 4) Tracking su DB (best-effort) + fallback in-memory in DEV:
 *    - wa_contacts: last_inbound_at per finestra 24h
 *    - wa_messages : mapping SID template -> reservation_id + status updates
 *
 * ENV (vedi src/env.js):
 * - WA_ENABLED=true|false
 * - TWILIO_ACCOUNT_SID=...
 * - TWILIO_AUTH_TOKEN=...
 * - WA_FROM=whatsapp:+...
 * - WA_DEFAULT_CC=+39
 * - WA_TEMPLATE_STATUS_CHANGE_SID=HX...                (opzionale Content API)
 * - WA_TEMPLATE_RESERVATION_CONFIRM_SID=HX...          (Quick Reply)
 * - WA_BLOCK_FREE_TEXT_OUTSIDE_24H=true|false
 * - WA_WEBHOOK_BASE_URL=https://api.tuodominio.it      (prod)
 * - WA_AUTO_APPLY_ACTIONS=true|false                   (facoltativo)
 */

const logger = require('../logger');
const env = require('../env');

// -----------------------------------------------------------------------------
// DB (best-effort): se non c’è, fallback in-memory (DEV)
// -----------------------------------------------------------------------------
let dbQuery = null;
try {
  // Nel tuo progetto di solito esiste ../db con export { query }
  // eslint-disable-next-line global-require
  const db = require('../db');
  dbQuery = db?.query || null;
} catch (_e) {
  dbQuery = null;
}

// fallback DEV
const mem = {
  lastInboundAtByPhone: new Map(), // phone_e164 -> Date
  outboundLinkBySid: new Map(),    // sid -> { reservationId, kind, toPhone, createdAt }
};

// -----------------------------------------------------------------------------
// Twilio lazy load: se WA disabilitato NON deve crashare il server
// -----------------------------------------------------------------------------
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

/**
 * getClient()
 * - singleton Twilio client
 * - se disabilitato o misconfigurato → null (best-effort)
 */
function getClient() {
  if (!env.WA?.enabled) return null;

  const twilioFactory = _loadTwilioFactory();
  if (!twilioFactory) return null;

  if (!env.WA.accountSid || !env.WA.authToken) {
    logger.warn('📲 WA: credenziali Twilio mancanti', { wa_env: env._debugWaConfig?.() });
    return null;
  }

  if (!_client) {
    _client = twilioFactory(env.WA.accountSid, env.WA.authToken);
    logger.info('📳 WA client inizializzato', { wa_env: env._debugWaConfig?.() });
  }

  return _client;
}

// -----------------------------------------------------------------------------
// Helper: string safe / json safe
// -----------------------------------------------------------------------------
function safeJson(obj) {
  try { return JSON.stringify(obj); } catch { return '{"_error":"json_stringify_failed"}'; }
}

function _stripWhatsappPrefix(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  return s.startsWith('whatsapp:') ? s.slice('whatsapp:'.length) : s;
}

/**
 * Normalizzazione grezza in E.164 (default IT):
 * - accetta: "333..." / "+39333..." / "0039333..." / "whatsapp:+39333..."
 * - output: "+39333..."
 */
function normalizeToE164(phone) {
  if (!phone) return null;

  let p = _stripWhatsappPrefix(phone);
  p = String(p).trim();
  p = p.replace(/[^\d+]/g, '');

  if (!p) return null;
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return '+' + p.slice(2);

  // fallback: aggiungo prefisso di default (es: +39)
  return (env.WA.defaultCc || '+39') + p.replace(/^0+/, '');
}

/**
 * Normalizza "from" per Twilio:
 * - input: "whatsapp:+39..." oppure "+39..." oppure "0039..." oppure "333..."
 * - output: "whatsapp:+39..."
 */
function _normalizeFrom(from) {
  const raw = String(from || '').trim();
  if (!raw) return '';
  if (raw.startsWith('whatsapp:')) return raw;

  const e164 = normalizeToE164(raw);
  if (!e164) return '';
  return `whatsapp:${e164}`;
}

function fromWhatsAppAddress(addr) {
  if (!addr) return null;
  const a = String(addr);
  return a.startsWith('whatsapp:') ? a.replace('whatsapp:', '') : a;
}

function toWhatsAppAddress(phoneE164) {
  if (!phoneE164) return null;
  const p = String(phoneE164).trim();
  return p.startsWith('whatsapp:') ? p : `whatsapp:${p}`;
}

// -----------------------------------------------------------------------------
// DB helpers (best-effort)
// -----------------------------------------------------------------------------
async function dbExec(sql, params) {
  if (!dbQuery) return null;
  return dbQuery(sql, params);
}

async function upsertContactInbound(phoneE164, waId, profileName, inboundAtUtc) {
  if (!phoneE164) return;

  // fallback memory sempre aggiornato
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
    logger.warn('⚠️ WA contacts upsert fallito (ok in DEV)', { error: String(e?.message || e) });
  }
}

async function insertWaMessage(row) {
  if (!row || !row.sid) return;

  // fallback memory: mapping outbound SID -> reservationId
  if (row.direction === 'out') {
    mem.outboundLinkBySid.set(row.sid, {
      reservationId: row.reservation_id || null,
      kind: row.kind || null,
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
    // duplicate sid non è grave
    logger.warn('⚠️ WA messages insert fallito (ok in DEV)', { error: String(e?.message || e) });
  }
}

async function updateWaMessageStatus(sid, status, errorCode, errorMessage, payload) {
  if (!sid) return;

  if (!dbQuery) return;
  try {
    await dbExec(
      `
      UPDATE wa_messages
      SET status = ?, error_code = ?, error_message = ?,
          payload_json = IFNULL(payload_json, ?)
      WHERE sid = ?
      `,
      [status || null, errorCode || null, errorMessage || null, payload ? safeJson(payload) : null, sid]
    );
  } catch (e) {
    logger.warn('⚠️ WA status update fallito (ok in DEV)', { error: String(e?.message || e) });
  }
}

async function getLastInboundAt(phoneE164) {
  if (!phoneE164) return null;

  // 1) DB
  if (dbQuery) {
    try {
      const rows = await dbExec(
        `SELECT last_inbound_at FROM wa_contacts WHERE phone_e164 = ? LIMIT 1`,
        [phoneE164]
      );
      const r = Array.isArray(rows) ? rows[0] : null;
      if (r && r.last_inbound_at) return new Date(r.last_inbound_at);
    } catch (_e) {
      // ignore
    }
  }

  // 2) memory
  return mem.lastInboundAtByPhone.get(phoneE164) || null;
}

async function findOutboundLinkBySid(originalSid) {
  if (!originalSid) return null;

  // 1) DB
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
        return {
          reservationId: r.reservation_id || null,
          kind: r.kind || null,
          toPhone: r.to_phone || null,
        };
      }
    } catch (_e) {
      // ignore
    }
  }

  // 2) memory
  return mem.outboundLinkBySid.get(originalSid) || null;
}

async function isWithin24hSession(phoneE164) {
  const last = await getLastInboundAt(phoneE164);
  if (!last) return false;
  const diffMs = Date.now() - last.getTime();
  return diffMs >= 0 && diffMs <= 24 * 60 * 60 * 1000;
}

// -----------------------------------------------------------------------------
// Status callback URL (prod)
// -----------------------------------------------------------------------------
function buildStatusCallbackUrl() {
  const base = String(env.WA?.webhookBaseUrl || '').trim();
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/api/notifications/wa/status`;
}

// -----------------------------------------------------------------------------
// Corpo testo “status change” (IT) — lo manteniamo uguale a prima
// -----------------------------------------------------------------------------
function buildStatusText({ status, dateYmd, timeHm, partySize, name, tableName }) {
  const S = String(status || '').toUpperCase();
  const n = name ? ` ${name}` : '';
  const when = (dateYmd && timeHm) ? ` per il ${dateYmd} alle ${timeHm}` : '';
  const pax = partySize ? ` (persone: ${partySize})` : '';
  const tbl = tableName ? ` • ${tableName}` : '';
  return `🟢 Aggiornamento prenotazione${n}:\nStato: ${S}${when}${pax}${tbl}\n— ${env.MAIL?.bizName || 'La tua attività'}`;
}

// -----------------------------------------------------------------------------
// API: sendText (free-text) — compat + blocco 24h opzionale
// -----------------------------------------------------------------------------
async function sendText(arg1, arg2, arg3) {
  // === Parse parametri compat =================================================
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

  // === Guardie =================================================================
  if (!env.WA?.enabled) {
    logger.warn('📲 WA SKIPPED (disabled)', { to: String(to || '') });
    return { skipped: true, reason: 'disabled' };
  }

  const client = getClient();
  if (!client) {
    logger.warn('📲 WA SKIPPED (client_unavailable)', { to: String(to || ''), wa_env: env._debugWaConfig?.() });
    return { skipped: true, reason: 'client_unavailable' };
  }

  const phone = normalizeToE164(to);
  if (!phone) {
    logger.warn('📲 WA SKIPPED (no_phone)', { to: String(to || '') });
    return { skipped: true, reason: 'no_phone' };
  }

  const body = String(text || '').trim();
  if (!body) {
    logger.warn('📲 WA SKIPPED (empty_text)', { to: phone });
    return { skipped: true, reason: 'empty_text' };
  }

  // ✅ Blocco free-text fuori 24h (se attivo)
  if (env.WA.blockFreeTextOutside24h && !allowOutsideWindow) {
    const inSession = await isWithin24hSession(phone);
    if (!inSession) {
      logger.warn('⛔ WA free-text BLOCCATO (fuori finestra 24h) -> usa TEMPLATE', { to: phone });
      return { skipped: true, reason: 'outside_24h_window_use_template' };
    }
  }

  const waFrom = _normalizeFrom(from || env.WA.from);
  if (!waFrom) {
    logger.warn('📲 WA SKIPPED (missing_from)', { wa_env: env._debugWaConfig?.() });
    return { skipped: true, reason: 'missing_from' };
  }

  const payload = {
    from: waFrom,
    to: `whatsapp:${phone}`,
    body,
    statusCallback: buildStatusCallbackUrl() || undefined,
  };

  if (mediaUrl) {
    if (Array.isArray(mediaUrl)) {
      const arr = mediaUrl.map(x => String(x || '').trim()).filter(Boolean);
      if (arr.length) payload.mediaUrl = arr;
    } else {
      const u = String(mediaUrl).trim();
      if (u) payload.mediaUrl = [u];
    }
  }

  if (env.WA.logContent) logger.info('📲 WA sendText ▶️', { to: phone, body });
  else logger.info('📲 WA sendText ▶️', { to: phone, hasMedia: !!payload.mediaUrl });

  const msg = await client.messages.create(payload);

  logger.info('📲 WA sendText OK ✅', { sid: msg.sid, to: phone });

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

  return { ok: true, sid: msg.sid };
}

async function sendMessage(...args) {
  return sendText(...args);
}

// -----------------------------------------------------------------------------
// API: sendTemplate (Content API) — serve per fuori 24h (e per Quick Reply)
// -----------------------------------------------------------------------------
async function sendTemplate({ to, contentSid, variables = {}, kind = 'template', reservationId = null }) {
  if (!env.WA?.enabled) return { skipped: true, reason: 'disabled' };

  const client = getClient();
  if (!client) return { skipped: true, reason: 'client_unavailable' };

  const phone = normalizeToE164(to);
  if (!phone) return { skipped: true, reason: 'no_phone' };
  if (!contentSid) return { skipped: true, reason: 'missing_contentSid' };

  const waFrom = _normalizeFrom(env.WA.from);
  if (!waFrom) return { skipped: true, reason: 'missing_from' };

  const payload = {
    from: waFrom,
    to: `whatsapp:${phone}`,
    contentSid,
    contentVariables: safeJson(variables),
    statusCallback: buildStatusCallbackUrl() || undefined,
  };

  logger.info('📲 WA template send ▶️', { to: phone, kind, reservationId: reservationId || null });

  const msg = await client.messages.create(payload);

  logger.info('📲 WA template OK ✅', { sid: msg.sid, to: phone, kind, reservationId: reservationId || null });

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

  return { ok: true, sid: msg.sid, template: true };
}

// -----------------------------------------------------------------------------
// TEMPLATE: Prenotazione - conferma (Quick Reply)
// Variabili: {{1}} Nome, {{2}} Data, {{3}} Ora, {{4}} Coperti
// -----------------------------------------------------------------------------
async function sendReservationConfirmTemplate({ to, name, dateStr, timeStr, peopleStr, reservationId }) {
  const sid = env.WA.templateReservationConfirmSid;
  if (!sid) {
    logger.warn('📲 WA confirm-template SKIPPED: manca WA_TEMPLATE_RESERVATION_CONFIRM_SID', { reservationId });
    return { skipped: true, reason: 'missing_env_template_reservation_confirm_sid' };
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

// -----------------------------------------------------------------------------
// sendStatusChange — come già avevi, MA ora:
// - se templateSid presente -> Content API
// - altrimenti freeform (ma passa dal nostro sendText che può bloccare fuori 24h)
// -----------------------------------------------------------------------------
async function sendStatusChange({ to, reservation, status, reason, mediaLogo }) {
  if (!env.WA?.enabled) {
    logger.warn('📲 WA SKIPPED (disabled)', { id: reservation?.id });
    return { skipped: true, reason: 'disabled' };
  }

  const client = getClient();
  if (!client) {
    logger.warn('📲 WA SKIPPED (client_unavailable)', { id: reservation?.id, wa_env: env._debugWaConfig?.() });
    return { skipped: true, reason: 'client_unavailable' };
  }

  const phone = normalizeToE164(to || reservation?.contact_phone || reservation?.phone);
  if (!phone) {
    logger.warn('📲 WA SKIPPED (no phone)', { id: reservation?.id });
    return { skipped: true, reason: 'no_phone' };
  }

  // Dati testo (best-effort)
  const start = reservation?.start_at ? new Date(reservation.start_at) : null;
  const ymd = start ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}` : null;
  const hm = start ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}` : null;

  const name = reservation?.display_name || [reservation?.customer_first, reservation?.customer_last].filter(Boolean).join(' ');
  const body = buildStatusText({
    status,
    dateYmd: ymd,
    timeHm: hm,
    partySize: reservation?.party_size,
    name,
    tableName: reservation?.table_name,
  });

  // Template (Content API) se disponibile
  if (env.WA.templateSid) {
    const vars = {
      '1': name || 'Cliente',
      '2': String(status || '').toUpperCase(),
      '3': `${ymd || ''} ${hm || ''}`.trim(),
      '4': String(reservation?.party_size || ''),
      '5': reservation?.table_name || '',
      '6': reason || '',
    };

    const waFrom = _normalizeFrom(env.WA.from);
    if (!waFrom) return { skipped: true, reason: 'missing_from' };

    logger.info('📲 WA template status ▶️', { to: phone, templateSid: '[set]', vars });

    const msg = await client.messages.create({
      from: waFrom,
      to: `whatsapp:${phone}`,
      contentSid: env.WA.templateSid,
      contentVariables: JSON.stringify(vars),
      statusCallback: buildStatusCallbackUrl() || undefined,
    });

    logger.info('📲 WA template status OK ✅', { sid: msg.sid, to: phone });

    await insertWaMessage({
      sid: msg.sid,
      direction: 'out',
      kind: 'status_change',
      to_phone: phone,
      from_phone: fromWhatsAppAddress(waFrom),
      reservation_id: reservation?.id || null,
      status: msg.status || null,
      payload_json: safeJson({ vars }),
    });

    return { ok: true, sid: msg.sid, template: true };
  }

  // Freeform: passa da sendText (che può bloccare fuori 24h)
  const media = mediaLogo || env.WA.mediaLogo || null;
  const out = await sendText({ to: phone, text: body, mediaUrl: media });
  return { ...out, template: false };
}

// -----------------------------------------------------------------------------
// Webhook inbound Twilio (form-url-encoded)
// -----------------------------------------------------------------------------
function detectAction({ bodyText, buttonText, buttonPayload }) {
  const t = String(bodyText || '').trim().toLowerCase();
  const bt = String(buttonText || '').trim().toLowerCase();
  const bp = String(buttonPayload || '').trim().toLowerCase();
  const hay = `${t} ${bt} ${bp}`.trim();

  // mapping robusto (ti copre anche ID “strani” come CAMBIA ORARIO)
  if (hay.includes('confermo') || hay.includes('confirm') || hay.includes('cambia orario')) return 'confirm';
  if (hay.includes('annulla') || hay.includes('cancel')) return 'cancel';

  return null;
}

async function handleInboundWebhook(form) {
  const messageSid = form.MessageSid || form.SmsSid || null;
  const fromAddr = form.From || null; // whatsapp:+39...
  const toAddr = form.To || null;

  const fromPhone = normalizeToE164(fromWhatsAppAddress(fromAddr));
  const toPhone = normalizeToE164(fromWhatsAppAddress(toAddr));

  const bodyText = form.Body || '';
  const buttonText = form.ButtonText || '';
  const buttonPayload = form.ButtonPayload || '';

  // Reply context: Twilio può mandare OriginalRepliedMessageSid
  const originalSid = form.OriginalRepliedMessageSid || null;

  const profileName = form.ProfileName || null;
  const waId = form.WaId || null;

  // 1) aggiorno last inbound per finestra 24h
  await upsertContactInbound(fromPhone, waId, profileName, new Date());

  // 2) salvo inbound su wa_messages
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

  // 3) detect action
  const action = detectAction({ bodyText, buttonText, buttonPayload });

  // 4) se action + originalSid -> risalgo a reservationId
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
    action, // confirm | cancel | null
    reservationId: link ? link.reservationId : null,
    linkedKind: link ? link.kind : null,
  };

  logger.info('📩 WA inbound', {
    from: fromPhone,
    action: out.action,
    reservationId: out.reservationId,
    originalSid: out.originalSid,
  });

  return out;
}

// -----------------------------------------------------------------------------
// Webhook status callback Twilio
// -----------------------------------------------------------------------------
async function handleStatusCallback(form) {
  const sid = form.MessageSid || form.SmsSid || null;
  const status = form.MessageStatus || form.SmsStatus || form.Status || null;
  const errorCode = form.ErrorCode || null;
  const errorMessage = form.ErrorMessage || null;

  if (!sid) return { ok: true, skipped: true, reason: 'missing_sid' };

  logger.info('📡 WA status callback', { sid, status, errorCode });

  await updateWaMessageStatus(sid, status, errorCode, errorMessage, form);
  return { ok: true };
}

// -----------------------------------------------------------------------------
// health (diagnostica safe)
// -----------------------------------------------------------------------------
function health() {
  const w = env.WA || {};
  const hasTwilioModule = !!_loadTwilioFactory();
  return {
    enabled: !!w.enabled,
    hasTwilioModule,
    hasSid: !!w.accountSid,
    hasToken: !!w.authToken,
    hasFrom: !!w.from,
    hasTemplateStatus: !!w.templateSid,
    hasTemplateConfirm: !!w.templateReservationConfirmSid,
    defaultCc: w.defaultCc || '+39',
    webhookBaseUrl: w.webhookBaseUrl || '',
    blockFreeTextOutside24h: !!w.blockFreeTextOutside24h,
  };
}

module.exports = {
  // base API (compat)
  getClient,
  sendText,
  sendMessage,
  sendStatusChange,
  _normalizeToE164: normalizeToE164,
  health,

  // “vecchio” riportato dentro (template + webhook + tracking)
  sendTemplate,
  sendReservationConfirmTemplate,
  handleInboundWebhook,
  handleStatusCallback,
  updateWaMessageStatus,
};
