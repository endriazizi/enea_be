'use strict';

/**
 * Loader centralizzato env + piccoli helper.
 * Mantieni questo file dove sta (src/env.js).
 */

const fs = require('fs');
const path = require('path');

// Carico .env se presente (non fallire se manca)
try {
  const dotenvPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(dotenvPath)) {
    require('dotenv').config({ path: dotenvPath });
  }
} catch (_) {}

/* === Helpers === */
function toBool(v, def = false) {
  if (v === undefined || v === null || String(v).trim() === '') return def;
  const s = String(v).toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(s);
}
function toInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function mask(value, front = 2, back = 2) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= front + back) return '*'.repeat(s.length);
  return s.slice(0, front) + '*'.repeat(s.length - front - back) + s.slice(-back);
}

/* === Config === */
const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',

  PORT: toInt(process.env.PORT, 3000),

  // CORS (lista separata da virgola)
  CORS_WHITELIST: (process.env.CORS_WHITELIST || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  DB: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: toInt(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'app',
  },

  LOG: {
    dir: process.env.LOG_DIR || './logs',
    retentionDays: toInt(process.env.LOG_RETENTION_DAYS, 14),
    level: process.env.LOG_LEVEL || 'info',
  },

  // 🔐 AUTENTICAZIONE (bypass dev opzionale)
  AUTH: {
    devBypass   : toBool(process.env.AUTH_DEV_BYPASS, false),
    devUserEmail: process.env.AUTH_DEV_USER || 'dev@local',
    devUserId   : toInt(process.env.AUTH_DEV_ID, 0),
  },

  // 🔑 JWT per /api/auth (HS256)
  JWT: {
    secret     : process.env.JWT_SECRET || '',
    ttlSeconds : toInt(process.env.JWT_TTL_SECONDS, 60 * 60 * 8), // 8h
    issuer     : process.env.JWT_ISSUER || undefined,             // (facoltativo, non obbligatorio in verify attuale)
    audience   : process.env.JWT_AUDIENCE || undefined,           // (facoltativo)
  },

  // Prenotazioni
  RESV: {
    defaultLunchMinutes : toInt(process.env.RESV_LUNCH_MINUTES, 60),
    defaultDinnerMinutes: toInt(process.env.RESV_DINNER_MINUTES, 90),

    // override vecchi
    allowAcceptOverride : toBool(process.env.RESV_ALLOW_ACCEPT_OVERRIDE, false),

    // 🔁 transizioni
    allowBacktrack      : toBool(process.env.RESV_ALLOW_BACKTRACK, true),
    allowAnyTransition  : toBool(process.env.RESV_ALLOW_ANY_TRANSITION, true),
    forceTransitions    : toBool(process.env.RESV_FORCE_TRANSITIONS, false),

    // 📧 notifiche (mail) sempre su cambio stato
    notifyAlways        : toBool(process.env.RESV_NOTIFY_ALWAYS, true),
  },

  // Email / SMTP
  MAIL: {
    enabled: toBool(process.env.MAIL_ENABLED, true),
    host   : process.env.SMTP_HOST || 'smtp.gmail.com',
    port   : toInt(process.env.SMTP_PORT, 587),
    secure : toBool(process.env.SMTP_SECURE, false),
    user   : process.env.SMTP_USER || '',
    pass   : process.env.SMTP_PASS || '',
    from   : process.env.MAIL_FROM || 'Prenotazioni <no-reply@example.com>',
    replyTo: process.env.MAIL_REPLY_TO || '',
    bizName: process.env.BIZ_NAME || 'La Mia Attività',
  },

  // 🟢 WhatsApp via Twilio
  WA: {
    enabled     : toBool(process.env.WA_ENABLED, false),
    accountSid  : process.env.TWILIO_ACCOUNT_SID || '',
    authToken   : process.env.TWILIO_AUTH_TOKEN || '',
    from        : process.env.WA_FROM || '',           // 'whatsapp:+39....'
    defaultCc   : process.env.WA_DEFAULT_CC || '+39',
    mediaLogo   : process.env.WA_MEDIA_LOGO_URL || '',
    templateSid : process.env.WA_TEMPLATE_STATUS_CHANGE_SID || '',
  },

  // Util per debugging a runtime delle variabili
  _debugMailConfig() {
    const m = env.MAIL;
    return {
      enabled: m.enabled, host: m.host, port: m.port, secure: m.secure,
      user: mask(m.user, 3, 2), from: m.from, replyTo: m.replyTo,
      bizName: m.bizName, resvNotifyAlways: env.RESV.notifyAlways,
    };
  },
  _debugWaConfig() {
    const w = env.WA;
    return {
      enabled: w.enabled,
      accountSid: mask(w.accountSid, 4, 3),
      from: w.from,
      defaultCc: w.defaultCc,
      mediaLogo: w.mediaLogo ? '[set]' : '',
      templateSid: w.templateSid ? mask(w.templateSid, 4, 3) : '',
    };
  }
};

module.exports = env;
