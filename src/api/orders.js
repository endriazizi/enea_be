// ============================================================================
// ORDERS API (root = /api/orders)
// - GET    /                lista (hours | from/to | status | q)
// - GET    /:id(\d+)        dettaglio full con items (+ meta sala/tavolo ⚙️)
// - POST   /                crea ordine (header + items) → 201 + full
// - PATCH  /:id(\d+)/status cambio stato
// - POST   /:id(\d+)/print               stampa CONTO (DUAL Pizzeria/Cucina)
// - POST   /:id(\d+)/print/comanda       🆕 stampa SOLO un centro (PIZZERIA|CUCINA)
// - GET    /stream          SSE (montato qui)
// Stile: commenti lunghi, log con emoji
// ============================================================================
'use strict';

const express = require('express');
const router  = express.Router();
const logger  = require('../logger');
const { query } = require('../db');
const sse     = require('../sse');
const { printOrderDual, printOrderForCenter } = require('../utils/print-order'); // 🧾

// === INIZIO MODIFICA: risoluzione cliente da email/phone ====================
const resolveCustomerUserId = require('../utils/customers.resolve');
// === FINE MODIFICA ==========================================================

// Monta subito l’endpoint SSE (/api/orders/stream)
sse.mount(router);

// Helpers ---------------------------------------------------------------------
const toNum = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const toDate = (v) => v ? new Date(v) : null;

// 🧠 Util: parsing rapido da eventuali note "Tavolo X — Sala Y"
function parseLocationHintsFromNote(noteRaw) {
  const note = (noteRaw || '').toString();
  const mT = note.match(/Tavolo\s+([A-Za-z0-9\-_]+)/i);
  const mR = note.match(/Sala\s+([A-Za-z0-9 \-_]+)/i);
  return {
    table_hint: mT ? mT[1] : null,
    room_hint : mR ? mR[1] : null,
  };
}

/**
 * 🔍 Risolve meta "location" per la stampa:
 * - tenta un match con la prenotazione del GIORNO di `scheduled_at`
 * - ordina per vicinanza temporale a `scheduled_at` (± minuti)
 * - JOIN su `tables` (usa SOLO colonne esistenti: id, table_number) e `rooms` (name)
 *
 * Non richiede colonne extra su `orders`.
 */
async function resolveLocationMeta(order) {
  if (!order?.scheduled_at) return { reservation: null, table: null, room: null };

  const hints = parseLocationHintsFromNote(order.note);

  // ⚠️ FIX: t.number/t.label non esistono → uso table_number/table_name
  const rows = await query(
    `SELECT r.id,
            r.table_id, r.room_id,
            t.table_number                         AS table_number,
            COALESCE(NULLIF(t.table_number,''), CONCAT('T', t.id)) AS table_name,
            rm.name                                AS room_name,
            ABS(TIMESTAMPDIFF(MINUTE, r.start_at, ?)) AS delta_min
     FROM reservations r
     LEFT JOIN tables t ON t.id = r.table_id
     LEFT JOIN rooms  rm ON rm.id = r.room_id
     WHERE DATE(r.start_at) = DATE(?)
       AND r.table_id IS NOT NULL
     ORDER BY delta_min ASC, r.id DESC
     LIMIT 1`,
    [ order.scheduled_at, order.scheduled_at ]
  );

  const best = rows && rows[0] ? rows[0] : null;

  logger.info('🧭 orders.resolveLocationMeta', {
    id: order.id,
    hasScheduled: !!order.scheduled_at,
    table_hint: hints.table_hint || null,
    room_hint : hints.room_hint  || null,
    match_id  : best?.id || null,
    match_delta_min: best?.delta_min ?? null,
    table_id  : best?.table_id ?? null,
    table_num : best?.table_number ?? null,
    table_lbl : best?.table_name ?? null,
    room_id   : best?.room_id ?? null,
    room_name : best?.room_name ?? null,
  });

  const reservation = best ? { id: best.id, table_id: best.table_id, room_id: best.room_id } : null;
  const table = best ? { id: best.table_id, number: best.table_number, label: best.table_name } : null;
  const room  = best ? { id: best.room_id, name: best.room_name } : null;

  return { reservation, table, room };
}

async function getOrderFullById(id) {
  // Header base (come prima)
  const [o] = await query(
    `SELECT id, customer_name, phone, email, people, scheduled_at, status,
            total, channel, note, created_at, updated_at
     FROM orders WHERE id=?`, [id]
  );
  if (!o) return null;

  // Righe con categoria risolta
  const items = await query(
    `SELECT i.id, i.order_id, i.product_id, i.name, i.qty, i.price, i.notes, i.created_at,
            COALESCE(c.name,'Altro') AS category
     FROM order_items i
     LEFT JOIN products   p ON p.id = i.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE i.order_id=?
     ORDER BY i.id ASC`, [id]
  );

  // 🆕 Arricchisco con meta SALA/TAVOLO inferita dal calendario prenotazioni
  const meta = await resolveLocationMeta(o);

  return {
    ...o,
    table_id:      meta.table?.id ?? null,
    table_number:  meta.table?.number ?? null,
    table_name:    meta.table?.label ?? null,
    room_id:       meta.room?.id ?? null,
    room_name:     meta.room?.name ?? null,
    reservation: meta.reservation ? {
      id: meta.reservation.id,
      table_id: meta.reservation.table_id,
      room_id : meta.reservation.room_id,
      table: meta.table,
      room : meta.room,
    } : null,
    items
  };
}

// ROUTES ----------------------------------------------------------------------

