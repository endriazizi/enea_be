// src/utils/normalize-phone-it.js
// ============================================================================
// Normalizzazione numeri di telefono IT → E.164 e JID Baileys.
// Input sporco: +39..., 39..., 0039..., 333 123 4567, 333-123-4567, 0737 642142, ecc.
// Output: +393331234567 (E.164) e 393331234567@s.whatsapp.net (JID).
// Usato dal service WhatsApp WebQR per evitare falsi "invio ok" con numeri malformati.
// ============================================================================

'use strict';

const MIN_DIGITS = 10; // almeno 10 cifre (es. 3331234567)
const MAX_DIGITS = 12; // max 12 (39 + 10 cifre IT)

/**
 * Normalizza una stringa raw in numero E.164 Italia (+39...).
 * - Rimuove spazi, parentesi, trattini, punti.
 * - 00... → converti a +
 * - + ok
 * - 39... (lunghezza plausibile) → prefix +
 * - 3... (cellulare IT 10 cifre) → +39
 * - 0... (fisso 10 cifre) → +39
 * @param {string} raw - Input grezzo (es. "333 123 4567", "0039 333 1234567")
 * @returns {string} E.164 es. "+393331234567"
 * @throws {{ code: 'INVALID_PHONE', message: string }}
 */
function normalizePhoneIT(raw) {
  if (raw == null || typeof raw !== 'string') {
    throw { code: 'INVALID_PHONE', message: 'Numero mancante o non valido' };
  }
  let s = raw.trim().replace(/\s+/g, '').replace(/[()\-.]/g, '');
  if (!s) throw { code: 'INVALID_PHONE', message: 'Numero vuoto' };

  // 00... → trattare come internazionale (rimuovi 00)
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('+')) s = s.slice(1);

  let digits = s.replace(/\D/g, '');
  if (!digits) throw { code: 'INVALID_PHONE', message: 'Nessuna cifra nel numero' };

  // Già 39 + 10 cifre
  if (digits.startsWith('39') && digits.length >= 12) {
    digits = digits.slice(0, MAX_DIGITS);
    if (digits.length >= MIN_DIGITS) return '+' + digits;
  }
  if (digits.startsWith('39') && digits.length >= MIN_DIGITS) {
    return '+' + digits.slice(0, MAX_DIGITS);
  }
  // Cellulare IT 3xxxxxxxxx (10 cifre)
  if (digits.startsWith('3') && digits.length === 10) {
    return '+39' + digits;
  }
  // Fisso 0xxxxxxxxx (10 cifre)
  if (digits.startsWith('0') && digits.length === 10) {
    return '+39' + digits.slice(1);
  }
  // 10 cifre senza prefisso → +39
  if (digits.length === 10) {
    return '+39' + digits;
  }
  // 11 cifre tipo 39333... → +39
  if (digits.length === 11 && digits.startsWith('39')) {
    return '+' + digits;
  }
  // Lunghezza plausibile: prendi ultime 10 e prefix 39
  if (digits.length >= MIN_DIGITS) {
    const tail = digits.slice(-10);
    return '+39' + tail;
  }

  throw { code: 'INVALID_PHONE', message: `Numero non valido (cifre: ${digits.length}, min ${MIN_DIGITS})` };
}

/**
 * Da E.164 (+39...) a JID Baileys (39...@s.whatsapp.net).
 * @param {string} e164 - Es. "+393331234567"
 * @returns {string} "393331234567@s.whatsapp.net"
 */
function toBaileysJid(e164) {
  if (!e164 || typeof e164 !== 'string') {
    throw { code: 'INVALID_PHONE', message: 'E.164 mancante' };
  }
  const digits = e164.replace(/\D/g, '');
  if (digits.length < MIN_DIGITS) {
    throw { code: 'INVALID_PHONE', message: 'JID: cifre insufficienti' };
  }
  return digits.slice(-12) + '@s.whatsapp.net';
}

module.exports = { normalizePhoneIT, toBaileysJid, MIN_DIGITS, MAX_DIGITS };
