// src/api/fry.js
// ============================================================================
// /api/fry — Ordine al volo antipasti/fritti + Vista cucina live FRY_QUICK
//
// Endpoint pubblici (senza login):
// - GET  /catalog?category=antipasti   → prodotti filtro categoria
// - GET  /context?date=YYYY-MM-DD      → tavoli + prenotazioni giorno
// - POST /quick                        → crea ordine FRY_QUICK
// - GET  /kitchen?status=...           → ordini FRY_QUICK attivi
// - PUT  /kitchen/:id/status            → aggiorna stato (ready/completed)
//
// Sicurezza: se FRY_PUBLIC_KEY valorizzata → richiede header x-fry-key o ?k=...
// Stile: commenti lunghi ITA, log emoji 🍟 ✅ ❌ ⚠️
// ============================================================================

'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../logger');
const { query } = require('../db');
const productSvc = require('../services/product.service');

// === Moduli opzionali: Socket.IO, getOrderFullById ========================
let socketBus = { broadcastCreated: () => {}, broadcastUpdated: () => {} };
let getOrderFullById = null;
try {
  const s = require('../sockets/orders');
  if (s?.broadcastOrderCreated) socketBus.broadcastCreated = s.broadcastOrderCreated;
  if (s?.broadcastOrderUpdated) socketBus.broadcastUpdated = s.broadcastOrderUpdated;
} catch (e) {
  logger.warn('🍟 [fry] sockets non disponibili', { error: String((e && e.message) || e) });
}
try {
  const ordersApi = require('./orders');
  // getOrderFullById non è esportato: usiamo query diretta per kitchen
} catch (e) {
  logger.warn('🍟 [fry] orders non disponibile', { error: String((e && e.message) || e) });
}

// ============================================================================
// 🍟🔐 Middleware FRY_PUBLIC_KEY — valida x-fry-key o ?k=
// ============================================================================
function fryKeyMiddleware(req, res, next) {
  const key = (process.env.FRY_PUBLIC_KEY || '').toString().trim();
  if (!key) {
    logger.debug('🍟 [fry] FRY_PUBLIC_KEY non valorizzata → accesso aperto (dev)');
    return next();
  }

  const headerKey = (req.headers['x-fry-key'] || '').toString().trim();
  const queryKey = (req.query.k || req.query.key || '').toString().trim();
  const provided = headerKey || queryKey;

  if (!provided || provided !== key) {
    logger.warn('🍟🔐 [fry] chiave mancante o non valida', {
      hasHeader: !!headerKey,
      hasQuery: !!queryKey,
    });
    return res.status(403).json({ ok: false, error: 'fry_key_required' });
  }

  logger.debug('🍟🔐 [fry] chiave validata OK');
  next();
}

router.use(fryKeyMiddleware);

// ============================================================================
// Helper: toNum, toDate
// ============================================================================
const toNum = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const toDate = (v) => (v ? new Date(v) : null);

