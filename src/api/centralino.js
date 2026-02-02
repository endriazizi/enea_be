// src/api/centralino.js
// ============================================================================
// Centralino → apertura /asporto con prefill caller
// - GET /api/centralino/call?key=...&callerid=...&remark=...
// - Se remark == "tasto1" → redirect a /asporto con query precompilata
// ============================================================================
'use strict';

const express = require('express');
const router = express.Router();

module.exports = (app) => {
  const db = app?.get('db') || require('../db');
  const log = app?.get('logger') || console;
  const env = require('../env');

  async function q(sql, params = []) {
    const res = await db.query(sql, params);
    return (Array.isArray(res) && Array.isArray(res[0])) ? res[0] : res;
  }

  const normDigits = (v) => String(v || '').replace(/\D+/g, '');

  function isTasto1(raw) {
    const s = String(raw || '').trim().toLowerCase();
    return s === 'tasto1' || s === 'tasto 1' || s === 'tasto_1';
  }

  async function lookupCustomerByPhone(phoneRaw) {
    const digits = normDigits(phoneRaw);
    if (!digits) return null;
    const like = `%${digits}`;
    const rows = await q(
      `SELECT id, full_name, first_name, last_name, phone
       FROM users
       WHERE REPLACE(REPLACE(REPLACE(COALESCE(phone,''),' ',''),'+',''),'-','') LIKE ?
       ORDER BY id DESC
       LIMIT 1`,
      [like],
    );
    const r = rows && rows[0] ? rows[0] : null;
    if (!r) return null;
    const full =
      (r.full_name || '').trim() ||
      `${r.first_name || ''} ${r.last_name || ''}`.trim();
    return {
      id: r.id,
      full_name: full || null,
      first_name: r.first_name || null,
      last_name: r.last_name || null,
      phone: r.phone || phoneRaw || null,
    };
  }

  router.get('/call', async (req, res) => {
    const key = String(req.query.key || '');
    if (!env.CENTRALINO_KEY || key !== env.CENTRALINO_KEY) {
      return res.status(403).json({ ok: false, error: 'invalid_key' });
    }

    const callerid = String(req.query.callerid || '');
    const remark = String(req.query.remark || '');
    const remark2 = String(req.query.remark2 || '');
    const remark3 = String(req.query.remark3 || '');
    const calledid = String(req.query.calledid || '');
    const uniqueid = String(req.query.uniqueid || '');

    log.info('📞 [Centralino] call', {
      callerid,
      calledid,
      uniqueid,
      remark,
      remark2,
      remark3,
    });

    if (!isTasto1(remark)) {
      return res.json({ ok: true, action: 'ignore' });
    }

    let customer = null;
    try {
      customer = await lookupCustomerByPhone(callerid);
    } catch (e) {
      log.warn('⚠️ [Centralino] lookup KO', { error: String(e) });
    }

    // 📡 Realtime: broadcast centralino-call (best-effort, non blocca redirect)
    try {
      const sockets = require('../sockets');
      const io = sockets && typeof sockets.io === 'function' ? sockets.io() : null;
      if (io) {
        io.emit('centralino-call', {
          callerid,
          calledid,
          uniqueid,
          remark,
          customer: customer || null,
        });
        log.info('📡 [Centralino] emit centralino-call OK', {
          callerid,
          calledid,
          uniqueid,
          remark,
        });
      } else {
        log.warn('⚠️ [Centralino] socket.io non disponibile (io nullo)');
      }
    } catch (e) {
      log.warn('⚠️ [Centralino] emit realtime KO', { error: String(e) });
    }

    const base =
      (env.CENTRALINO_REDIRECT_BASE || '').trim() ||
      `${req.protocol}://${req.get('host')}`;

    const params = new URLSearchParams();
    if (callerid) params.set('callerid', callerid);
    if (customer?.full_name) params.set('customer_name', customer.full_name);
    if (customer?.first_name) params.set('customer_first', customer.first_name);
    if (customer?.last_name) params.set('customer_last', customer.last_name);

    const url = `${base}/asporto?${params.toString()}`;
    return res.redirect(302, url);
  });

  // Optional: lookup JSON (per FE)
  router.get('/lookup', async (req, res) => {
    const key = String(req.query.key || '');
    if (!env.CENTRALINO_KEY || key !== env.CENTRALINO_KEY) {
      return res.status(403).json({ ok: false, error: 'invalid_key' });
    }
    const callerid = String(req.query.callerid || '');
    const customer = await lookupCustomerByPhone(callerid);
    res.json({ ok: true, callerid, customer });
  });

  return router;
};
