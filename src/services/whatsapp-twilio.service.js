'use strict';

/**
 * whatsapp-twilio.service.js
 * ---------------------------------------------------------
 * 🎯 SCOPO:
 * - Qui dentro teniamo SOLO la creazione del client Twilio.
 * - Zero logiche business.
 * - Zero parsing webhook.
 *
 * ✅ In questo modo:
 * - whatsapp.service.js = logica WA (template, finestra 24h, tracking, ecc.)
 * - whatsapp-twilio.service.js = adapter Twilio
 */

const twilio = require('twilio');
const env = require('../env');

function createClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN || env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    // Non logghiamo qui: la logica + log sta in whatsapp.service.js
    return null;
  }

  return twilio(accountSid, authToken);
}

module.exports = {
  createClient,
};