// ============================================================================
// GET /api/fry/catalog?category=antipasti
// Prodotti attivi filtrati per categoria (default antipasti)
// ============================================================================
router.get('/catalog', async (req, res) => {
  try {
    const category = String(req.query.category || 'antipasti').trim() || 'antipasti';
    logger.info('🍟 [fry] GET /catalog', { category });

    const rows = await productSvc.getAll({ active: true, category });
    res.json(rows || []);
  } catch (e) {
    logger.error('🍟 [fry] catalog ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'catalog_error' });
  }
});

// ============================================================================
// GET /api/fry/context?date=YYYY-MM-DD
// Tavoli + prenotazioni del giorno (per modal tavolo-first)
// ============================================================================
router.get('/context', async (req, res) => {
  try {
    const dateRaw = req.query.date || new Date().toISOString().slice(0, 10);
    const dateStr = String(dateRaw).slice(0, 10);
    logger.info('🍟 [fry] GET /context', { date: dateStr });

    const tables = await query(
      `SELECT t.id, t.room_id, t.table_number,
              COALESCE(NULLIF(t.table_number, ''), CONCAT('T', t.id)) AS table_name,
              rm.id AS room_id,
              rm.name AS room_name
       FROM tables t
       LEFT JOIN rooms rm ON rm.id = t.room_id
       WHERE (rm.is_active IS NULL OR rm.is_active = 1)
       ORDER BY rm.sort_order, rm.name, t.table_number, t.id`,
      [],
    );

    const fromSql = `${dateStr} 00:00:00`;
    const toSql = `${dateStr} 23:59:59`;

    const reservations = await query(
      `SELECT r.id, r.customer_first, r.customer_last,
              DATE_FORMAT(r.start_at, '%Y-%m-%d %H:%i:%s') AS start_at,
              r.status, r.table_id
       FROM reservations r
       WHERE r.start_at >= ? AND r.start_at <= ?
       ORDER BY r.start_at ASC, r.id ASC`,
      [fromSql, toSql],
    );

    let frySkipTables = false;
    try {
      const settingsRows = await query(
        'SELECT fry_skip_tables_section FROM public_asporto_settings ORDER BY id ASC LIMIT 1',
        [],
      );
      frySkipTables = settingsRows?.[0] ? !!Number(settingsRows[0].fry_skip_tables_section) : false;
    } catch (e) {
      logger.warn('🍟 [fry] fry_skip_tables_section load KO (default false)', { error: String(e) });
    }

    res.json({
      tables: tables || [],
      reservations: reservations || [],
      fry_skip_tables_section: frySkipTables,
    });
  } catch (e) {
    logger.error('🍟 [fry] context ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'context_error' });
  }
});

// ============================================================================
// POST /api/fry/quick
// Crea ordine FRY_QUICK con reservation (walk-in o link a prenotazione)
// ============================================================================
router.post('/quick', async (req, res) => {
  const dto = req.body || {};
  try {
    const items = Array.isArray(dto.items) ? dto.items : [];
    const tableId = toNum(dto.table_id, 0);
    const mode = String(dto.mode || 'walkin').toLowerCase();
    const reservationId = toNum(dto.reservation_id, 0);
    const walkin = dto.walkin || {};

    if (!tableId) {
      return res.status(400).json({ ok: false, error: 'table_id_required' });
    }

    const normalizedItems = [];
    for (const it of items) {
      const pid = toNum(it.product_id, 0);
      const qty = toNum(it.qty, 0);
      if (!pid || qty <= 0) continue;

      const prod = await productSvc.getById(pid);
      if (!prod) continue;

      normalizedItems.push({
        product_id: pid,
        name: prod.name,
        price: Number(prod.price || 0),
        qty,
      });
    }

    if (!normalizedItems.length) {
      return res.status(400).json({ ok: false, error: 'no_valid_items' });
    }

    const total = normalizedItems.reduce((acc, it) => acc + it.price * it.qty, 0);
    let resvId = null;
    let customerFirst = 'Walk-in';
    let customerLast = '';

    if (mode === 'reservation' && reservationId) {
      const resvRows = await query(
        'SELECT id, customer_first, customer_last, table_id FROM reservations WHERE id = ? LIMIT 1',
        [reservationId],
      );
      const resv = resvRows && resvRows[0];
      if (resv) {
        resvId = resv.id;
        customerFirst = (resv.customer_first || '').toString().trim() || 'Cliente';
        customerLast = (resv.customer_last || '').toString().trim();

        if (!resv.table_id && tableId) {
          try {
            const resvSvc = require('../services/reservations.service');
            if (resvSvc.assignReservationTable) {
              await resvSvc.assignReservationTable(resvId, tableId, { user: null });
              logger.info('🍟 [fry] reservation table assigned', { resvId, tableId });
            }
          } catch (e) {
            logger.warn('🍟 [fry] assignReservationTable KO (best-effort)', { error: String(e) });
          }
        }
      }
    } else {
      customerFirst = (walkin.customer_first || '').toString().trim() || 'Walk-in';
      customerLast = (walkin.customer_last || '').toString().trim();
      const partySize = toNum(walkin.party_size, 1);
      const now = new Date();
      const startMysql = now.toISOString().slice(0, 19).replace('T', ' ');
      const endDate = new Date(now.getTime() + 90 * 60 * 1000);
      const endMysql = endDate.toISOString().slice(0, 19).replace('T', ' ');

      const insRes = await query(
        `INSERT INTO reservations
          (customer_first, customer_last, phone, email, party_size, start_at, end_at, notes, status, table_id)
         VALUES (?, ?, NULL, NULL, ?, ?, ?, 'Walk-in fritti al volo', 'pending', ?)`,
        [customerFirst, customerLast, partySize, startMysql, endMysql, tableId],
      );
      resvId = insRes.insertId;
      logger.info('🍟 [fry] walk-in reservation created', { id: resvId, table_id: tableId });
    }

    const custName = [customerFirst, customerLast].filter(Boolean).join(' ').trim() || 'Cliente';

    const ordRes = await query(
      `INSERT INTO orders
        (customer_name, phone, email, people, fulfillment, table_id, reservation_id, channel, order_type, status, total)
       VALUES (?, NULL, NULL, 1, 'table', ?, ?, 'fry', 'FRY_QUICK', 'pending', ?)`,
      [custName, tableId, resvId, total],
    );
    const orderId = ordRes.insertId;

    for (const it of normalizedItems) {
      await query(
        `INSERT INTO order_items (order_id, product_id, name, qty, price, notes, extra_total)
         VALUES (?, ?, ?, ?, ?, NULL, 0)`,
        [orderId, it.product_id, it.name, it.qty, it.price],
      );
    }

    const fullOrder = await getFryOrderFull(orderId);

    try {
      socketBus.broadcastCreated(fullOrder);
    } catch (e) {
      logger.warn('🍟 [fry] socket broadcastCreated KO', { error: String(e) });
    }

    logger.info('🍟 [fry] quick order created ✅', {
      order_id: orderId,
      table_id: tableId,
      reservation_id: resvId,
      items: normalizedItems.length,
    });

    res.status(201).json(fullOrder);
  } catch (e) {
    logger.error('🍟 [fry] quick ❌', { error: String(e), dto });
    res.status(500).json({ ok: false, error: 'quick_order_error' });
  }
});

// ============================================================================
// Helper: getFryOrderFull — ordine completo per kitchen/view
// ============================================================================
async function getFryOrderFull(orderId) {
  const ordRows = await query(
    `SELECT o.id, o.customer_name, o.status, o.total, o.table_id, o.reservation_id, o.order_type,
            t.table_number,
            COALESCE(NULLIF(t.table_number, ''), CONCAT('T', t.id)) AS table_name,
            rm.name AS room_name,
            r.customer_first, r.customer_last
     FROM orders o
     LEFT JOIN tables t ON t.id = o.table_id
     LEFT JOIN rooms rm ON rm.id = t.room_id
     LEFT JOIN reservations r ON r.id = o.reservation_id
     WHERE o.id = ? LIMIT 1`,
    [orderId],
  );
  const o = ordRows && ordRows[0];
  if (!o) return null;

  const items = await query(
    `SELECT i.id, i.product_id, i.name, i.qty, i.price
     FROM order_items i
     WHERE i.order_id = ?
     ORDER BY i.id ASC`,
    [orderId],
  );

  const custFirst = o.customer_first || (o.customer_name || '').split(' ')[0] || '';
  const custLast = o.customer_last || (o.customer_name || '').split(' ').slice(1).join(' ') || '';

  return {
    ...o,
    table_number: o.table_number,
    table_name: o.table_name || `Tavolo ${o.table_number || o.table_id}`,
    room_name: o.room_name,
    customer_first: custFirst,
    customer_last: custLast,
    items: items || [],
  };
}

// ============================================================================
// GET /api/fry/kitchen?status=...
// Lista ordini FRY_QUICK attivi (esclusi completed/cancelled)
// ============================================================================
router.get('/kitchen', async (req, res) => {
  try {
    const statusFilter = (req.query.status || '').toString().trim().toLowerCase();
    logger.info('🍟 [fry] GET /kitchen', { status: statusFilter || 'all' });

    const conds = ["o.order_type = 'FRY_QUICK'"];
    const params = [];

    if (statusFilter && statusFilter !== 'all') {
      conds.push('o.status = ?');
      params.push(statusFilter);
    } else {
      conds.push("o.status NOT IN ('completed', 'cancelled')");
    }

    const rows = await query(
      `SELECT o.id, o.customer_name, o.status, o.total, o.table_id, o.reservation_id, o.created_at,
              t.table_number,
              COALESCE(NULLIF(t.table_number, ''), CONCAT('T', t.id)) AS table_name,
              rm.name AS room_name,
              r.customer_first, r.customer_last
       FROM orders o
       LEFT JOIN tables t ON t.id = o.table_id
       LEFT JOIN rooms rm ON rm.id = t.room_id
       LEFT JOIN reservations r ON r.id = o.reservation_id
       WHERE ${conds.join(' AND ')}
       ORDER BY o.id ASC
       LIMIT 100`,
      params,
    );

    const result = [];
    for (const r of rows || []) {
      const full = await getFryOrderFull(r.id);
      if (full) result.push(full);
    }

    res.json(result);
  } catch (e) {
    logger.error('🍟 [fry] kitchen list ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'kitchen_list_error' });
  }
});

// ============================================================================
// PUT /api/fry/kitchen/:id/status
// Aggiorna stato ordine (ready, completed, ecc.)
// ============================================================================
router.put('/kitchen/:id(\\d+)/status', async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const status = String((req.body && req.body.status) || '').toLowerCase();
    const allowed = new Set(['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled']);
    if (!allowed.has(status)) {
      return res.status(400).json({ ok: false, error: 'invalid_status' });
    }

    const check = await query(
      'SELECT id, order_type FROM orders WHERE id = ? LIMIT 1',
      [id],
    );
    const ord = check && check[0];
    if (!ord) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    if (ord.order_type !== 'FRY_QUICK') {
      return res.status(400).json({ ok: false, error: 'not_fry_order' });
    }

    await query(
      `UPDATE orders SET status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
      [status, id],
    );

    const full = await getFryOrderFull(id);

    try {
      socketBus.broadcastUpdated({ ...full, order_type: 'FRY_QUICK' });
    } catch (e) {
      logger.warn('🍟 [fry] socket broadcastUpdated KO', { error: String(e) });
    }

    logger.info('🍟 [fry] status updated ✅', { id, status });

    res.json(full);
  } catch (e) {
    logger.error('🍟 [fry] kitchen status ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'status_update_error' });
  }
});

module.exports = router;
