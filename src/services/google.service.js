// src/services/google.service.js
// ----------------------------------------------------------------------------
// Google OAuth "code flow" per SPA (GIS popup) + People API.
// - Token persistiti in tabella `google_tokens` con chiave `owner` ('default').
// - exchangeCode usa redirect_uri = 'postmessage' (obbligatorio per GIS popup).
// - ensureAuth: se non trova token → lancia { code: 'consent_required' }.
// - peopleClient: helper per usare googleapis People v1.
// ----------------------------------------------------------------------------

'use strict';

const { google } = require('googleapis');
const logger = require('../logger');
const { query } = require('../db');

const OWNER = 'default';

function env() {
  return {
    clientId:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    scopes:       (process.env.GOOGLE_SCOPES || 'https://www.googleapis.com/auth/contacts.readonly'),
    // callback classico (opzionale, manteniamo per compatibilità)
    redirectUrl:  process.env.GOOGLE_REDIRECT_URL || null,
  };
}

function newOAuthClient(redirectUri = null) {
  const e = env();
  return new google.auth.OAuth2(
    e.clientId,
    e.clientSecret,
    redirectUri || e.redirectUrl || 'http://localhost:3000/api/google/oauth/callback'
  );
}

// Salvataggio atomico token (upsert su owner)
async function saveTokens(owner, tokens) {
  const { access_token, refresh_token, scope, token_type, expiry_date } = tokens || {};
  await query(`
    CREATE TABLE IF NOT EXISTS google_tokens (
      owner        VARCHAR(64) PRIMARY KEY,
      access_token TEXT,
      refresh_token TEXT,
      scope        TEXT,
      token_type   VARCHAR(32),
      expiry_date  BIGINT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    INSERT INTO google_tokens (owner, access_token, refresh_token, scope, token_type, expiry_date)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      access_token = VALUES(access_token),
      refresh_token = IFNULL(VALUES(refresh_token), refresh_token),
      scope = VALUES(scope),
      token_type = VALUES(token_type),
      expiry_date = VALUES(expiry_date)
  `, [owner, access_token || null, refresh_token || null, scope || null, token_type || null, expiry_date || null]);

  logger.info('🔐 Google tokens salvati/aggiornati', { owner });
}

async function loadTokens(owner) {
  const rows = await query(`SELECT * FROM google_tokens WHERE owner = ? LIMIT 1`, [owner]);
  return rows?.[0] || null;
}

// Exchange del "code" lato backend: redirect_uri = 'postmessage'
async function exchangeCode(code) {
  const oauth2 = newOAuthClient('postmessage'); // GIS popup → SEMPRE 'postmessage'
  const { tokens } = await oauth2.getToken({ code, redirect_uri: 'postmessage' });
  await saveTokens(OWNER, tokens);
  return tokens;
}

// Garantisce client autenticato o segnala consenso mancante
async function ensureAuth() {
  const tokens = await loadTokens(OWNER);
  if (!tokens || !tokens.access_token) {
    const e = new Error('consent_required');
    e.code = 'consent_required';
    throw e;
  }
  const oauth2 = newOAuthClient();
  oauth2.setCredentials(tokens);

  // refresh se scaduto e ho refresh_token
  const now = Date.now();
  const exp = Number(tokens.expiry_date || 0);
  if (tokens.refresh_token && exp && exp - 60000 < now) {
    logger.info('♻️ Refresh token Google…');
    const { credentials } = await oauth2.refreshAccessToken();
    await saveTokens(OWNER, credentials);
    oauth2.setCredentials(credentials);
  }
  return oauth2;
}

function peopleClient(auth) {
  return google.people({ version: 'v1', auth });
}

module.exports = {
  exchangeCode,
  ensureAuth,
  peopleClient,
};
