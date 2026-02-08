// src/api/reports.js
// ============================================================================
// Report aggregati per Dashboard Admin - POS.
// GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// GET /api/reports/order-categories?from=...&to=... (opzionale)
// Nessun mock: dati reali da orders e reservations.
// Stile: commenti lunghi ITA, log emoji.
// ============================================================================

'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../db');
const logger = require('../logger');

const APP_TZ = process.env.APP_TZ || process.env.BIZ_TZ || 'Europe/Rome';

// Helper: range from/to → from 00:00:00 e to 23:59:59 (locale)
function toDayRange(fromYmd, toYmd) {
  const out = { from: null, to: null };
  if (fromYmd) out.from = `${String(fromYmd).slice(0, 10)} 00:00:00`;
  if (toYmd) out.to = `${String(toYmd).slice(0, 10)} 23:59:59`;
  return out;
}

// Helper: oggi in Europe/Rome (YYYY-MM-DD) per KPI "oggi"
function todayYmd() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()).replace(/-/g, '-');
}

// ============================================================================
// GET /api/reports/summary
// ============================================================================
router.get('/summary', async (req, res) => {
  const fromYmd = req.query.from || null;
  const toYmd = req.query.to || null;
  const range = toDayRange(fromYmd, toYmd);
  const today = todayYmd();

  logger.info('📊 [GET] /api/reports/summary', { from: fromYmd, to: toYmd, today });

  try {
    const todayRange = toDayRange(today, today);

    // --- Ordini: range + oggi ---
    const orderConds = [];
    const orderParams = [];
    if (range.from) {
      orderConds.push('o.created_at >= ?');
      orderParams.push(range.from);
    }
    if (range.to) {
      orderConds.push('o.created_at <= ?');
      orderParams.push(range.to);
    }
    const orderWhere = orderConds.length ? 'WHERE ' + orderConds.join(' AND ') : '';

    // Query aggregati ordini (range)
    const ordersAgg = await query(
      `SELECT
         COUNT(*) AS orders_count,
         IFNULL(SUM(o.total), 0) AS revenue_total,
         SUM(CASE WHEN LOWER(COALESCE(o.fulfillment, '')) IN ('takeaway','asporto','take-away') THEN 1 ELSE 0 END) AS orders_takeaway,
         SUM(CASE WHEN LOWER(COALESCE(o.fulfillment, '')) IN ('delivery','domicilio') THEN 1 ELSE 0 END) AS orders_delivery
       FROM orders o
       ${orderWhere}`,
      orderParams
    );

    const r = ordersAgg && ordersAgg[0] ? ordersAgg[0] : {};
    const orders_count = Number(r.orders_count || 0);
    const revenue_total_range = Number(r.revenue_total || 0);
    const orders_takeaway = Number(r.orders_takeaway || 0);
    const orders_delivery = Number(r.orders_delivery || 0);

    // Ordini oggi + incasso oggi
    const todayOrderConds = ['o.created_at >= ?', 'o.created_at <= ?'];
    const todayOrderParams = [todayRange.from, todayRange.to];
    const todayOrders = await query(
      `SELECT COUNT(*) AS n, IFNULL(SUM(o.total), 0) AS revenue
       FROM orders o
       WHERE ${todayOrderConds.join(' AND ')}`,
      todayOrderParams
    );
    const to = todayOrders && todayOrders[0] ? todayOrders[0] : {};
    const orders_today = Number(to.n || 0);
    const revenue_today = Number(to.revenue || 0);

    // --- Prenotazioni: range + oggi ---
    const resvConds = [];
    const resvParams = [];
    if (range.from) {
      resvConds.push('r.start_at >= ?');
      resvParams.push(range.from);
    }
    if (range.to) {
      resvConds.push('r.start_at <= ?');
      resvParams.push(range.to);
    }
    const resvWhere = resvConds.length ? 'WHERE ' + resvConds.join(' AND ') : '';

    const resvAgg = await query(
      `SELECT
         COUNT(*) AS reservations_count,
         SUM(CASE WHEN LOWER(r.status) = 'pending' THEN 1 ELSE 0 END) AS reservations_pending,
         SUM(CASE WHEN LOWER(r.status) = 'accepted' THEN 1 ELSE 0 END) AS reservations_confirmed
       FROM reservations r
       ${resvWhere}`,
      resvParams
    );

    const rv = resvAgg && resvAgg[0] ? resvAgg[0] : {};
    const reservations_count = Number(rv.reservations_count || 0);
    const reservations_pending = Number(rv.reservations_pending || 0);
    const reservations_confirmed = Number(rv.reservations_confirmed || 0);

    // Prenotazioni oggi
    const todayResv = await query(
      `SELECT COUNT(*) AS n FROM reservations r
       WHERE r.start_at >= ? AND r.start_at <= ?`,
      [todayRange.from, todayRange.to]
    );
    const reservations_today = Number((todayResv && todayResv[0] ? todayResv[0] : {}).n || 0);

    // --- Timeseries: incasso_per_day, orders_per_day, reservations_per_day ---
    const tsOrderConds = [];
    const tsOrderParams = [];
    if (range.from) {
      tsOrderConds.push('o.created_at >= ?');
      tsOrderParams.push(range.from);
    }
    if (range.to) {
      tsOrderConds.push('o.created_at <= ?');
      tsOrderParams.push(range.to);
    }
    const tsOrderWhere = tsOrderConds.length ? 'WHERE ' + tsOrderConds.join(' AND ') : '';

    const incassoPerDay = await query(
      `SELECT DATE(o.created_at) AS day, IFNULL(SUM(o.total), 0) AS revenue
       FROM orders o
       ${tsOrderWhere}
       GROUP BY DATE(o.created_at)
       ORDER BY day ASC`,
      tsOrderParams
    );

    const ordersPerDay = await query(
      `SELECT DATE(o.created_at) AS day, COUNT(*) AS count
       FROM orders o
       ${tsOrderWhere}
       GROUP BY DATE(o.created_at)
       ORDER BY day ASC`,
      tsOrderParams
    );

    const resvTsWhere = resvConds.length ? 'WHERE ' + resvConds.join(' AND ') : '';
    const reservationsPerDay = await query(
      `SELECT DATE(r.start_at) AS day, COUNT(*) AS count
       FROM reservations r
       ${resvTsWhere}
       GROUP BY DATE(r.start_at)
       ORDER BY day ASC`,
      resvParams
    );

    // order_type_counts per grafico pie
    const orderTypeRows = await query(
      `SELECT
         COALESCE(LOWER(NULLIF(TRIM(o.fulfillment), '')), 'table') AS type,
         COUNT(*) AS count
       FROM orders o
       ${tsOrderWhere}
       GROUP BY type`,
      tsOrderParams
    );

    const order_type_counts = {};
    for (const row of orderTypeRows || []) {
      const t = String(row.type || 'table').toLowerCase();
      const label = t === 'takeaway' || t === 'asporto' ? 'Take Away' : t === 'delivery' ? 'Delivery' : 'Tavolo';
      order_type_counts[label] = Number(row.count || 0);
    }

    const result = {
      totals: {
        orders_count,
        orders_takeaway,
        orders_delivery,
        orders_today,
        revenue_today,
        revenue_total_range,
        reservations_count,
        reservations_pending,
        reservations_confirmed,
        reservations_today,
      },
      timeseries: {
        incasso_per_day: (incassoPerDay || []).map((r) => ({
          day: r.day ? String(r.day).slice(0, 10) : null,
          revenue: Number(r.revenue || 0),
        })),
        orders_per_day: (ordersPerDay || []).map((r) => ({
          day: r.day ? String(r.day).slice(0, 10) : null,
          count: Number(r.count || 0),
        })),
        reservations_per_day: (reservationsPerDay || []).map((r) => ({
          day: r.day ? String(r.day).slice(0, 10) : null,
          count: Number(r.count || 0),
        })),
      },
      breakdown: {
        order_type_counts,
      },
    };

    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    logger.error('📊 reports/summary ❌', { error: String(err) });
    res.status(500).json({ ok: false, error: 'reports_summary_error' });
  }
});

