// src/api/google/people.js
'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../logger');
const { ensureAuth, peopleClient } = require('../../services/google.service');

// GET /api/google/people/search?q=...&limit=12
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || '12', 10)));

  if (q.length < 2) return res.json({ ok: true, items: [] });

  try {
    const auth = await ensureAuth();
    const people = peopleClient(auth);

    const resp = await people.people.searchContacts({
      query: q,
      pageSize: limit,
      readMask: 'names,emailAddresses,phoneNumbers',
    });

    const items = (resp.data.results || []).map(r => {
      const names = r.person?.names || [];
      const emails = r.person?.emailAddresses || [];
      const phones = r.person?.phoneNumbers || [];
      const n = names[0] || {};
      return {
        displayName: n.displayName || null,
        givenName:   n.givenName   || null,
        familyName:  n.familyName  || null,
        email:       emails[0]?.value || null,
        phone:       phones[0]?.value || null,
      };
    });

    return res.json({ ok: true, items });
  } catch (e) {
    if (e?.code === 'consent_required') {
      // 401 → il FE mostrerà il bottone "Connetti Google"
      return res.status(401).json({
        ok: false,
        reason: 'google_consent_required',
      });
    }
    logger.error('👤 People search KO', { error: String(e) });
    return res.status(500).json({ ok: false, message: 'people_search_failed' });
  }
});

module.exports = router;
