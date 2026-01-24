'use strict';

/**
 * services/whatsapp.service.js
 * -----------------------------------------------------------------------------
 * ✅ UNICA FONTE DI VERITÀ per WhatsApp nel backend.
 *
 * Provider attuale: Twilio.
 *
 * Cosa risolve questa “pulizia totale”:
 * 1) Prima avevi più file simili (whatsapp.service.js / whatsapp-twilio.service.js / whatsapp.twilio.service.jS)
 *    → ora resta un solo service "vero".
 * 2) Prima mancava sendText() nel whatsapp.service.js, quindi:
 *    - /api/notifications/wa/send poteva finire in 501
 *    - notify.service faceva fallback Twilio diretto duplicando logica
 *    → ora sendText esiste e viene riusato ovunque.
 *
 * API ESPOSTA (stabile):
 * - sendText(to, text, mediaUrl?)
 * - sendText({ to, text, mediaUrl?, from? })
 * - sendMessage(...) alias di sendText (compatibilità)
 * - sendStatusChange({ to, reservation, status, reason?, mediaLogo? })
 * - _normalizeToE164(phone)
 * - health()
 *
 * ENV (vedi src/env.js):
 * - WA_ENABLED=true|false
 * - TWILIO_ACCOUNT_SID=...
 * - TWILIO_AUTH_TOKEN=...
 * - WA_FROM="whatsapp:+39..."           (numero/ID Twilio abilitato)
 * - WA_DEFAULT_CC="+39"
 * - WA_MEDIA_LOGO_URL="https://..."
 * - WA_TEMPLATE_STATUS_CHANGE_SID="HX..." (opzionale, Content API)
 */

const logger = require('../logger');
const env    = require('../env');

// Caricamento "lazy" di Twilio: se WA è disabilitato, NON vogliamo crash.
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
 * - Restituisce un Twilio client singleton
 * - Se WA non è abilitato o mancano credenziali → null (best-effort)
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

/** Rimuove prefisso whatsapp: se presente */
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

/** Corpo testo semplice (IT) per cambio stato prenotazione */
function buildStatusText({ status, dateYmd, timeHm, partySize, name, tableName }) {
  const S = String(status || '').toUpperCase();
  const n = name ? ` ${name}` : '';
  const when = (dateYmd && timeHm) ? ` per il ${dateYmd} alle ${timeHm}` : '';
  const pax = partySize ? ` (persone: ${partySize})` : '';
  const tbl = tableName ? ` • ${tableName}` : '';
  return `🟢 Aggiornamento prenotazione${n}:\nStato: ${S}${when}${pax}${tbl}\n— ${env.MAIL?.bizName || 'La tua attività'}`;
}

/**
 * sendText
 * -----------------------------------------------------------------------------
 * Firma supportata:
 *   - sendText(to, text, mediaUrl?)
 *   - sendText({ to, text, mediaUrl?, from? })
 *
 * Ritorno:
 *   - { ok:true, sid }
 *   - oppure { skipped:true, reason:"..." } se disabilitato/misconfig/no phone/testo vuoto
 */