// ============================================================================
// GET /api/reports/order-categories (solo se categorie disponibili in 1 query)
// order_items → products → categories
// ============================================================================
router.get('/order-categories', async (req, res) => {
  const fromYmd = req.query.from || null;
  const toYmd = req.query.to || null;
  const range = toDayRange(fromYmd, toYmd);

  logger.info('📊 [GET] /api/reports/order-categories', { from: fromYmd, to: toYmd });

  try {
    const conds = [];
    const params = [];
    if (range.from) {
      conds.push('o.created_at >= ?');
      params.push(range.from);
    }
    if (range.to) {
      conds.push('o.created_at <= ?');
      params.push(range.to);
    }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const rows = await query(
      `SELECT COALESCE(c.name, 'Altro') AS category, COUNT(*) AS count
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
       LEFT JOIN products p ON p.id = i.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       ${where}
       GROUP BY COALESCE(c.name, 'Altro')
       ORDER BY count DESC`,
      params
    );

    const categories = (rows || []).map((r) => ({
      label: String(r.category || 'Altro'),
      count: Number(r.count || 0),
    }));

    res.set('Cache-Control', 'no-store');
    res.json({ categories });
  } catch (err) {
    logger.error('📊 reports/order-categories ❌', { error: String(err) });
    res.status(500).json({ ok: false, error: 'reports_categories_error' });
  }
});

module.exports = router;
