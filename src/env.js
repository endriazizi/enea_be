// src/env.js
// Carica .env e costruisce la config centrale dell'app.
// Qui definiamo anche le regole di prenotazione (RESV) e JWT.
// ATTENZIONE: evitiamo di importare logger qui per non creare cicli.

const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

function toInt(v, def) {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : def;
}

const cfg = {
  env: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') !== 'production',
  port: toInt(process.env.PORT, 3000),

  // Origini CORS (lista separata da virgole)
  corsWhitelist: (process.env.CORS_WHITELIST || 'http://localhost:8100,http://localhost:4200')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // DB
  DB: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: toInt(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pizzeria_1',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  },

  // 🔐 JWT (usato in /api/auth/*)
  JWT: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    ttlSeconds: toInt(process.env.JWT_TTL_SECONDS, 8 * 60 * 60) // default: 8h
  },

  // 🍽️ Regole prenotazioni (durata slot)
  RESV: {
    // default pranzo/cena, sovrascrivibili via .env
    defaultLunchMinutes: toInt(process.env.RESV_LUNCH_MINUTES, 60),
    defaultDinnerMinutes: toInt(process.env.RESV_DINNER_MINUTES, 90),
    // in futuro: durata per sala/party_size/fasce orarie…
  }
};

// Dump sintetico in dev (senza password/secret)
if (cfg.isDev) {
  const safe = {
    env: cfg.env,
    port: cfg.port,
    corsWhitelist: cfg.corsWhitelist,
    DB: { ...cfg.DB, password: cfg.DB.password ? '***' : '(vuota)' },
    JWT: { ttlSeconds: cfg.JWT.ttlSeconds, secret: cfg.JWT.secret ? '***' : '(manca!)' },
    RESV: cfg.RESV
  };
  console.log('🧾 ENV DUMP ▶️', safe);
}

module.exports = cfg;