async function sendText(arg1, arg2, arg3) {
  // === Parse parametri in modo compatibile ==================================
  let to = null;
  let text = null;
  let mediaUrl = null;
  let from = null;

  if (arg1 && typeof arg1 === 'object') {
    to       = arg1.to;
    text     = arg1.text ?? arg1.body ?? arg1.message ?? null;
    mediaUrl = arg1.mediaUrl ?? null;
    from     = arg1.from ?? null;
  } else {
    to       = arg1;
    text     = arg2;
    mediaUrl = arg3 ?? null;
  }

  // === Guardie “best-effort” =================================================
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

  const waFrom = _normalizeFrom(from || env.WA.from);
  if (!waFrom) {
    logger.warn('📲 WA SKIPPED (missing_from)', { wa_env: env._debugWaConfig?.() });
    return { skipped: true, reason: 'missing_from' };
  }

  // === Payload Twilio ========================================================
  const payload = {
    from: waFrom,
    to  : `whatsapp:${phone}`,
    body
  };

  // mediaUrl può essere string o array
  if (mediaUrl) {
    if (Array.isArray(mediaUrl)) {
      const arr = mediaUrl.map(x => String(x || '').trim()).filter(Boolean);
      if (arr.length) payload.mediaUrl = arr;
    } else {
      const u = String(mediaUrl).trim();
      if (u) payload.mediaUrl = [u];
    }
  }

  logger.info('📲 WA sendText ▶️', { to: phone, hasMedia: !!payload.mediaUrl });
  try {
    const msg = await client.messages.create(payload);
    logger.info('📲 WA sendText OK ✅', { sid: msg.sid, to: phone });
    return { ok: true, sid: msg.sid };
  } catch (e) {
    logger.error('📲 WA sendText ❌', { to: phone, error: String(e) });
    throw e;
  }
}

// Alias compatibilità
async function sendMessage(...args) {
  return sendText(...args);
}

/**
 * sendStatusChange
 * -----------------------------------------------------------------------------
 * Invia la notifica di cambio stato prenotazione su WhatsApp.
 * Mantiene la logica che avevi già:
 * - se templateSid → Content API
 * - altrimenti freeform entro 24h
 */
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

  // Dati testo
  const start = reservation?.start_at ? new Date(reservation.start_at) : null;
  const ymd = start ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}` : null;
  const hm  = start ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}` : null;

  const name = reservation?.display_name || [reservation?.customer_first, reservation?.customer_last].filter(Boolean).join(' ');
  const body = buildStatusText({
    status,
    dateYmd : ymd,
    timeHm  : hm,
    partySize: reservation?.party_size,
    name,
    tableName: reservation?.table_name
  });

  // Template (Content API) se disponibile
  if (env.WA.templateSid) {
    const vars = {
      '1': name || 'Cliente',
      '2': String(status || '').toUpperCase(),
      '3': `${ymd || ''} ${hm || ''}`.trim(),
      '4': String(reservation?.party_size || ''),
      '5': reservation?.table_name || '',
      '6': reason || ''
    };

    const waFrom = _normalizeFrom(env.WA.from);
    if (!waFrom) {
      logger.warn('📲 WA SKIPPED (missing_from)', { id: reservation?.id, wa_env: env._debugWaConfig?.() });
      return { skipped: true, reason: 'missing_from' };
    }

    logger.info('📲 WA template send ▶️', { to: phone, templateSid: env.WA.templateSid, vars });
    try {
      const msg = await client.messages.create({
        from: waFrom,
        to  : `whatsapp:${phone}`,
        contentSid: env.WA.templateSid,
        contentVariables: JSON.stringify(vars),
      });
      logger.info('📲 WA template OK ✅', { sid: msg.sid, to: phone });
      return { ok: true, sid: msg.sid, template: true };
    } catch (e) {
      logger.error('📲 WA template ❌', { to: phone, error: String(e) });
      throw e;
    }
  }

  // Freeform: riuso sendText (così NON duplichiamo logica)
  const media = mediaLogo || env.WA.mediaLogo || null;
  const out = await sendText({ to: phone, text: body, mediaUrl: media });
  return { ...out, template: false };
}

/**
 * health()
 * Piccola diagnostica “safe” per capire se WA è configurato.
 */
function health() {
  const w = env.WA || {};
  const hasTwilioModule = !!_loadTwilioFactory();
  return {
    enabled: !!w.enabled,
    hasTwilioModule,
    hasSid: !!w.accountSid,
    hasToken: !!w.authToken,
    hasFrom: !!w.from,
    hasTemplate: !!w.templateSid,
    defaultCc: w.defaultCc || '+39',
    mediaLogo: w.mediaLogo ? '[set]' : '',
  };
}

module.exports = {
  getClient,
  sendText,
  sendMessage, // alias compat
  sendStatusChange,
  _normalizeToE164: normalizeToE164,
  health,
};
