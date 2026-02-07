'use strict';

/**
 * services/twilio.service.js
 * -----------------------------------------------------------------------------
 * Gate centralizzato Twilio: WhatsApp + SMS.
 *
 * Obiettivo: spegnere Twilio globalmente solo via env, senza cambiare codice.
 * - TWILIO_ENABLED=0 → nessuna chiamata API, risposta ok + disabled.
 * - TWILIO_DRY_RUN=1 → non invia, logga e ritorna ok simulated.
 * - Nessun crash se mancano TWILIO_* env; log chiaro con emoji.
 *
 * ENV (compatibili prod/dev):
 * - TWILIO_ENABLED=0|1 (default: 0 se mancano credenziali, altrimenti rispetta valore)
 * - TWILIO_DRY_RUN=0|1 (default: 0)
 * - TWILIO_BLOCK_REASON="manutenzione" (opzionale, per log/health)
 * - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (minimi per “enabled”)
 * - SMS: SMS_FROM o TWILIO_SMS_FROM
 *
 * Regola: Twilio è attivo solo se TWILIO_ENABLED=1 E credenziali minime presenti.
 * Se manca qualcosa → forzare disabled + log warn.
 */

const logger = require('../logger');
const env = require('../env');

// ----------------------------------------------------------------------------
// Config e stato (nessun token/SID in chiaro nei log)
// ----------------------------------------------------------------------------
const sid = (env.WA?.accountSid || process.env.TWILIO_ACCOUNT_SID || '').trim();
const token = (env.WA?.authToken || process.env.TWILIO_AUTH_TOKEN || '').trim();
const smsFrom = (process.env.SMS_FROM || process.env.TWILIO_SMS_FROM || '').trim();

const hasCreds = !!(sid && token);
const disableTwilioEnv = !!(env.DISABLE_TWILIO || process.env.DISABLE_TWILIO === '1' || process.env.DISABLE_TWILIO === 'true');
const enabledRaw = (env.TWILIO?.enabledRaw || process.env.TWILIO_ENABLED || '').toString().trim();
const wantEnabled = enabledRaw === '1' || enabledRaw === 'true' || enabledRaw === 'yes';
const explicitlyDisabled = enabledRaw === '0' || enabledRaw === 'false';

// Default: 0 se mancano credenziali, altrimenti 1 solo se tutto presente (env non impostato = abilita se creds ok)
// DISABLE_TWILIO=1 → override: forza disabled ovunque
let _enabled = false;
if (disableTwilioEnv) {
  _enabled = false;
} else if (explicitlyDisabled) {
  _enabled = false;
} else if (enabledRaw === '') {
  _enabled = hasCreds;
} else {
  _enabled = wantEnabled && hasCreds;
}
if (wantEnabled && !hasCreds) {
  _enabled = false;
  logger.warn('🛑 [TWILIO] disabled — credenziali mancanti (TWILIO_ENABLED=1 ma TWILIO_ACCOUNT_SID/AUTH_TOKEN assenti)', {
    hasSid: !!sid,
    hasToken: !!token,
  });
}

const dryRun = !!(env.TWILIO?.dryRun || process.env.TWILIO_DRY_RUN === '1' || process.env.TWILIO_DRY_RUN === 'true');
const blockReason = (env.TWILIO?.blockReason || process.env.TWILIO_BLOCK_REASON || '').trim();

let _client = null;
let _lastHealthAt = new Date().toISOString();

function _loadClient() {
  if (_client) return _client;
  if (!_enabled || dryRun) return null;
  try {
    // eslint-disable-next-line global-require
    const twilio = require('twilio');
    _client = twilio(sid, token);
    logger.info('🟢 [TWILIO] client inizializzato (invii reali attivi)');
    return _client;
  } catch (e) {
    logger.warn('🔴 [TWILIO] client non disponibile (modulo twilio?)', { error: String(e?.message || e) });
    return null;
  }
}

// ----------------------------------------------------------------------------
// API pubbliche
// ----------------------------------------------------------------------------

function isTwilioEnabled() {
  return _enabled;
}

function isTwilioDryRun() {
  return dryRun;
}

function getBlockReason() {
  return blockReason;
}

/**
 * Invia messaggio WhatsApp (stesso payload di client.messages.create).
 * - Disabled: non chiama Twilio, ritorna { ok: true, disabled: true }.
 * - Dry-run: non chiama Twilio, ritorna { ok: true, simulated: true }.
 * - Enabled: chiama Twilio, ritorna { ok: true, sid } o { ok: false, lastError }.
 * @param {object} payload - { from, to, body?, mediaUrl?, statusCallback?, contentSid?, contentVariables? }
 * @param {object} [meta] - { toMask?, kind? } per log (no SID/token)
 */
