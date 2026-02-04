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
const crypto = require('crypto');
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
    readMask: 'names,emailAddresses,phoneNumbers,biographies',
  });

  const items = (resp.data.results || []).map((r) => {
    const p = r.person || {};
    const name  = p.names?.[0];
    const email = p.emailAddresses?.[0];
    const phone = p.phoneNumbers?.[0];
    const bio   = p.biographies?.[0];

    return {
      resourceName: p.resourceName || r.person?.resourceName || null,
      etag:         p.etag || r.person?.etag || null,
      displayName: name?.displayName || null,
      givenName:   name?.givenName || null,
      familyName:  name?.familyName || null,
      email:       email?.value || null,
      phone:       phone?.value || null,
      note:        bio?.value || null,
    };
  });

  return items;
}

// Crea un contatto (serve scope write: https://www.googleapis.com/auth/contacts)
async function createContact({ givenName, familyName, displayName, email, phone, note }) {
  const auth = await ensureAuth();            // può lanciare consent_required
  const people = peopleClient(auth);

  try {
    const requestBody = {
      names: [{ givenName: givenName || undefined, familyName: familyName || undefined, displayName: displayName || undefined }],
      emailAddresses: email ? [{ value: email }] : undefined,
      phoneNumbers:   phone ? [{ value: phone }] : undefined,
      biographies:    note ? [{ value: note, contentType: 'TEXT_PLAIN' }] : undefined,
    };

    const resp = await people.people.createContact({ requestBody });
    const resourceName = resp.data?.resourceName || null;
    const etag = resp.data?.etag || null;
    logger.info('👤 [Google] contact created', { resourceName });
    return { ok: true, resourceName, etag };
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

// Aggiorna un contatto esistente (best-effort)
async function updateContact({ resourceName, etag, givenName, familyName, displayName, email, phone, note }) {
  if (!resourceName) {
    const err = new Error('resourceName_required');
    err.code = 'resource_name_required';
    throw err;
  }
  const auth = await ensureAuth();
  const people = peopleClient(auth);

  let contactEtag = etag;
  if (!contactEtag) {
    const got = await people.people.get({
      resourceName,
      personFields: 'names,emailAddresses,phoneNumbers,biographies',
    });
    contactEtag = got?.data?.etag || null;
  }

  const nameValue = (displayName || `${givenName || ''} ${familyName || ''}`.trim() || null);
  const requestBody = {
    resourceName,
    etag: contactEtag || undefined,
    names: nameValue ? [{ displayName: nameValue, givenName: givenName || undefined, familyName: familyName || undefined }] : undefined,
    emailAddresses: email ? [{ value: email }] : undefined,
    phoneNumbers:   phone ? [{ value: phone }] : undefined,
    biographies:    note ? [{ value: note, contentType: 'TEXT_PLAIN' }] : undefined,
  };

  const updateFields = [];
  if (requestBody.names) updateFields.push('names');
  if (requestBody.emailAddresses) updateFields.push('emailAddresses');
  if (requestBody.phoneNumbers) updateFields.push('phoneNumbers');
  if (requestBody.biographies) updateFields.push('biographies');

  if (!updateFields.length) {
    return { ok: false, reason: 'no_fields' };
  }

  const resp = await people.people.updateContact({
    resourceName,
    updatePersonFields: updateFields.join(','),
    requestBody,
  });

  const updated = resp?.data || {};
  logger.info('👤 [Google] contact updated', { resourceName, fields: updateFields });
  return { ok: true, resourceName: updated.resourceName || resourceName, etag: updated.etag || contactEtag };
}

// ----------------------------------------------------------------------------
// Upsert "pro"
// ----------------------------------------------------------------------------
function normalizePhone(v) {
  return String(v || '').replace(/\D+/g, '');
}

function isPhoneMatch(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 8 && nb.length >= 8) return na.slice(-8) === nb.slice(-8);
  return false;
}

function isEmailMatch(a, b) {
  const ea = String(a || '').trim().toLowerCase();
  const eb = String(b || '').trim().toLowerCase();
  if (!ea || !eb) return false;
  return ea === eb;
}

function buildContactPayloadFromUser(user) {
  const first = String(user?.first_name || '').trim();
  const last = String(user?.last_name || '').trim();
  const full =
    String(user?.full_name || '').trim() ||
    String(user?.name || '').trim() ||
    `${first} ${last}`.trim();

  return {
    givenName: first || undefined,
    familyName: last || undefined,
    displayName: full || undefined,
    email: String(user?.email || '').trim() || undefined,
    phone: String(user?.phone || '').trim() || undefined,
    note: String(user?.note || '').trim() || undefined,
  };
}

function buildLocalSnapshot(payload) {
  return {
    displayName: payload.displayName || null,
    givenName: payload.givenName || null,
    familyName: payload.familyName || null,
    email: payload.email || null,
    phone: payload.phone || null,
    note: payload.note || null,
  };
}

function buildHash(snapshot) {
  const json = JSON.stringify(snapshot || {});
  return crypto.createHash('sha256').update(json).digest('hex');
}

function toContactSnapshot(raw) {
  return {
    resourceName: raw?.resourceName || null,
    etag: raw?.etag || null,
    displayName: raw?.displayName || null,
    givenName: raw?.givenName || null,
    familyName: raw?.familyName || null,
    email: raw?.email || null,
    phone: raw?.phone || null,
    note: raw?.note || null,
  };
}

async function getContact(resourceName) {
  if (!resourceName) return null;
  const auth = await ensureAuth();
  const people = peopleClient(auth);
  const resp = await people.people.get({
    resourceName,
    personFields: 'names,emailAddresses,phoneNumbers,biographies',
  });
  const p = resp?.data || {};
  const name = p.names?.[0] || {};
  const email = p.emailAddresses?.[0] || {};
  const phone = p.phoneNumbers?.[0] || {};
  const bio = p.biographies?.[0] || {};
  return toContactSnapshot({
    resourceName: p.resourceName || resourceName,
    etag: p.etag || null,
    displayName: name.displayName || null,
    givenName: name.givenName || null,
    familyName: name.familyName || null,
    email: email.value || null,
    phone: phone.value || null,
    note: bio.value || null,
  });
}

function isEtagMismatchError(e) {
  const code = e?.code || e?.response?.status || null;
  if (code === 412 || code === 409) return true;
  const msg = String(e?.message || e || '').toLowerCase();
  return msg.includes('etag') || msg.includes('precondition');
}

function detectConflict(localSnap, googleSnap) {
  if (!googleSnap) return false;
  const localPhone = normalizePhone(localSnap?.phone);
  const googlePhone = normalizePhone(googleSnap?.phone);
  const phoneConflict =
    localPhone && googlePhone && localPhone !== googlePhone;

  const localEmail = String(localSnap?.email || '').trim().toLowerCase();
  const googleEmail = String(googleSnap?.email || '').trim().toLowerCase();
  const emailConflict =
    localEmail && googleEmail && localEmail !== googleEmail;

  const localName = String(localSnap?.displayName || '').trim().toLowerCase();
  const googleName = String(googleSnap?.displayName || '').trim().toLowerCase();
  const nameConflict =
    localName && googleName && localName !== googleName;

  return phoneConflict || emailConflict || nameConflict;
}

async function insertConflict(userId, localSnap, googleSnap) {
  const localJson = JSON.stringify(localSnap || {});
  const googleJson = JSON.stringify(googleSnap || {});
  try {
    const res = await query(
      `INSERT INTO google_contact_conflicts
        (user_id, local_snapshot_json, google_snapshot_json, status, created_at)
       VALUES (?, ?, ?, 'pending', UTC_TIMESTAMP())`,
      [userId, localJson, googleJson],
    );
    return res?.insertId || null;
  } catch (e) {
    logger.warn('👤⚠️ [Google] conflict insert KO', { error: String(e), userId });
    return null;
  }
}

async function updateUserGoogleMeta(userId, { resourceName, etag, hash }) {
  if (!userId) return;
  await query(
    `UPDATE users
     SET
       google_resource_name = COALESCE(?, google_resource_name),
       google_etag = COALESCE(?, google_etag),
       google_sync_hash = COALESCE(?, google_sync_hash),
       google_sync_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [resourceName || null, etag || null, hash || null, userId],
  );
}

async function findBestMatchByPhoneEmail({ phone, email }) {
  const items = [];
  if (phone) {
    const list = await searchContacts(phone, 10);
    items.push(...(list || []));
  }
  if (email) {
    const list = await searchContacts(email, 10);
    items.push(...(list || []));
  }
  const byPhone = items.find((it) => isPhoneMatch(phone, it.phone));
  if (byPhone) return toContactSnapshot(byPhone);
  const byEmail = items.find((it) => isEmailMatch(email, it.email));
  if (byEmail) return toContactSnapshot(byEmail);
  return null;
}

async function upsertContactFromUser(user = {}) {
  const userId = user?.id || null;
  if (!userId) return { ok: false, reason: 'missing_user_id' };

  const payload = buildContactPayloadFromUser(user);
  const localSnap = buildLocalSnapshot(payload);
  const hash = buildHash(localSnap);

  if (!payload.phone && !payload.email && !payload.displayName) {
    return { ok: false, reason: 'empty_payload' };
  }

  const resourceName = user.google_resource_name || null;
  const etag = user.google_etag || null;

  // 1) Se ho già resourceName → update con etag
  if (resourceName) {
    try {
      const res = await updateContact({
        resourceName,
        etag,
        ...payload,
      });
      await updateUserGoogleMeta(userId, {
        resourceName: res.resourceName || resourceName,
        etag: res.etag || etag,
        hash,
      });
      return { ok: true, resourceName: res.resourceName || resourceName };
    } catch (e) {
      if (isEtagMismatchError(e)) {
        const remote = await getContact(resourceName);
        if (detectConflict(localSnap, remote)) {
          const conflictId = await insertConflict(userId, localSnap, remote);
          logger.warn('👤⚠️ [Google] conflict detected (etag mismatch)', {
            userId,
            resourceName,
            conflictId,
          });
          return { ok: false, reason: 'conflict', conflictId };
        }
        try {
          const res = await updateContact({
            resourceName,
            etag: remote?.etag || null,
            ...payload,
          });
          await updateUserGoogleMeta(userId, {
            resourceName: res.resourceName || resourceName,
            etag: res.etag || remote?.etag || null,
            hash,
          });
          return { ok: true, resourceName: res.resourceName || resourceName };
        } catch (e2) {
          logger.warn('👤⚠️ [Google] update retry failed', {
            error: String(e2),
            resourceName,
          });
          const conflictId = await insertConflict(userId, localSnap, remote);
          return { ok: false, reason: 'update_failed', conflictId };
        }
      }
      logger.warn('👤⚠️ [Google] update failed', { error: String(e), resourceName });
      return { ok: false, reason: 'update_failed' };
    }
  }

  // 2) Se non ho resourceName → search by phone/email
  try {
    const match = await findBestMatchByPhoneEmail({
      phone: payload.phone,
      email: payload.email,
    });
    if (match?.resourceName) {
      await updateUserGoogleMeta(userId, {
        resourceName: match.resourceName,
        etag: match.etag || null,
        hash,
      });
      if (detectConflict(localSnap, match)) {
        const conflictId = await insertConflict(userId, localSnap, match);
        logger.warn('👤⚠️ [Google] conflict detected (search match)', {
          userId,
          resourceName: match.resourceName,
          conflictId,
        });
        return { ok: false, reason: 'conflict', conflictId };
      }
      try {
        const res = await updateContact({
          resourceName: match.resourceName,
          etag: match.etag || null,
          ...payload,
        });
        await updateUserGoogleMeta(userId, {
          resourceName: res.resourceName || match.resourceName,
          etag: res.etag || match.etag || null,
          hash,
        });
        return { ok: true, resourceName: res.resourceName || match.resourceName };
      } catch (e) {
        logger.warn('👤⚠️ [Google] update after search failed', {
          error: String(e),
          resourceName: match.resourceName,
        });
        return { ok: false, reason: 'update_failed' };
      }
    }
  } catch (e) {
    logger.warn('👤⚠️ [Google] search failed', { error: String(e) });
  }

  // 3) create
  try {
    const res = await createContact(payload);
    await updateUserGoogleMeta(userId, {
      resourceName: res.resourceName || null,
      etag: res.etag || null,
      hash,
    });
    return { ok: true, resourceName: res.resourceName || null };
  } catch (e) {
    logger.warn('👤⚠️ [Google] create failed', { error: String(e) });
    return { ok: false, reason: 'create_failed' };
  }
}

module.exports = {
  exchangeCode,
  ensureAuth,
  peopleClient,
  searchContacts,
  createContact,
  updateContact,
  getContact,
  upsertContactFromUser,
  revokeForOwner,
};
