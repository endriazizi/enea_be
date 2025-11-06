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
// ✅ FIX path relativi dal folder /services → vai su ../logger e ../db:
const logger = require('../logger');
const { query } = require('../db');

const OWNER = 'default';

// Legge le variabili d'ambiente (già gestite nel tuo env loader)
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  // Se usi il popup GIS, la redirect è sempre 'postmessage'
  GOOGLE_SCOPES = 'https://www.googleapis.com/auth/contacts.readonly'
} = process.env;

// ----------------------------------------------------------------------------
// OAuth2 client (usa redirect 'postmessage' per il popup GIS)
// ----------------------------------------------------------------------------
function getOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
    // niente redirect_url qui: lo passiamo nella getToken come 'postmessage'
  );
  return { oAuth2Client };
}

// ----------------------------------------------------------------------------
// DB helpers – salvataggio e lettura token (owner='default')
// Schema atteso: google_tokens(owner PK, access_token, refresh_token, scope, expiry_date BIGINT)
// ----------------------------------------------------------------------------
async function saveTokens(tokens = {}) {
  const { access_token, refresh_token, scope, expiry_date } = tokens;
  await query(
    `INSERT INTO google_tokens (owner, access_token, refresh_token, scope, expiry_date)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       access_token = VALUES(access_token),
       refresh_token = COALESCE(VALUES(refresh_token), refresh_token),
       scope = VALUES(scope),
       expiry_date = VALUES(expiry_date)`,
    [OWNER, access_token || null, refresh_token || null, scope || null, expiry_date || null]
  );
}

async function loadTokens() {
  const [row] = await query(`SELECT access_token, refresh_token, scope, expiry_date FROM google_tokens WHERE owner=?`, [OWNER]);
  return row || null;
}

async function revokeForOwner() {
  await query(`DELETE FROM google_tokens WHERE owner=?`, [OWNER]);
  logger.info('🧹 [Google] tokens revoked/removed for owner', { owner: OWNER });
}

// ----------------------------------------------------------------------------
// Exchange 'code' (GIS popup) → tokens
// ----------------------------------------------------------------------------
async function exchangeCode(code) {
  const { oAuth2Client } = getOAuthClient();
  // NB: con GIS popup serve passare redirect_uri='postmessage'
  const { tokens } = await oAuth2Client.getToken({ code, redirect_uri: 'postmessage' });
  // Salvo anche expiry_date (numero ms epoch) se presente
  await saveTokens(tokens);
  logger.info('🔐 [Google] Code exchanged, tokens saved', { has_refresh: !!tokens.refresh_token });
  return tokens;
}

// ----------------------------------------------------------------------------
// ensureAuth(): garantisce un OAuth client con access token valido (refresh se scaduto)
// Se i token non ci sono → errore 'consent_required' (FE deve aprire popup).
// ----------------------------------------------------------------------------
async function ensureAuth() {
  const tokens = await loadTokens();
  if (!tokens?.refresh_token) {
    const err = new Error('Consent required');
    err.code = 'consent_required';
    throw err;
  }

  const { oAuth2Client } = getOAuthClient();
  oAuth2Client.setCredentials({
    access_token: tokens.access_token || undefined,
    refresh_token: tokens.refresh_token || undefined,
    scope: tokens.scope || undefined,
    expiry_date: tokens.expiry_date || undefined
  });

  // se scaduto/assente → refresh
  const needsRefresh = !tokens.access_token || !tokens.expiry_date || (Date.now() >= Number(tokens.expiry_date) - 30_000);
  if (needsRefresh) {
    try {
      const newTokens = (await oAuth2Client.refreshAccessToken())?.credentials || {};
      // persisto i nuovi token
      await saveTokens(newTokens);
      oAuth2Client.setCredentials(newTokens);
      logger.info('🔄 [Google] access token refreshed');
    } catch (e) {
      logger.error('🔄❌ [Google] token refresh failed', { error: String(e) });
      // se fallisce il refresh, meglio richiedere nuovamente consenso
      const err = new Error('Consent required');
      err.code = 'consent_required';
      throw err;
    }
  }

  return oAuth2Client;
}

// ----------------------------------------------------------------------------
// People API client
// ----------------------------------------------------------------------------
function peopleClient(auth) {
  return google.people({ version: 'v1', auth });
}

// ----------------------------------------------------------------------------
// Operazioni People API (read / write)
// ----------------------------------------------------------------------------
async function searchContacts(q, limit = 12) {
  const auth = await ensureAuth();            // può lanciare consent_required
  const people = peopleClient(auth);
  const resp = await people.people.searchContacts({
    query: q,
    pageSize: Math.min(50, Math.max(1, limit)),
    readMask: 'names,emailAddresses,phoneNumbers',
  });

  const items = (resp.data.results || []).map((r) => {
    const p = r.person || {};
    const name  = p.names?.[0];
    const email = p.emailAddresses?.[0];
    const phone = p.phoneNumbers?.[0];

    return {
      displayName: name?.displayName || null,
      givenName:   name?.givenName || null,
      familyName:  name?.familyName || null,
      email:       email?.value || null,
      phone:       phone?.value || null,
    };
  });

  return items;
}

// Crea un contatto (serve scope write: https://www.googleapis.com/auth/contacts)
async function createContact({ givenName, familyName, displayName, email, phone }) {
  const auth = await ensureAuth();            // può lanciare consent_required
  const people = peopleClient(auth);

  try {
    const requestBody = {
      names: [{ givenName: givenName || undefined, familyName: familyName || undefined, displayName: displayName || undefined }],
      emailAddresses: email ? [{ value: email }] : undefined,
      phoneNumbers:   phone ? [{ value: phone }] : undefined,
    };

    const resp = await people.people.createContact({ requestBody });
    const resourceName = resp.data?.resourceName || null;
    logger.info('👤 [Google] contact created', { resourceName });
    return { ok: true, resourceName };
  } catch (e) {
    const msg = String(e?.message || e);
    // se i token non includono scope write → 403 insufficient permissions
    if (msg.includes('insufficient') || msg.includes('permission')) {
      const err = new Error('write_scope_required');
      err.code = 'write_scope_required';
      throw err;
    }
    logger.error('👤❌ [Google] createContact failed', { error: msg });
    throw e;
  }
}

module.exports = {
  exchangeCode,
  ensureAuth,
  peopleClient,
  searchContacts,
  createContact,
  revokeForOwner,
};
