// ============================================================================
// CUSTOMERS API — i “clienti” sono righe della tabella `users`
// Rotte:
//   GET  /api/customers               → lista (SEMPR E ARRAY)
//   GET  /api/customers/:id           → dettaglio (OGGETTO)
//   POST /api/customers               → crea
//   PUT  /api/customers/:id           → aggiorna
//   PUT  /api/customers/:id/disable   → is_active=0
//   PUT  /api/customers/:id/enable    → is_active=1
//   GET  /api/customers/:id/orders    → storico ordini
// Stile: commenti 🇮🇹 + log a emoji. Compatibile sia con mysql2 pool che con wrapper { query }.
// ============================================================================

'use strict';
const express = require('express');
const router  = express.Router();

module.exports = (app) => {
  const db  = app?.get('db') || require('../db');
  const log = app?.get('logger') || console;

  // Normalizza il risultato di db.query():
  // - mysql2/promise → [rows, fields]  → ritorna rows
  // - wrapper { query }                → ritorna già rows
  async function q(sql, params = []) {
    const res = await db.query(sql, params);
    return (Array.isArray(res) && Array.isArray(res[0])) ? res[0] : res;
  }

  const like = v => `%${String(v || '').trim().toLowerCase()}%`;
  const normPhone = v => String(v || '').replace(/\s+/g, '').replace(/^\+/, '').replace(/-/g, '');

  // ---- LIST (sempre array) -----------------------------------------------
  router.get('/', async (req, res) => {
    const qRaw   = String(req.query.q || '').trim();
    const qlow   = qRaw.toLowerCase();
    const limit  = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    res.set('x-route', 'customers:list');
    log.info('👥 [Customers] list ▶️', { q: qRaw || '(tutti)', limit, offset });

    let where = '1=1';
    const params = [];

    if (qlow) {
      where = `(
        LOWER(COALESCE(u.full_name, ''))      LIKE ?
        OR LOWER(COALESCE(u.first_name, ''))  LIKE ?
        OR LOWER(COALESCE(u.last_name, ''))   LIKE ?
        OR LOWER(COALESCE(u.email, ''))       LIKE ?
        OR REPLACE(REPLACE(REPLACE(COALESCE(u.phone,''),' ',''),'+',''),'-','') LIKE ?
      )`;
      const qp = like(qlow);
      params.push(qp, qp, qp, qp, normPhone(qlow));
    }

    const sql = `
      SELECT
        u.id, u.full_name, u.first_name, u.last_name, u.email, u.phone,
        u.is_active, u.tags, u.note,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_user_id = u.id) AS orders_count,
        (SELECT IFNULL(SUM(i.qty*i.price),0)
           FROM orders o
           JOIN order_items i ON i.order_id = o.id
          WHERE o.customer_user_id = u.id) AS total_spent,
        (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_user_id = u.id) AS last_order_at
      FROM users u
      WHERE ${where}
      ORDER BY COALESCE(
               (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_user_id = u.id),
               u.id
             ) DESC
      LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    try {
      const rows = await q(sql, params);
      const out = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      log.info(`✅ [Customers] list ← ${out.length} righe`);
      res.json(out); // ← SEMPRE ARRAY
    } catch (e) {
      log.error('❌ /api/customers list', { error: String(e) });
      res.status(500).json([]); // ← SEMPRE ARRAY anche in errore
    }
  });

  // ---- DETAIL (oggetto) ---------------------------------------------------
  router.get('/:id(\\d+)', async (req, res) => {
    const id = Number(req.params.id);
    res.set('x-route', 'customers:detail');
    try {
      const rows = await q(`
        SELECT
          u.id, u.full_name, u.first_name, u.last_name, u.email, u.phone, u.is_active, u.tags, u.note,
          (SELECT COUNT(*) FROM orders o WHERE o.customer_user_id = u.id) AS orders_count,
          (SELECT IFNULL(SUM(i.qty*i.price),0)
             FROM orders o
             JOIN order_items i ON i.order_id = o.id
            WHERE o.customer_user_id = u.id) AS total_spent,
          (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_user_id = u.id) AS last_order_at
        FROM users u WHERE u.id=? LIMIT 1`, [id]);
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) return res.status(404).json({ ok:false, error: 'not_found' });
      log.info('ℹ️ [Customers] detail ←', { id });
      res.json(row);
    } catch {
      res.status(500).json({ ok:false, error: 'customer_detail_error' });
    }
  });

  // ---- CREATE -------------------------------------------------------------
  router.post('/', async (req, res) => {
    const { full_name, first_name, last_name, phone, email, note, tags, is_active } = req.body || {};
    try {
      const r = await q(`
        INSERT INTO users (full_name, first_name, last_name, phone, email, note, tags, is_active)
        VALUES (?,?,?,?,?,?,?,?)`,
        [full_name||null, first_name||null, last_name||null, phone||null, email||null, note||null, tags||null,
         (is_active===0?0:1)]);
      const id = Number(r?.insertId);
      const row = (await q(`SELECT * FROM users WHERE id=?`, [id]))?.[0] || null;
      log.info('🟢 [Customers] create id=', id);
      res.status(201).json(row);
    } catch (e) {
      log.error('❌ [Customers] create', String(e));
      res.status(500).json({ ok:false, error: 'customer_create_error' });
    }
  });

  // ---- UPDATE -------------------------------------------------------------
  router.put('/:id(\\d+)', async (req, res) => {
    const id = Number(req.params.id);
    const { full_name, first_name, last_name, phone, email, note, tags, is_active } = req.body || {};
    try {
      await q(`
        UPDATE users SET
          full_name = COALESCE(?, full_name),
          first_name= COALESCE(?, first_name),
          last_name = COALESCE(?, last_name),
          phone     = COALESCE(?, phone),
          email     = COALESCE(?, email),
          note      = COALESCE(?, note),
          tags      = COALESCE(?, tags),
          is_active = COALESCE(?, is_active)
        WHERE id=?`,
        [full_name, first_name, last_name, phone, email, note, tags,
         ([0,1].includes(is_active)? is_active : null), id]);
      const out = (await q(`SELECT * FROM users WHERE id=?`, [id]))?.[0] || null;
      log.info('✏️  [Customers] update id=', id);
      res.json(out);
    } catch (e) {
      log.error('❌ [Customers] update', String(e));
      res.status(500).json({ ok:false, error: 'customer_update_error' });
    }
  });

  // ---- ENABLE / DISABLE ---------------------------------------------------
  router.put('/:id(\\d+)/disable', async (req, res) => {
    const id = Number(req.params.id);
    await q(`UPDATE users SET is_active=0 WHERE id=?`, [id]);
    log.warn('⛔ [Customers] disable id=', id);
    res.json({ ok:true });
  });

  router.put('/:id(\\d+)/enable', async (req, res) => {
    const id = Number(req.params.id);
    await q(`UPDATE users SET is_active=1 WHERE id=?`, [id]);
    log.info('✅ [Customers] enable id=', id);
    res.json({ ok:true });
  });

  // ---- ORDERS of customer -------------------------------------------------
  router.get('/:id(\\d+)/orders', async (req, res) => {
    const id = Number(req.params.id);
    try {
      const rows = await q(`
        SELECT
          o.id, o.status, o.channel, o.created_at, o.scheduled_at, o.note,
          o.customer_name, o.phone, o.email,
          (SELECT SUM(i.qty*i.price) FROM order_items i WHERE i.order_id = o.id) AS total
        FROM orders o
        WHERE o.customer_user_id = ?
        ORDER BY o.created_at DESC
        LIMIT 500`, [id]);
      const out = (rows || []).map(r => ({ ...r, total: r.total!=null ? Number(r.total) : null }));
      res.json(out);
    } catch {
      res.status(500).json({ ok:false, error: 'customer_orders_error' });
    }
  });

  // 🔧 sanity ping
  router.get('/_debug/ping', (_req, res) => {
    res.set('x-route', 'customers:debug');
    res.json({ ok: true, who: 'customers-router' });
  });

  return router;
};
