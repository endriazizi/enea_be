'use strict';

/**
 * src/utils/whatsapp-templates.js
 * -----------------------------------------------------------------------------
 * Builder unico per template WhatsApp prenotazione.
 * Centralizza la costruzione del testo per evitare duplicazioni FE/BE.
 * Formato WhatsApp-ready: emoji, grassetti (*...*), link Maps cliccabile, footer no-reply.
 *
 * ENV: BRAND_NAME, BRAND_CITY, BRAND_PHONE, BRAND_ADDRESS_LINE,
 *      BRAND_MAPS_QUERY, BRAND_MAPS_URL, WHATSAPP_NOTIFICATIONS_ONLY_TEXT
 */

const logger = require('../logger');
const env = require('../env');

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function str(v, def = '') {
  if (v === undefined || v === null) return def;
  return String(v).trim();
}

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * Costruisce l'URL Google Maps cliccabile.
 * Regola: se BRAND_MAPS_URL è valorizzata ⇒ usare quella.
 * Altrimenti: https://maps.google.com/?q=${encodeURIComponent(query)}
 * dove query = BRAND_MAPS_QUERY || (BRAND_NAME + ' ' + BRAND_CITY)
 */
function getMapsUrl(envConfig) {
  const cfg = envConfig || env.WHATSAPP_TEMPLATE || {};
  const override = str(cfg.brandMapsUrl);
  if (override) return override;

  const query = str(cfg.brandMapsQuery) || `${str(cfg.brandName)} ${str(cfg.brandCity)}`.trim();
  if (!query) return 'https://maps.google.com/?q=Pizzeria+La+Lanterna+Castelraimondo';
  return `https://maps.google.com/?q=${encodeURIComponent(query)}`;
}

/**
 * Formatta data in DD/MM da ISO o MySQL datetime.
 */
function formatDateDDMM(iso) {
  if (!iso) return '--/--';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit' }).format(d);
  } catch {
    return '--/--';
  }
}

/**
 * Formatta ora in HH:mm da ISO o MySQL datetime.
 */
function formatTimeHHMM(iso) {
  if (!iso) return '--:--';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(d);
  } catch {
    return '--:--';
  }
}

// ----------------------------------------------------------------------------
// Builder principale
// ----------------------------------------------------------------------------

/**
 * Costruisce il messaggio WhatsApp "Prenotazione ricevuta" (formato pronto per invio).
 *
 * @param {Object} payload - Dati prenotazione
 * @param {string} [payload.customerName] - Nome cliente (o display_name)
 * @param {string} [payload.customer_first] - Nome
 * @param {string} [payload.customer_last] - Cognome
 * @param {string} [payload.display_name] - Nome completo
 * @param {string} [payload.dateStr] - Data già formattata (es. 04/02)
 * @param {string} [payload.timeStr] - Ora già formattata (es. 18:30)
 * @param {string} [payload.start_at] - ISO datetime (usato se dateStr/timeStr mancanti)
 * @param {number} [payload.people] - Numero coperti
 * @param {number} [payload.party_size] - Alias per people
 * @param {string|number} [payload.reservationCode] - Codice prenotazione (opzionale)
 * @param {string|number} [payload.reservationId] - ID prenotazione (opzionale)
 * @param {Object} [envConfig] - Override config (default: env.WHATSAPP_TEMPLATE)
 * @returns {string} Testo WhatsApp-ready (formato, emoji, grassetti, link Maps, footer)
 */
function buildReservationReceivedMessage(payload, envConfig) {
  const cfg = envConfig || env.WHATSAPP_TEMPLATE || {};
  const brandName = str(cfg.brandName) || 'Pizzeria La Lanterna';
  const brandCity = str(cfg.brandCity) || 'Castelraimondo';
  const brandPhone = str(cfg.brandPhone) || '0737642142';
  const footerText = str(cfg.notificationsOnlyText) ||
    'Questo numero WhatsApp è utilizzato solo per notifiche automatiche. Non è possibile rispondere a questo messaggio.';

  const name =
    str(payload?.customerName) ||
    str(payload?.display_name) ||
    `${str(payload?.customer_first)} ${str(payload?.customer_last)}`.trim() ||
    'Cliente';

  const dateStr = str(payload?.dateStr) || formatDateDDMM(payload?.start_at);
  const timeStr = str(payload?.timeStr) || formatTimeHHMM(payload?.start_at);
  const people = num(payload?.people, num(payload?.party_size, 0)) || 0;

  const mapsUrl = getMapsUrl(cfg);

  // Formato telefono umano (es. 0737 642142)
  const phoneFormatted = brandPhone.length >= 6
    ? `${brandPhone.slice(0, 4)} ${brandPhone.slice(4)}`
    : brandPhone;

  const lines = [
    '📅 *PRENOTAZIONE RICEVUTA*',
    `${brandName} 🍕`,
    '',
    `👋 Ciao *${name}*!`,
    '',
    `📅 *Data:* ${dateStr}`,
    `🕒 *Orario:* ${timeStr}`,
    `👥 *Persone:* ${people} coperti`,
    '',
    '❓ *Vuoi confermare la prenotazione?* ✅',
    '',
    `📍 *${brandName} – ${brandCity}*`,
    `👉 ${mapsUrl}`,
    '',
    `📲 ${phoneFormatted}`,
    '',
    `ℹ️ ${footerText}`,
  ];

  return lines.join('\n');
}

/**
 * Esegue buildReservationReceivedMessage e logga (senza testo completo se troppo lungo).
 * @param {Object} payload - come buildReservationReceivedMessage
 * @param {Object} [envConfig] - override config
 * @param {string} [logTo] - destinatario (per log, non sensibile)
 * @param {string} [logName] - nome cliente (per log)
 * @returns {string} Testo WhatsApp-ready
 */
function buildReservationReceivedMessageWithLog(payload, envConfig, logTo = '', logName = '') {
  const text = buildReservationReceivedMessage(payload, envConfig);
  const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  logger.info('🧩 [WA-TPL] reservation-received built', {
    to: logTo ? `${String(logTo).slice(0, 6)}…` : '(no-to)',
    name: logName || '(no-name)',
    preview,
  });
  return text;
}

module.exports = {
  buildReservationReceivedMessage,
  buildReservationReceivedMessageWithLog,
  getMapsUrl,
  formatDateDDMM,
  formatTimeHHMM,
};
