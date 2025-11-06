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
  ensureAuth
} = require('../../services/google.service');

// GET /api/google/people/search?q=...&limit=12
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '12', 10)));

  if (q.length < 2) return res.json({ ok: true, items: [] });

  try {
    // ensureAuth usato per segnalare 401 in caso di mancanza token
    await ensureAuth();
    const items = await searchContacts(q, limit);
    return res.json({ ok: true, items });
  } catch (e) {
    const code = e?.code || '';
    if (code === 'consent_required') {
      return res.status(401).json({ ok: false, reason: 'google_consent_required' });
    }
    logger.error('🔎❌ [Google] people.search failed', { error: String(e) });
    return res.status(500).json({ ok: false, message: 'search_failed' });
  }
});

// POST /api/google/people/create
// body: { displayName?, givenName?, familyName?, email?, phone? }
router.post('/create', express.json(), async (req, res) => {
  const { displayName, givenName, familyName, email, phone } = req.body || {};

  try {
    const out = await createContact({ displayName, givenName, familyName, email, phone });
    return res.json(out);
  } catch (e) {
    const code = e?.code || '';
    if (code === 'consent_required') {
      return res.status(401).json({ ok: false, reason: 'google_consent_required' });
    }
    if (code === 'write_scope_required') {
      return res.status(403).json({ ok: false, reason: 'google_scope_write_required' });
    }
    logger.error('👤❌ [Google] people.create failed', { error: String(e) });
    return res.status(500).json({ ok: false, message: 'create_failed' });
  }
});

module.exports = router;
