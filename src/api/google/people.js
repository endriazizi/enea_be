// src/api/google/people.js
// ============================================================================
// Proxy People API.
// - GET /api/google/people/search   → lista contatti (read scope)
// - POST /api/google/people/create  → crea contatto (write scope richiesto)
// Se mancano token → 401 { reason: 'google_consent_required' }.
// Se manca lo scope write → 403 { reason: 'google_scope_write_required' }.
// ============================================================================
'use strict';

const express = require('express');
const router = express.Router();
// ✅ FIX path (sei in /api/google)
const logger = require('../../logger');
const {
  searchContacts,
  createContact,
  updateContact,
  ensureAuth
} = require('../../services/google.service');

// GET /api/google/people/search?q=...&limit=12
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '12', 10)));
  logger.info('[Google BE] GET /api/google/people/search', { q, limit });

  if (q.length < 2) return res.json({ ok: true, items: [] });

  try {
    await ensureAuth();
    const items = await searchContacts(q, limit);
    logger.info('[Google BE] people/search OK', { count: items.length });
    return res.json({ ok: true, items });
  } catch (e) {
    const code = e?.code || '';
    if (code === 'consent_required') {
      logger.warn('[Google BE] people/search: consenso mancante → 401 google_consent_required');
      return res.status(401).json({ ok: false, reason: 'google_consent_required' });
    }
    logger.error('[Google BE] people/search KO', { error: String(e) });
    return res.status(500).json({ ok: false, message: 'search_failed' });
  }
});

// POST /api/google/people/create
// body: { displayName?, givenName?, familyName?, email?, phone?, note? }
router.post('/create', express.json(), async (req, res) => {
  const { displayName, givenName, familyName, email, phone, note } = req.body || {};
  logger.info('[Google BE] POST /api/google/people/create', { displayName: displayName || email || '(no name)' });

  try {
    const out = await createContact({ displayName, givenName, familyName, email, phone, note });
    logger.info('[Google BE] people/create OK', { resourceName: out?.resourceName });
    return res.json(out);
  } catch (e) {
    const code = e?.code || '';
    if (code === 'consent_required') {
      logger.warn('[Google BE] people/create: consenso mancante → 401 google_consent_required');
      return res.status(401).json({ ok: false, reason: 'google_consent_required' });
    }
    if (code === 'write_scope_required') {
      logger.warn('[Google BE] people/create: scope scrittura mancante → 403 google_scope_write_required');
      return res.status(403).json({ ok: false, reason: 'google_scope_write_required' });
    }
    logger.error('[Google BE] people/create KO', { error: String(e) });
    return res.status(500).json({ ok: false, message: 'create_failed' });
  }
});

// PATCH /api/google/people/update — aggiorna contatto esistente (match da ricerca)
// body: { resourceName, etag?, displayName?, givenName?, familyName?, email?, phone?, note? }
router.patch('/update', express.json(), async (req, res) => {
  const { resourceName, etag, displayName, givenName, familyName, email, phone, note } = req.body || {};
  logger.info('[Google BE] PATCH /api/google/people/update', { resourceName });

  if (!resourceName || typeof resourceName !== 'string') {
    logger.warn('[Google BE] people/update: resourceName mancante');
    return res.status(400).json({ ok: false, reason: 'resourceName_required' });
  }

  try {
    const out = await updateContact({
      resourceName,
      etag,
      displayName,
      givenName,
      familyName,
      email,
      phone,
      note,
    });
    logger.info('[Google BE] people/update OK', { resourceName: out?.resourceName });
    return res.json(out);
  } catch (e) {
    const code = e?.code || '';
    if (code === 'consent_required') {
      logger.warn('[Google BE] people/update: consenso mancante → 401 google_consent_required');
      return res.status(401).json({ ok: false, reason: 'google_consent_required' });
    }
    if (code === 'write_scope_required') {
      logger.warn('[Google BE] people/update: scope scrittura mancante → 403 google_scope_write_required');
      return res.status(403).json({ ok: false, reason: 'google_scope_write_required' });
    }
    logger.error('[Google BE] people/update KO', { error: String(e) });
    return res.status(500).json({ ok: false, message: 'update_failed' });
  }
});

module.exports = router;
