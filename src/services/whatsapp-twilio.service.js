'use strict';

/**
 * WhatsApp service (Twilio) — invio messaggi di stato prenotazione.
 * - Usa template (se WA_TEMPLATE_STATUS_CHANGE_SID è impostato) oppure messaggio libero entro 24h.
 * - Normalizza numero in E.164 con prefisso di default (IT) se manca '+'.
 * - Log verbosi con emoji come il resto del progetto.
 */

const twilio = require('twilio');
const logger = require('../logger');
const env = require('../env');

let client = null;
function getClient() {
  if (!env.WA.enabled) {
    return null;
  }
  if (!client) {
    client = twilio(env.WA.accountSid, env.WA.authToken);
    logger.info('📳 WA client inizializzato', { service: 'server', wa_env: env._debugWaConfig() });
  }
  return client;
}

/** Grezza normalizzazione in E.164 (default IT): +39 + numero senza spazi */
function normalizeToE164(phone) {
  if (!phone) return null;
  let p = String(phone).trim();
  // rimuovo spazi e non cifre (tranne +)
  p = p.replace(/[^\d+]/g, '');
  if (p.startsWith('+')) return p;
  // se inizia con 00, converto in +
  if (p.startsWith('00')) return '+' + p.slice(2);
  // fallback: aggiungo prefisso di default
  return (env.WA.defaultCc || '+39') + p.replace(/^0+/, '');
}

/**
 * buildStatusText: corpo del messaggio in IT
 */
function buildStatusText({ status, dateYmd, timeHm, partySize, name, tableName }) {
  const S = String(status || '').toUpperCase();
  const n = name ? ` ${name}` : '';
  const when = (dateYmd && timeHm) ? ` per il ${dateYmd} alle ${timeHm}` : '';
  const pax = partySize ? ` (persone: ${partySize})` : '';
  const tbl = tableName ? ` • ${tableName}` : '';
  return `🟢 Aggiornamento prenotazione${n}:\nStato: ${S}${when}${pax}${tbl}\n— ${env.MAIL.bizName}`;
}

/**
 * Invia la notifica di cambio stato su WhatsApp.
 * options:
 *  - to (telefono cliente)
 *  - reservation (oggetto prenotazione: per testo)
 *  - status (nuovo stato)
 *  - reason (opzionale)
 *  - mediaLogo (URL immagine da allegare — opzionale; se non passato usa env.WA.mediaLogo)
 */
async function sendStatusChange({ to, reservation, status, reason, mediaLogo }) {
  if (!env.WA.enabled) {
    logger.warn('📲 WA SKIPPED (disabled)', { service: 'server', id: reservation?.id });
    return { skipped: true, reason: 'disabled' };
  }

  const client = getClient();
  if (!client) {
    logger.error('📲 WA KO: client non inizializzato', { service: 'server' });
    throw new Error('WA client not initialized');
  }

  const phone = normalizeToE164(to || reservation?.contact_phone || reservation?.phone);
  if (!phone) {
    logger.warn('📲 WA SKIPPED (no phone)', { service: 'server', id: reservation?.id });
    return { skipped: true, reason: 'no_phone' };
  }

  // Dati testo
  const start = reservation?.start_at ? new Date(reservation.start_at) : null;
  const ymd = start ? `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}` : null;
  const hm  = start ? `${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')}` : null;
  const name = reservation?.display_name || [reservation?.customer_first, reservation?.customer_last].filter(Boolean).join(' ');
  const body = buildStatusText({
    status,
    dateYmd: ymd,
    timeHm: hm,
    partySize: reservation?.party_size,
    name,
    tableName: reservation?.table_name
  });

  // Se ho un template SID uso Content API (consigliato per fuori 24h)
  if (env.WA.templateSid) {
    const vars = {
      // es: nel template puoi usare {{1}}, {{2}}, ... (dipende dal tuo template approvato)
      '1': name || 'Cliente',
      '2': String(status || '').toUpperCase(),
      '3': `${ymd || ''} ${hm || ''}`.trim(),
      '4': String(reservation?.party_size || ''),
      '5': reservation?.table_name || '',
      '6': reason || ''
    };
    logger.info('📲 WA template send ▶️', { service: 'server', to: phone, templateSid: env.WA.templateSid, vars });

    const msg = await client.messages.create({
      from: env.WA.from,                 // 'whatsapp:+1XXXX' (tuo numero approvato)
      to:   `whatsapp:${phone}`,
      contentSid: env.WA.templateSid,    // template approvato su WhatsApp Manager
      contentVariables: JSON.stringify(vars),
    });

    logger.info('📲 WA template OK', { service: 'server', sid: msg.sid, to: phone });
    return { ok: true, sid: msg.sid, template: true };
  }

  // Altrimenti messaggio libero (vale solo entro 24h di sessione)
  const payload = {
    from: env.WA.from,
    to  : `whatsapp:${phone}`,
    body
  };
  const media = mediaLogo || env.WA.mediaLogo;
  if (media) payload.mediaUrl = [media];

  logger.info('📲 WA freeform send ▶️', { service: 'server', to: phone, media: !!media });
  const msg = await client.messages.create(payload);

  logger.info('📲 WA freeform OK', { service: 'server', sid: msg.sid, to: phone });
  return { ok: true, sid: msg.sid, template: false };
}

module.exports = {
  sendStatusChange,
  _normalizeToE164: normalizeToE164,
};
