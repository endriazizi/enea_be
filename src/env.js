'use strict';

/**
 * src/env.js
 * -----------------------------------------------------------------------------
 * Loader centralizzato env + helper.
 *
 * 🔥 FIX IMPORTANTE:
 * - Prima ti funzionava perché caricavi il file .env (dotenv).
 * - Ora DB_USER/DB_NAME risultano vuoti ⇒ il pool prova 127.0.0.1:3306 e fallisce.
 *
 * ✅ Qui rimettiamo un loader robusto:
 * - prova .env, .env.development, .env.local, ecc.
 * - se non trova nulla, prova anche ".env copy" / ".env copy 2" (capita spesso su Windows)
 *
 * NOTE:
 * - Non uso logger qui (evito loop/circular dependency).
 * - Se dotenv non è installato, non crasha: userai solo le env di sistema.
 */

// ----------------------------------------------------------------------------
// 1) Provo a caricare dotenv (se presente) + scelgo un file env “sensato”
// ----------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';

function tryLoadDotEnv() {
  let dotenv;
  try {
    dotenv = require('dotenv');
  } catch (_) {
    // dotenv non installato → nessun crash
    return { loaded: false, file: '' };
  }

  const cwd = process.cwd();

  // ordine: più specifico → più generico
  const candidates = [
    `.env.${NODE_ENV}.local`,
    `.env.${NODE_ENV}`,
    `.env.local`,
    `.env`,
    // fallback “umani” (succede quando ci si salva .env con nome diverso)
    `.env copy`,
    `.env copy 2`,
    `env/.env`,
    `env/.env.${NODE_ENV}`,
  ];

  for (const name of candidates) {
    const full = path.join(cwd, name);
    try {
      if (fs.existsSync(full)) {
        dotenv.config({ path: full });
        return { loaded: true, file: full };
      }
    } catch (_) {}
  }

  return { loaded: false, file: '' };
}

const _dotenvInfo = tryLoadDotEnv();

// ----------------------------------------------------------------------------
// 2) Helpers
// ----------------------------------------------------------------------------
function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(v, def = '') {
  if (v === undefined || v === null) return def;
  return String(v);
}

function mask(value, front = 2, back = 2) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= front + back) return '*'.repeat(s.length);
  return s.slice(0, front) + '*'.repeat(s.length - front - back) + s.slice(-back);
}