// Lista
router.get('/', async (req, res) => {
  try {
    const { hours, from, to, status, q } = req.query;
    const conds = [];
    const params = [];

    if (hours) { conds.push(`created_at >= (UTC_TIMESTAMP() - INTERVAL ? HOUR)`); params.push(toNum(hours)); }
    if (from)  { conds.push(`created_at >= ?`); params.push(new Date(from)); }
    if (to)    { conds.push(`created_at <= ?`); params.push(new Date(to)); }
    if (status && status !== 'all') { conds.push(`status = ?`); params.push(status); }
    if (q)     { conds.push(`(customer_name LIKE ? OR phone LIKE ?)`); params.push(`%${q}%`, `%${q}%`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await query(
      `SELECT id, customer_name, phone, email, people, scheduled_at, status,
              total, channel, note, created_at, updated_at
       FROM orders
       ${where}
       ORDER BY id DESC
       LIMIT 300`, params
    );
    res.json(rows);
  } catch (e) {
    logger.error('📄 orders list ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_list_error' });
  }
});

// Dettaglio
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const full = await getOrderFullById(id);
    if (!full) return res.status(404).json({ error: 'not_found' });
    res.json(full);
  } catch (e) {
    logger.error('📄 orders get ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_get_error' });
  }
});

// Crea
router.post('/', async (req, res) => {
  const dto = req.body || {};
  try {
    const scheduled = dto.scheduled_at ? toDate(dto.scheduled_at) : null;
    const items = Array.isArray(dto.items) ? dto.items : [];

    // Totale ricalcolato lato server
    const total = items.reduce((acc, it) => acc + toNum(it.price) * toNum(it.qty, 1), 0);

    // === INIZIO MODIFICA: risolvo customer_user_id ==========================
    const email = (dto.email ?? dto.customer?.email ?? null);
    const phone = (dto.phone ?? dto.customer?.phone ?? null);
    let customer_user_id = null;
    try {
      // qui passo un "db" che implementa .query → uso il wrapper { query }
      customer_user_id = await resolveCustomerUserId({ query }, { email, phone });
      logger.info('🧩 [Orders] mapped customer_user_id = %s', customer_user_id, { email, phone });
    } catch (e) {
      logger.warn('⚠️ [Orders] resolveCustomerUserId KO: %s', String(e?.message || e));
    }
    // === FINE MODIFICA ======================================================

    const r = await query(
      `INSERT INTO orders (customer_name, phone, email, people, scheduled_at, note, channel, status, total, customer_user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        (dto.customer_name || 'Cliente').toString().trim(),
        dto.phone || null,
        dto.email || null,
        dto.people || null,
        scheduled,
        dto.note || null,
        dto.channel || 'admin',
        'pending',
        total,
        customer_user_id
      ]
    );
    const orderId = r.insertId;

    for (const it of items) {
      await query(
        `INSERT INTO order_items (order_id, product_id, name, qty, price, notes)
         VALUES (?,?,?,?,?,?)`,
        [ orderId, (it.product_id ?? null), it.name, toNum(it.qty,1), toNum(it.price), (it.notes ?? null) ]
      );
    }

    const full = await getOrderFullById(orderId);
    try { sse.emitCreated(full); } catch (e) { logger.warn('🧵 SSE created ⚠️', { e: String(e) }); }

    res.status(201).json(full);
  } catch (e) {
    logger.error('🆕 orders create ❌', { service: 'server', reason: String(e) });
    res.status(500).json({ ok: false, error: 'orders_create_error', reason: String(e) });
  }
});

// Cambio stato
router.patch('/:id(\\d+)/status', async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const status = String(req.body?.status || '').toLowerCase();
    const allowed = new Set(['pending','confirmed','preparing','ready','completed','cancelled']);
    if (!allowed.has(status)) return res.status(400).json({ error: 'invalid_status' });

    await query(`UPDATE orders SET status=?, updated_at=UTC_TIMESTAMP() WHERE id=?`, [status, id]);

    const full = await getOrderFullById(id);
    try { sse.emitStatus({ id, status }); } catch (e) { logger.warn('🧵 SSE status ⚠️', { e: String(e) }); }

    res.json(full);
  } catch (e) {
    logger.error('✏️ orders status ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_status_error' });
  }
});

// Stampa (best-effort) — CONTO / DUAL
router.post('/:id(\\d+)/print', async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const full = await getOrderFullById(id);
    if (!full) return res.status(404).json({ ok: false, error: 'not_found' });

    try {
      await printOrderDual(full);
      return res.json({ ok: true });
    } catch (e) {
      logger.warn('🖨️ orders print ⚠️', { id, error: String(e) });
      return res.status(502).json({ ok: false, error: 'printer_error', reason: String(e) });
    }
  } catch (e) {
    logger.error('🖨️ orders print ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_print_error' });
  }
});

// 🆕 Stampa COMANDA SOLO per un centro (PIZZERIA | CUCINA)
router.post('/:id(\\d+)/print/comanda', async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const full = await getOrderFullById(id);
    if (!full) return res.status(404).json({ ok: false, error: 'not_found' });

    const centerRaw = (req.body?.center || req.query?.center || 'pizzeria').toString().toUpperCase();
    const center = centerRaw === 'CUCINA' ? 'CUCINA' : 'PIZZERIA';
    const copies = Math.max(1, toNum(req.body?.copies || req.query?.copies, 1));

    try {
      for (let i = 0; i < copies; i++) {
        await printOrderForCenter(full, center);
      }
      logger.info('🧾 comanda OK', { id, center, copies });
      return res.json({ ok: true, center, copies });
    } catch (e) {
      logger.warn('🧾 comanda ⚠️', { id, center, error: String(e) });
      return res.status(502).json({ ok: false, error: 'printer_error', reason: String(e) });
    }
  } catch (e) {
    logger.error('🧾 comanda ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_comanda_error' });
  }
});

module.exports = router;
