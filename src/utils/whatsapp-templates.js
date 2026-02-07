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
 * Formatta data completa: Sabato 07/02/2026 (weekday cap + resto lowercase, DD/MM/YYYY).
 */
function formatDateFull(iso) {
  if (!iso) return '--/--/----';
  try {
    const d = new Date(iso);
    const weekday = new Intl.DateTimeFormat('it-IT', { weekday: 'long' }).format(d);
    const rest = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
    const cap = weekday.charAt(0).toUpperCase() + weekday.slice(1).toLowerCase();
    return `${cap} ${rest}`;
  } catch {
    return '--/--/----';
  }
}

/**
 * Estrae DDMM da ISO/MySQL datetime (es. 0702 per 7 feb).
 */
function formatDDMM(iso) {
  if (!iso) return '----';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit' }).format(d).replace(/\D/g, '');
  } catch {
    return '----';
  }
}

/**
 * Estrae HHMM da ISO/MySQL datetime (es. 1930 per 19:30).
 */
function formatHHMM(iso) {
  if (!iso) return '----';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(/\D/g, '');
  } catch {
    return '----';
  }
}

/**
 * Ultime 4 cifre del telefono (per codice prenotazione).
 */
function getPhoneLast4(phone) {
  const raw = String(phone ?? '').replace(/\D/g, '');
  return raw.length >= 4 ? raw.slice(-4) : '----';
}

/**
 * Maschera telefono: +39 *******68381 (prefisso + spazio + asterischi per cifre oscurate + ultime 4).
 * Es: 393899868381 → +39 ********8381 (8 asterischi = 8 cifre nascoste).
 */
function maskPhone(phone) {
  const raw = String(phone ?? '').replace(/\D/g, '');
  if (!raw || raw.length < 4) return '****';
  const len = raw.length;
  const last4 = raw.slice(-4);
  const hiddenCount = len - 4;
  const asterisks = '*'.repeat(Math.max(0, hiddenCount));
  const prefix = raw.startsWith('39') ? '+39 ' : (raw.length > 4 ? '+ ' : '');
  return `${prefix}${asterisks}${last4}`;
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
 * @param {string} [payload.customerName] - Nome cliente (override)
 * @param {string} [payload.customer_first] - Nome
 * @param {string} [payload.customer_last] - Cognome (se assente: solo nome)
 * @param {string} [payload.display_name] - Nome completo
 * @param {string} [payload.phone] - Telefono cliente (mascherado nel messaggio)
 * @param {string} [payload.dateStr] - Data già formattata (es. SABATO 07/02/2026)
 * @param {string} [payload.timeStr] - Ora già formattata (es. 20:30)
 * @param {string} [payload.start_at] - ISO datetime (usato se dateStr/timeStr mancanti)
 * @param {number} [payload.people] - Numero coperti
 * @param {number} [payload.party_size] - Alias per people
 * @param {string} [payload.code] - Codice prenotazione (se esiste)
 * @param {string} [payload.booking_code] - Alias per code
 * @param {number} [payload.id] - ID prenotazione (fallback: R-${id})
 * @param {number} [payload.reservationId] - Alias per id
 * @param {string} [payload.notes] - Note cliente (da /prenota: es. passeggino, intolleranze)
 * @param {Object} [envConfig] - Override config (default: env.WHATSAPP_TEMPLATE)
 * @returns {string} Testo WhatsApp-ready
 */
function buildReservationReceivedMessage(payload, envConfig) {
  const cfg = envConfig || env.WHATSAPP_TEMPLATE || {};
  const brandName = str(cfg.brandName) || 'Pizzeria La Lanterna';
  const brandCity = str(cfg.brandCity) || 'Castelraimondo';
  const brandPhone = str(cfg.brandPhone) || '0737642142';
  const brandAddress = str(cfg.brandAddressLine) || 'Largo della Libertà, 4';
  const privacyUrl = str(cfg.privacyPolicyUrl) || 'https://www.iubenda.com/privacy-policy/90366241';
  const footerText = str(cfg.notificationsOnlyText) ||
    'WhatsApp usato solo per notifiche di servizio.';

  // Nome: solo nome se non presente cognome (es. Mario oppure Rossi)
  const first = str(payload?.customer_first);
  const last = str(payload?.customer_last);
  const name =
    str(payload?.customerName) ||
    str(payload?.display_name) ||
    (first && last ? first : (first || last)) ||
    'Cliente';

  const dateStrFull = (payload?.start_at ? formatDateFull(payload.start_at) : null) || str(payload?.dateStr) || '--/--/----';
  const timeStr = str(payload?.timeStr) || formatTimeHHMM(payload?.start_at);
  const people = num(payload?.people, num(payload?.party_size, 0)) || 0;

  const mapsUrl = getMapsUrl(cfg);

  // Telefono cliente mascherado: +39 *******8381 (NON modificare maskPhone)
  const phoneMasked = payload?.phone ? `*${maskPhone(payload.phone)}*` : '';

  // Codice prenotazione: R-{DDMM}-{HHMM}-{ultime4} da start_at + phone (o code/booking_code/id se fornit esternamente)
  const ddmm = payload?.start_at ? formatDDMM(payload.start_at) : '----';
  const hhmm = payload?.start_at ? formatHHMM(payload.start_at) : '----';
  const last4 = payload?.phone ? getPhoneLast4(payload.phone) : '----';
  const bookingCode =
    str(payload?.code) || str(payload?.booking_code) ||
    (ddmm !== '----' && hhmm !== '----' && last4 !== '----' ? `R-${ddmm}-${hhmm}-${last4}` : null) ||
    (payload?.id != null ? `R-${payload.id}` : (payload?.reservationId != null ? `R-${payload.reservationId}` : 'R--'));

  // Formato telefono ristorante + indirizzo (es. 0737 642142 — Largo della Libertà 4, Castelraimondo (MC))
  const phoneFormatted = brandPhone.length >= 6
    ? `${brandPhone.slice(0, 4)} ${brandPhone.slice(4)}`
    : brandPhone;
  const addressLine = `${phoneFormatted} — ${brandAddress}, ${brandCity} (MC)`;

  const lines = [
    '📅 *PRENOTAZIONE RICEVUTA* 🍕',
    '',
    `👋 Ciao *${name}*!`,
    '',
  ];
  if (phoneMasked) {
    lines.push(`📲 Telefono: ${phoneMasked}`);
    lines.push('');
  }
  lines.push(`🧾 *Codice Prenotazione:* *${bookingCode}*`);
  lines.push('');
  lines.push(
    `📅 *Data:* ${dateStrFull}`,
    `🕒 *Orario:* ${timeStr} (ora locale)`,
    `👥 *Persone:* ${people} coperti`,
  );
  // Note cliente (da /prenota): solo se presenti, stile coerente con emoji
  const notes = (str(payload?.notes) || '').replace(/\n/g, ' ').trim();
  if (notes) {
    lines.push('');
    lines.push(`📝 *Note:* ${notes}`);
  }
  lines.push(
    '',
    '❓ *Confermi la prenotazione?*',
    'Rispondi: Sì ✅ oppure No ❌',
    '(Se puoi, rispondi entro 30 min)',
    '',
    '✏️ MODIFICA = cambia orario/persone',
    '🗑️ ANNULLA = cancella prenotazione',
    '',
    `📍 ${mapsUrl}`,
    '',
    `📲 ${addressLine}`,
    '',
    `ℹ️ ${footerText}`,
    '',
    `🔒 Privacy: ${privacyUrl}`,
  );

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