// ----------------------------------------------------------------------------
// 3) Config
// ----------------------------------------------------------------------------
const env = {
  NODE_ENV,
  isProd: NODE_ENV === 'production',

  // (debug) quale file env è stato caricato davvero
  _envFileLoaded: _dotenvInfo.file || '',

  // ---------------------------------------------------------------------------
  // SERVER
  // ---------------------------------------------------------------------------
  PORT: num(process.env.PORT, 3000),

  // CORS (separati da virgola)
  CORS_WHITELIST: (str(process.env.CORS_WHITELIST, ''))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // ---------------------------------------------------------------------------
  // DB
  // ---------------------------------------------------------------------------
  DB: {
    // ⚠️ Default “furbi” in dev: evitiamo ::1 e valori vuoti
    host: str(process.env.DB_HOST, '127.0.0.1'),
    port: num(process.env.DB_PORT, 3306),
    user: str(process.env.DB_USER, 'root'),
    password: str(process.env.DB_PASSWORD, ''),
    database: str(process.env.DB_NAME, 'app'),

    // alias di compatibilità (se in qualche file usi env.DB.name)
    get name() { return this.database; }
  },

  // ---------------------------------------------------------------------------
  // LOG (se lo usi nel tuo logger)
  // ---------------------------------------------------------------------------
  LOG: {
    dir: str(process.env.LOG_DIR, './logs'),
    retentionDays: num(process.env.LOG_RETENTION_DAYS, 14),
    level: str(process.env.LOG_LEVEL, 'info'),
  },

  // ---------------------------------------------------------------------------
  // AUTH / JWT
  // ---------------------------------------------------------------------------
  JWT: {
    secret: str(process.env.JWT_SECRET, ''),
    ttlSeconds: num(process.env.JWT_TTL_SECONDS, 60 * 60 * 8),
    issuer: process.env.JWT_ISSUER || undefined,
    audience: process.env.JWT_AUDIENCE || undefined,
  },

  AUTH: {
    devBypass: bool(process.env.AUTH_DEV_BYPASS, false),
    devUser: str(process.env.AUTH_DEV_USER, 'dev@local'),
    devId: num(process.env.AUTH_DEV_ID, 0),
  },

  // ---------------------------------------------------------------------------
  // CENTRALINO (PBX → /asporto)
  // ---------------------------------------------------------------------------
  CENTRALINO_KEY: str(process.env.CENTRALINO_KEY, ''),
  CENTRALINO_REDIRECT_BASE: str(process.env.CENTRALINO_REDIRECT_BASE, ''),

  // ---------------------------------------------------------------------------
  // MAIL
  // ---------------------------------------------------------------------------
  MAIL: {
    enabled: bool(process.env.MAIL_ENABLED, true),
    host: str(process.env.SMTP_HOST, 'smtp.gmail.com'),
    port: num(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: str(process.env.SMTP_USER, ''),
    pass: str(process.env.SMTP_PASS, ''),
    from: str(process.env.MAIL_FROM, 'Prenotazioni <no-reply@example.com>'),
    replyTo: str(process.env.MAIL_REPLY_TO, ''),
    bizName: str(process.env.BIZ_NAME, str(process.env.BRAND_NAME, 'La tua attività')),
  },

  // ---------------------------------------------------------------------------
  // WHATSAPP (TWILIO)
  // ---------------------------------------------------------------------------
  WA: {
    enabled: bool(process.env.WA_ENABLED, false),
    notifyAlways: bool(process.env.WA_NOTIFY_ALWAYS, false),

    accountSid: str(process.env.TWILIO_ACCOUNT_SID, ''),
    authToken: str(process.env.TWILIO_AUTH_TOKEN, ''),

    from: str(process.env.WA_FROM, ''),
    defaultCc: str(process.env.WA_DEFAULT_CC, '+39'),
    defaultCountry: str(process.env.WA_DEFAULT_COUNTRY, 'IT'),

    mediaLogo: str(process.env.WA_MEDIA_LOGO_URL, ''),

    // template “status change”
    templateSid: str(process.env.WA_TEMPLATE_STATUS_CHANGE_SID, ''),

    // template “prenotazione conferma” (Quick Reply)
    templateReservationConfirmSid: str(process.env.WA_TEMPLATE_RESERVATION_CONFIRM_SID, ''),

    // blocco free-text fuori 24h
    blockFreeTextOutside24h: bool(process.env.WA_BLOCK_FREE_TEXT_OUTSIDE_24H, false),

    // webhook base url (backend pubblico)
    webhookBaseUrl: str(process.env.WA_WEBHOOK_BASE_URL, ''),

    // apply actions auto (confirm/cancel) dal webhook
    autoApplyActions: bool(process.env.WA_AUTO_APPLY_ACTIONS, false),

    // log contenuto messaggi (di solito NO)
    logContent: bool(process.env.WA_LOG_CONTENT, false),
  },

  // ---------------------------------------------------------------------------
  // Debug helpers (safe: non stampare segreti)
  // ---------------------------------------------------------------------------
  _debugDbConfig() {
    const d = env.DB;
    return {
      host: d.host,
      port: d.port,
      database: d.database,
      user: mask(d.user, 2, 1),
      password: d.password ? '[set]' : '',
      envFileLoaded: env._envFileLoaded || '(none)',
    };
  },

  _debugWaConfig() {
    const w = env.WA;
    return {
      enabled: !!w.enabled,
      accountSid: w.accountSid ? mask(w.accountSid, 6, 3) : '',
      authToken: w.authToken ? '[set]' : '',
      from: w.from || '',
      templateSid: w.templateSid ? '[set]' : '',
      templateReservationConfirmSid: w.templateReservationConfirmSid ? '[set]' : '',
      webhookBaseUrl: w.webhookBaseUrl || '',
    };
  },
};

module.exports = env;
