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

    const first = (first_name ?? '').toString().trim();
    const last = (last_name ?? '').toString().trim();
    const full = (full_name ?? '').toString().trim();
    const fullNameEffective = !full && (first || last) ? `${first} ${last}`.trim() : (full || null);

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
        [
          fullNameEffective,
          first_name,
          last_name,
          phone,
          email,
          note,
          tags,
          ([0,1].includes(is_active) ? is_active : null),
          id,
        ]);
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

  // ---- MARKETING CONSENTS (Gift Vouchers) ---------------------------------
  router.get('/marketing-consents', async (req, res) => {
    try {
      const from = req.query.from ? String(req.query.from) : null; // YYYY-MM-DD
      const to   = req.query.to ? String(req.query.to) : null;
      const status = String(req.query.status || 'all').toLowerCase();

      const conds = [];
      const params = [];
      if (from) { conds.push('DATE(c.created_at) >= DATE(?)'); params.push(from); }
      if (to)   { conds.push('DATE(c.created_at) <= DATE(?)'); params.push(to); }
      if (status === 'opted_in')  conds.push("o.status = 'confirmed'");
      if (status === 'pending')   conds.push("o.status = 'pending'");
      if (status === 'opted_out') conds.push('c.opt_out_at IS NOT NULL');

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await q(
        `SELECT
           c.id AS contact_id,
           c.customer_first,
           c.customer_last,
           c.phone,
           c.email,
           c.city,
           c.birthday,
           c.consent_marketing,
           c.source_tag,
           c.utm_source,
           c.utm_medium,
           c.utm_campaign,
           c.created_at,
           c.opt_out_at,
           c.opt_out_channel,
           v.code AS voucher_code,
           v.value_cents,
           v.valid_until,
           v.status AS voucher_status,
           o.status AS optin_status,
           o.requested_at AS optin_requested_at,
           o.confirmed_at AS optin_confirmed_at
         FROM gift_voucher_contacts c
         LEFT JOIN gift_vouchers v ON v.id = c.voucher_id
         LEFT JOIN gift_voucher_optins o
           ON o.id = (
             SELECT id FROM gift_voucher_optins
             WHERE contact_id = c.id
             ORDER BY requested_at DESC
             LIMIT 1
           )
         ${where}
         ORDER BY c.id DESC
         LIMIT 500`,
        params,
      );

      res.json(rows || []);
    } catch (e) {
      log.error('❌ /api/customers marketing-consents', { error: String(e) });
      res.status(500).json({ ok:false, error: 'marketing_consents_error' });
    }
  });

  // ---- EXPORT CSV ---------------------------------------------------------
  router.get('/marketing-consents/export', async (req, res) => {
    try {
      const from = req.query.from ? String(req.query.from) : null;
      const to   = req.query.to ? String(req.query.to) : null;
      const status = String(req.query.status || 'all').toLowerCase();

      const conds = [];
      const params = [];
      if (from) { conds.push('DATE(c.created_at) >= DATE(?)'); params.push(from); }
      if (to)   { conds.push('DATE(c.created_at) <= DATE(?)'); params.push(to); }
      if (status === 'opted_in')  conds.push("o.status = 'confirmed'");
      if (status === 'pending')   conds.push("o.status = 'pending'");
      if (status === 'opted_out') conds.push('c.opt_out_at IS NOT NULL');

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await q(
        `SELECT
           c.id AS contact_id,
           c.customer_first,
           c.customer_last,
           c.phone,
           c.email,
           c.city,
           c.birthday,
           c.consent_marketing,
           c.source_tag,
           c.utm_source,
           c.utm_medium,
           c.utm_campaign,
           c.created_at,
           c.opt_out_at,
           c.opt_out_channel,
           v.code AS voucher_code,
           v.value_cents,
           v.valid_until,
           v.status AS voucher_status,
           o.status AS optin_status,
           o.requested_at AS optin_requested_at,
           o.confirmed_at AS optin_confirmed_at
         FROM gift_voucher_contacts c
         LEFT JOIN gift_vouchers v ON v.id = c.voucher_id
         LEFT JOIN gift_voucher_optins o
           ON o.id = (
             SELECT id FROM gift_voucher_optins
             WHERE contact_id = c.id
             ORDER BY requested_at DESC
             LIMIT 1
           )
         ${where}
         ORDER BY c.id DESC
         LIMIT 2000`,
        params,
      );

      const esc = (v) => {
        const s = (v == null) ? '' : String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const header = [
        'contact_id','customer_first','customer_last','phone','email','city','birthday',
        'consent_marketing','source_tag','utm_source','utm_medium','utm_campaign','created_at',
        'opt_out_at','opt_out_channel','voucher_code','value_cents','valid_until','voucher_status',
        'optin_status','optin_requested_at','optin_confirmed_at'
      ].join(',');

      const lines = (rows || []).map((r) => ([
        r.contact_id, r.customer_first, r.customer_last, r.phone, r.email, r.city, r.birthday,
        r.consent_marketing, r.source_tag, r.utm_source, r.utm_medium, r.utm_campaign, r.created_at,
        r.opt_out_at, r.opt_out_channel, r.voucher_code, r.value_cents, r.valid_until, r.voucher_status,
        r.optin_status, r.optin_requested_at, r.optin_confirmed_at
      ].map(esc).join(',')));

      const csv = [header, ...lines].join('\n');
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="marketing-consents.csv"');
      res.send(csv);
    } catch (e) {
      log.error('❌ /api/customers marketing-consents export', { error: String(e) });
      res.status(500).json({ ok:false, error: 'marketing_consents_export_error' });
    }
  });

  // 🔧 sanity ping
  router.get('/_debug/ping', (_req, res) => {
    res.set('x-route', 'customers:debug');
    res.json({ ok: true, who: 'customers-router' });
  });

  // -------------------------------------------------------------------------
  // MARKETING CONSENTS (Gift Voucher)
  // GET /api/customers/marketing-consents?from=&to=&status=&q=
  // -------------------------------------------------------------------------
  router.get('/marketing-consents', async (req, res) => {
    try {
      const from = req.query.from ? new Date(String(req.query.from)) : null;
      const to   = req.query.to ? new Date(String(req.query.to)) : null;
      const status = String(req.query.status || 'all').toLowerCase();
      const qRaw = String(req.query.q || '').trim().toLowerCase();

      const conds = [];
      const params = [];

      if (from) { conds.push('c.created_at >= ?'); params.push(from); }
      if (to)   { conds.push('c.created_at <= ?'); params.push(to); }

      if (status === 'pending') {
        conds.push("oi.status = 'pending'");
      } else if (status === 'opted_in') {
        conds.push("oi.status = 'confirmed'");
      } else if (status === 'opted_out') {
        conds.push('c.opt_out_at IS NOT NULL');
      }

      if (qRaw) {
        conds.push(`(
          LOWER(c.customer_first) LIKE ?
          OR LOWER(c.customer_last) LIKE ?
          OR LOWER(c.email) LIKE ?
          OR REPLACE(REPLACE(REPLACE(COALESCE(c.phone,''),' ',''),'+',''),'-','') LIKE ?
        )`);
        const like = `%${qRaw}%`;
        params.push(like, like, like, qRaw.replace(/\s+/g, ''));
      }

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await q(
        `SELECT
           c.id AS contact_id,
           c.customer_first,
           c.customer_last,
           c.phone,
           c.email,
           c.city,
           c.birthday,
           c.consent_marketing,
           c.source_tag,
           c.utm_source,
           c.utm_medium,
           c.utm_campaign,
           c.created_at,
           c.opt_out_at,
           c.opt_out_channel,
           c.voucher_code,
           gv.value_cents,
           gv.valid_until,
           gv.status AS voucher_status,
           oi.status AS optin_status,
           oi.requested_at AS optin_requested_at,
           oi.confirmed_at AS optin_confirmed_at
         FROM gift_voucher_contacts c
         LEFT JOIN gift_vouchers gv ON gv.id = c.voucher_id
         LEFT JOIN (
           SELECT t1.*
           FROM gift_voucher_optins t1
           INNER JOIN (
             SELECT contact_id, MAX(id) AS max_id
             FROM gift_voucher_optins
             GROUP BY contact_id
           ) t2 ON t1.id = t2.max_id
         ) oi ON oi.contact_id = c.id
         ${where}
         ORDER BY c.created_at DESC
         LIMIT 2000`,
        params,
      );

      res.json(rows || []);
    } catch (e) {
      log.error('❌ /api/customers/marketing-consents', { error: String(e) });
      res.status(500).json([]);
    }
  });

  // -------------------------------------------------------------------------
  // MARKETING CONSENTS EXPORT (CSV)
  // GET /api/customers/marketing-consents/export?from=&to=&status=&q=
  // -------------------------------------------------------------------------
  router.get('/marketing-consents/export', async (req, res) => {
    try {
      const from = req.query.from ? new Date(String(req.query.from)) : null;
      const to   = req.query.to ? new Date(String(req.query.to)) : null;
      const status = String(req.query.status || 'all').toLowerCase();
      const qRaw = String(req.query.q || '').trim().toLowerCase();

      const conds = [];
      const params = [];
      if (from) { conds.push('c.created_at >= ?'); params.push(from); }
      if (to)   { conds.push('c.created_at <= ?'); params.push(to); }
      if (status === 'pending') conds.push("oi.status = 'pending'");
      else if (status === 'opted_in') conds.push("oi.status = 'confirmed'");
      else if (status === 'opted_out') conds.push('c.opt_out_at IS NOT NULL');

      if (qRaw) {
        conds.push(`(
          LOWER(c.customer_first) LIKE ?
          OR LOWER(c.customer_last) LIKE ?
          OR LOWER(c.email) LIKE ?
          OR REPLACE(REPLACE(REPLACE(COALESCE(c.phone,''),' ',''),'+',''),'-','') LIKE ?
        )`);
        const like = `%${qRaw}%`;
        params.push(like, like, like, qRaw.replace(/\s+/g, ''));
      }

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await q(
        `SELECT
           c.customer_first,
           c.customer_last,
           c.phone,
           c.email,
           c.city,
           c.birthday,
           c.consent_marketing,
           c.source_tag,
           c.utm_source,
           c.utm_medium,
           c.utm_campaign,
           c.created_at,
           c.opt_out_at,
           c.opt_out_channel,
           c.voucher_code,
           gv.value_cents,
           gv.valid_until,
           gv.status AS voucher_status,
           oi.status AS optin_status,
           oi.requested_at AS optin_requested_at,
           oi.confirmed_at AS optin_confirmed_at
         FROM gift_voucher_contacts c
         LEFT JOIN gift_vouchers gv ON gv.id = c.voucher_id
         LEFT JOIN (
           SELECT t1.*
           FROM gift_voucher_optins t1
           INNER JOIN (
             SELECT contact_id, MAX(id) AS max_id
             FROM gift_voucher_optins
             GROUP BY contact_id
           ) t2 ON t1.id = t2.max_id
         ) oi ON oi.contact_id = c.id
         ${where}
         ORDER BY c.created_at DESC`,
        params,
      );

      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = [
        'customer_first','customer_last','phone','email','city','birthday',
        'consent_marketing','source_tag','utm_source','utm_medium','utm_campaign',
        'created_at','opt_out_at','opt_out_channel',
        'voucher_code','value_cents','valid_until','voucher_status',
        'optin_status','optin_requested_at','optin_confirmed_at'
      ].join(',');
      const lines = (rows || []).map((r) => [
        r.customer_first, r.customer_last, r.phone, r.email, r.city, r.birthday,
        r.consent_marketing, r.source_tag, r.utm_source, r.utm_medium, r.utm_campaign,
        r.created_at, r.opt_out_at, r.opt_out_channel,
        r.voucher_code, r.value_cents, r.valid_until, r.voucher_status,
        r.optin_status, r.optin_requested_at, r.optin_confirmed_at
      ].map(esc).join(','));

      const csv = [header, ...lines].join('\n');
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="marketing-consents.csv"');
      res.send(csv);
    } catch (e) {
      log.error('❌ /api/customers/marketing-consents/export', { error: String(e) });
      res.status(500).send('error');
    }
  });

  return router;
};