async function sendWhatsApp(payload, meta = {}) {
  const rawTo = payload && payload.to ? String(payload.to).trim() : '';
  const toMask = rawTo ? rawTo.slice(0, 6) + '…' : '+39…';
  const kind = meta.kind || 'whatsapp';

  if (!_enabled) {
    const reason = disableTwilioEnv ? 'DISABLE_TWILIO=1 (WhatsApp/Twilio disabilitato via env)' : (blockReason || 'TWILIO_ENABLED=0');
    logger.warn('⛔ WhatsApp/Twilio disabilitato via env — skip sendWhatsApp', { to: toMask, reason });
    return { ok: true, disabled: true, reason };
  }

  if (dryRun) {
    logger.info('🧪 [TWILIO] dry-run — simulate sendWhatsApp to=+' + toMask + ' kind=' + kind);
    return { ok: true, simulated: true };
  }

  const client = _loadClient();
  if (!client) {
    logger.warn('🛑 [TWILIO] skip sendWhatsApp (client unavailable) to=+' + toMask);
    return { ok: false, disabled: true, reason: 'client_unavailable' };
  }

  try {
    const msg = await client.messages.create(payload);
    logger.info('🟢 [TWILIO] sent — channel=whatsapp sid=' + (msg.sid ? msg.sid.slice(0, 10) + '…' : '—') + ' to=+' + toMask);
    return { ok: true, sid: msg.sid };
  } catch (e) {
    const code = e.code || e.status || '';
    const message = e.message || String(e);
    logger.error('🔴 [TWILIO] error — code=' + code + ' message=' + message.replace(/token|sid|auth/gi, '***'));
    return { ok: false, lastError: message, code };
  }
}

/**
 * Invia SMS.
 * - Disabled/Dry-run: come sendWhatsApp.
 * - Enabled: usa client.messages.create con from SMS_FROM/TWILIO_SMS_FROM.
 */
async function sendSms({ to, body, meta = {} }) {
  const rawTo = to ? String(to).trim() : '';
  const toMask = rawTo ? rawTo.slice(0, 6) + '…' : '+39…';
  const kind = meta.kind || 'sms';

  if (!_enabled) {
    const reason = disableTwilioEnv ? 'DISABLE_TWILIO=1 (WhatsApp/Twilio disabilitato via env)' : (blockReason || 'TWILIO_ENABLED=0');
    logger.warn('⛔ WhatsApp/Twilio disabilitato via env — skip sendSms', { to: toMask, reason });
    return { ok: true, disabled: true, reason };
  }

  if (dryRun) {
    logger.info('🧪 [TWILIO] dry-run — simulate sendSms to=+' + toMask);
    return { ok: true, simulated: true };
  }

  const client = _loadClient();
  if (!client) {
    logger.warn('🛑 [TWILIO] skip sendSms (client unavailable) to=+' + toMask);
    return { ok: false, disabled: true, reason: 'client_unavailable' };
  }

  const from = smsFrom || (env.WA?.from || '').replace(/^whatsapp:/, '');
  if (!from) {
    logger.warn('🛑 [TWILIO] skip sendSms — SMS_FROM/TWILIO_SMS_FROM mancante');
    return { ok: false, reason: 'missing_from' };
  }

  try {
    const msg = await client.messages.create({ from, to: String(to).trim(), body: String(body || '') });
    logger.info('🟢 [TWILIO] sent — channel=sms sid=' + (msg.sid ? msg.sid.slice(0, 10) + '…' : '—') + ' to=+' + toMask);
    return { ok: true, sid: msg.sid };
  } catch (e) {
    const code = e.code || e.status || '';
    const message = e.message || String(e);
    logger.error('🔴 [TWILIO] error — code=' + code + ' message=' + message.replace(/token|sid|auth/gi, '***'));
    return { ok: false, lastError: message, code };
  }
}

/**
 * Stato per GET /api/health/twilio.
 * Logga solo boolean, mai SID/token.
 */
function getHealthState() {
  _lastHealthAt = new Date().toISOString();
  let reason = '';
  if (!_enabled) {
    reason = blockReason || (hasCreds ? 'TWILIO_ENABLED=0' : 'credenziali_mancanti');
  } else if (dryRun) {
    reason = 'TWILIO_DRY_RUN=1';
  } else {
    reason = 'ok';
  }
  return {
    ok: true,
    enabled: _enabled,
    dryRun,
    reason,
    hasCreds,
    updatedAt: _lastHealthAt,
  };
}

module.exports = {
  isTwilioEnabled,
  isTwilioDryRun,
  getBlockReason,
  sendWhatsApp,
  sendSms,
  getHealthState,
};
