// src/api/orders.js
// ============================================================================
// /api/orders — gestione ordini (lista, dettaglio, creazione, stato, stampa)
//
// Allineato con:
// - OrderBuilderPage (creazione ordini da tavolo + prenotazione)
// - TablesListPage (preview ordini per tavolo + stampa conto/comanda)
//
// Caratteristiche principali:
// - LIST: filtro per hours/from/to/status/q/table_id
//   - se passi ?table_id=XX ⇒ restituisce ordini "full" con righe e meta tavolo/sala
// - GET /:id     ⇒ dettaglio ordine completo (righe + meta tavolo/sala/prenotazione)
// - POST /       ⇒ crea ordine, ricalcola totale lato server, valorizza table_id
// - PATCH /:id/status ⇒ cambio stato semplice (pending/confirmed/preparing/...)
// - POST /:id/print           ⇒ stampa CONTO (printOrderDual, best-effort)
// - POST /:id/print/comanda   ⇒ stampa comanda PIZZERIA/CUCINA
// - POST /:id/print-comanda   ⇒ alias compat
//
// Tutte le integrazioni extra (SSE, Socket.IO, stampa, customers.resolve) sono
// opzionali: se i moduli non ci sono, logghiamo un warning e continuiamo.
// ============================================================================

'use strict';

const express = require('express');
const router  = express.Router();

const logger = require('../logger');
const { query } = require('../db');

// ============================================================================
// Moduli opzionali: SSE, Socket.IO, stampa, customers.resolve
// ============================================================================

// SSE (best-effort)
let sse = {
  mount      : () => {},
  emitCreated: () => {},
  emitStatus : () => {},
};
try {
  const mod = require('../sse');
  if (mod && typeof mod === 'object') {
    if (typeof mod.mount === 'function')       sse.mount       = mod.mount;
    if (typeof mod.emitCreated === 'function') sse.emitCreated = mod.emitCreated;
    if (typeof mod.emitStatus === 'function')  sse.emitStatus  = mod.emitStatus;
  }
} catch (e) {
  logger.warn('ℹ️ [orders] SSE non disponibile (../sse mancante o non valido)', {
    error: String(e && e.message || e),
  });
}

// Socket.IO broadcast (best-effort)
let socketBus = {
  broadcastCreated: () => {},
  broadcastUpdated: () => {},
};
try {
  const s = require('../sockets/orders');
  if (s && typeof s === 'object') {
    if (typeof s.broadcastOrderCreated === 'function') {
      socketBus.broadcastCreated = s.broadcastOrderCreated;
    }
    if (typeof s.broadcastOrderUpdated === 'function') {
      socketBus.broadcastUpdated = s.broadcastOrderUpdated;
    }
  }
} catch (e) {
  logger.warn('ℹ️ [orders] sockets non disponibili (../sockets/orders)', {
    error: String(e && e.message || e),
  });
}

// Stampa (best-effort)
let printOrderDual = async (order) => {
  logger.info('🖨️ [orders] printOrderDual stub (nessun modulo ../utils/print-order)', {
    id: order && order.id,
  });
};
let printOrderForCenter = async (order, center) => {
  logger.info('🧾 [orders] printOrderForCenter stub (nessun modulo ../utils/print-order)', {
    id    : order && order.id,
    center: center,
  });
};
try {
  const p = require('../utils/print-order');
  if (p && typeof p === 'object') {
    if (typeof p.printOrderDual === 'function') {
      printOrderDual = p.printOrderDual;
    }
    if (typeof p.printOrderForCenter === 'function') {
      printOrderForCenter = p.printOrderForCenter;
    }
  }
} catch (e) {
  logger.warn('ℹ️ [orders] print-order non disponibile (../utils/print-order mancante o non valido)', {
    error: String(e && e.message || e),
  });
}

// customers.resolve (best-effort) → mappa email/telefono su customer_user_id
let resolveCustomerUserId = async (_db, _payload) => null;
try {
  const r = require('../utils/customers.resolve');
  if (typeof r === 'function') {
    resolveCustomerUserId = r;
  }
} catch (e) {
  logger.warn('ℹ️ [orders] customers.resolve non disponibile (../utils/customers.resolve mancante)', {
    error: String(e && e.message || e),
  });
}

// ============================================================================
// Helpers
// ============================================================================

const toNum = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const toDate = (v) => (v ? new Date(v) : null);

// 🧠 Util: estrai eventuali hint "Tavolo X" / "Sala Y" dalle note
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
 * 🔍 Risolve meta "location" per stampa / preview:
 *
 * 1) Se l'ordine ha già table_id → JOIN diretta su tables/rooms.
 * 2) Altrimenti, se ha scheduled_at, prova a inferire la prenotazione più vicina
 *    nello stesso giorno (stile "vecchia" logica).
 */
async function resolveLocationMeta(order) {
  if (!order) return { reservation: null, table: null, room: null };

  // 1) Caso semplice: ho già table_id sull'ordine
  if (order.table_id) {
    const rows = await query(
      `SELECT
         t.id AS table_id,
         t.table_number,
         COALESCE(NULLIF(t.table_number, ''), CONCAT('T', t.id)) AS table_name,
         rm.id   AS room_id,
         rm.name AS room_name
       FROM tables t
       LEFT JOIN rooms rm ON rm.id = t.room_id
       WHERE t.id = ?
       LIMIT 1`,
      [order.table_id],
    );

    const best = rows && rows[0] ? rows[0] : null;

    logger.info('🧭 orders.resolveLocationMeta(table)', {
      id          : order.id,
      table_id    : order.table_id,
      match_table : best && best.table_id,
      room_id     : best && best.room_id,
      room_name   : best && best.room_name,
    });

    if (!best) return { reservation: null, table: null, room: null };

    const table = {
      id    : best.table_id,
      number: best.table_number,
      label : best.table_name,
    };
    const room = best.room_id
      ? { id: best.room_id, name: best.room_name }
      : null;

    return { reservation: null, table, room };
  }

  // 2) Fallback: deduco da reservations usando scheduled_at
  if (!order.scheduled_at) {
    return { reservation: null, table: null, room: null };
  }

  const hints = parseLocationHintsFromNote(order.note);

  const rows = await query(
    `SELECT r.id,
            r.table_id,
            r.room_id,
            t.table_number,
            COALESCE(NULLIF(t.table_number, ''), CONCAT('T', t.id)) AS table_name,
            rm.name AS room_name,
            ABS(TIMESTAMPDIFF(MINUTE, r.start_at, ?)) AS delta_min
     FROM reservations r
     LEFT JOIN tables t ON t.id = r.table_id
     LEFT JOIN rooms  rm ON rm.id = r.room_id
     WHERE DATE(r.start_at) = DATE(?)
       AND r.table_id IS NOT NULL
     ORDER BY delta_min ASC, r.id DESC
     LIMIT 1`,
    [order.scheduled_at, order.scheduled_at],
  );

  const best = rows && rows[0] ? rows[0] : null;

  logger.info('🧭 orders.resolveLocationMeta(reservation)', {
    id          : order.id,
    hasScheduled: !!order.scheduled_at,
    table_hint  : hints.table_hint || null,
    room_hint   : hints.room_hint || null,
    match_id    : best && best.id,
    match_delta : best && best.delta_min,
    table_id    : best && best.table_id,
    table_num   : best && best.table_number,
    table_lbl   : best && best.table_name,
    room_id     : best && best.room_id,
    room_name   : best && best.room_name,
  });

  if (!best) {
    return { reservation: null, table: null, room: null };
  }

  const reservation = {
    id      : best.id,
    table_id: best.table_id,
    room_id : best.room_id,
  };
  const table = {
    id    : best.table_id,
    number: best.table_number,
    label : best.table_name,
  };
  const room = best.room_id
    ? { id: best.room_id, name: best.room_name }
    : null;

  return { reservation, table, room };
}

/**
 * Carica un ordine "full" (testata + righe + meta tavolo/sala/prenotazione)
 */
async function getOrderFullById(id) {
  // Testata ordine
  const rows = await query(
    `SELECT
       o.id,
       o.customer_name,
       o.phone,
       o.email,
       o.people,
       o.scheduled_at,
       o.status,
       o.total,
       o.channel,
       o.table_id,    -- 🆕 colonna aggiunta da 007_add_table_id_to_orders.sql
       o.note,
       o.created_at,
       o.updated_at,
       o.customer_user_id
     FROM orders o
     WHERE o.id = ?`,
    [id],
  );

  const o = rows && rows[0];
  if (!o) return null;

  // Righe con categoria risolta
  const items = await query(
    `SELECT i.id,
            i.order_id,
            i.product_id,
            i.name,
            i.qty,
            i.price,
            i.notes,
            i.created_at,
            COALESCE(c.name, 'Altro') AS category
     FROM order_items i
     LEFT JOIN products   p ON p.id = i.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE i.order_id = ?
     ORDER BY i.id ASC`,
    [id],
  );

  // Meta tavolo/sala
  const meta = await resolveLocationMeta(o);
  const resolvedTableId = (meta.table && meta.table.id) || o.table_id || null;

  return {
    ...o,
    table_id    : resolvedTableId,
    table_number: meta.table ? meta.table.number : null,
    table_name  : meta.table ? meta.table.label  : null,
    room_id     : meta.room ? meta.room.id       : null,
    room_name   : meta.room ? meta.room.name     : null,
    reservation : meta.reservation
      ? {
          id      : meta.reservation.id,
          table_id: meta.reservation.table_id,
          room_id : meta.reservation.room_id,
          table   : meta.table,
          room    : meta.room,
        }
      : null,
    items,
  };
}

// ============================================================================
// Montiamo eventuale endpoint SSE /api/orders/stream
// ============================================================================

try {
  if (typeof sse.mount === 'function') {
    sse.mount(router);
  }
} catch (e) {
  logger.warn('ℹ️ [orders] sse.mount KO (continuo senza SSE)', {
    error: String(e && e.message || e),
  });
}

// ============================================================================
// ROUTES
// ============================================================================

// Lista ordini (leggera o full per tavolo)
router.get('/', async (req, res) => {
  try {
    const { hours, from, to, status, q, table_id } = req.query;

    const conds = [];
    const params = [];

    if (hours) {
      conds.push('o.created_at >= (UTC_TIMESTAMP() - INTERVAL ? HOUR)');
      params.push(toNum(hours));
    }
    if (from) {
      conds.push('o.created_at >= ?');
      params.push(toDate(from));
    }
    if (to) {
      conds.push('o.created_at <= ?');
      params.push(toDate(to));
    }
    if (status && status !== 'all') {
      conds.push('o.status = ?');
      params.push(String(status));
    }
    if (q) {
      conds.push('(o.customer_name LIKE ? OR o.phone LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (table_id) {
      conds.push('o.table_id = ?');
      params.push(toNum(table_id));
    }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    // Lista "base" con join tavolo/sala (utile anche per board ordini)
    const rows = await query(
      `SELECT
         o.id,
         o.customer_name,
         o.phone,
         o.email,
         o.people,
         o.scheduled_at,
         o.status,
         o.total,
         o.channel,
         o.table_id,
         o.note,
         o.created_at,
         o.updated_at,
         t.table_number,
         COALESCE(NULLIF(t.table_number, ''), CONCAT('T', t.id)) AS table_name,
         rm.id   AS room_id,
         rm.name AS room_name
       FROM orders o
       LEFT JOIN tables t ON t.id = o.table_id
       LEFT JOIN rooms  rm ON rm.id = t.room_id
       ${where}
       ORDER BY o.id DESC
       LIMIT 300`,
      params,
    );

    // Caso: preview da lista tavoli → vogliamo ordini "full" con items/meta
    if (table_id) {
      const fullList = [];
      for (const r of rows) {
        const full = await getOrderFullById(r.id);
        if (full) fullList.push(full);
      }
      return res.json(fullList);
    }

    // Caso generico: ritorno lista compatta ma già arricchita con tavolo/sala
    return res.json(rows);
  } catch (e) {
    logger.error('📄 orders list ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_list_error' });
  }
});

// Dettaglio ordine "full"
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const full = await getOrderFullById(id);
    if (!full) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json(full);
  } catch (e) {
    logger.error('📄 orders get ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_get_error' });
  }
});

// Crea ordine
router.post('/', async (req, res) => {
  const dto = req.body || {};
  try {
    const scheduled = dto.scheduled_at ? toDate(dto.scheduled_at) : null;
    const items = Array.isArray(dto.items) ? dto.items : [];

    // Totale ricalcolato lato server
    const total = items.reduce(
      (acc, it) => acc + toNum(it.price) * toNum(it.qty, 1),
      0,
    );

    // customer_user_id opzionale via helper (se disponibile)
    const email = dto.email || (dto.customer && dto.customer.email) || null;
    const phone = dto.phone || (dto.customer && dto.customer.phone) || null;
    let customer_user_id = null;
    try {
      customer_user_id = await resolveCustomerUserId(
        { query },
        { email, phone },
      );
      if (customer_user_id) {
        logger.info('🧩 [Orders] mapped customer_user_id', {
          email,
          phone,
          customer_user_id,
        });
      }
    } catch (e) {
      logger.warn('⚠️ [Orders] resolveCustomerUserId KO', {
        error: String(e && e.message || e),
      });
    }

    // table_id dal payload, con fallback su reservation_id → reservations.table_id
    let tableIdFinal =
      dto.table_id ||
      dto.tableId ||
      (dto.table && dto.table.id) ||
      null;

    const reservationId =
      dto.reservation_id ||
      dto.reservationId ||
      (dto.reservation && dto.reservation.id) ||
      null;

    if (!tableIdFinal && reservationId) {
      try {
        const rows = await query(
          'SELECT table_id FROM reservations WHERE id = ? LIMIT 1',
          [reservationId],
        );
        if (rows[0] && rows[0].table_id) {
          tableIdFinal = rows[0].table_id;
        }
      } catch (e) {
        logger.warn(
          '⚠️ [Orders] resolve table_id from reservation_id KO',
          { error: String(e && e.message || e) },
        );
      }
    }

    const r = await query(
      `INSERT INTO orders (
         customer_name,
         phone,
         email,
         people,
         scheduled_at,
         table_id,
         note,
         channel,
         status,
         total,
         customer_user_id
       )
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        (dto.customer_name || 'Cliente').toString().trim(),
        phone || null,
        email || null,
        dto.people || null,
        scheduled,
        tableIdFinal || null,
        dto.note || null,
        dto.channel || 'admin',
        'pending',
        total,
        customer_user_id,
      ],
    );

    const orderId = r.insertId;

    for (const it of items) {
      await query(
        `INSERT INTO order_items (
           order_id,
           product_id,
           name,
           qty,
           price,
           notes
         )
         VALUES (?,?,?,?,?,?)`,
        [
          orderId,
          it.product_id != null ? it.product_id : null,
          it.name,
          toNum(it.qty, 1),
          toNum(it.price),
          it.notes || null,
        ],
      );
    }

    const full = await getOrderFullById(orderId);

    // Notifiche SSE / Socket.IO (best-effort)
    try {
      sse.emitCreated(full);
    } catch (e) {
      logger.warn('🧵 SSE emitCreated ⚠️', { error: String(e) });
    }
    try {
      socketBus.broadcastCreated(full);
    } catch (e) {
      logger.warn('📡 socket broadcastCreated ⚠️', { error: String(e) });
    }

    res.status(201).json(full);
  } catch (e) {
    logger.error('🆕 orders create ❌', {
      error: String(e),
      dto,
    });
    res.status(500).json({
      ok    : false,
      error : 'orders_create_error',
      reason: String(e),
    });
  }
});

// Cambio stato ordine
router.patch('/:id(\\d+)/status', async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const status = String((req.body && req.body.status) || '').toLowerCase();
    const allowed = new Set([
      'pending',
      'confirmed',
      'preparing',
      'ready',
      'completed',
      'cancelled',
    ]);
    if (!allowed.has(status)) {
      return res.status(400).json({ error: 'invalid_status' });
    }

    await query(
      `UPDATE orders
         SET status = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [status, id],
    );

    const full = await getOrderFullById(id);

    try {
      sse.emitStatus({ id, status });
    } catch (e) {
      logger.warn('🧵 SSE emitStatus ⚠️', { error: String(e) });
    }
    try {
      socketBus.broadcastUpdated(full);
    } catch (e) {
      logger.warn('📡 socket broadcastUpdated ⚠️', { error: String(e) });
    }

    res.json(full);
  } catch (e) {
    logger.error('✏️ orders status ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_status_error' });
  }
});

// Stampa CONTO (best-effort)
router.post('/:id(\\d+)/print', async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const full = await getOrderFullById(id);
    if (!full) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }

    try {
      await printOrderDual(full);
      logger.info('🖨️ orders print OK', { id });
      return res.json({ ok: true });
    } catch (e) {
      logger.warn('🖨️ orders print ⚠️', {
        id,
        error: String(e),
      });
      return res.status(502).json({
        ok    : false,
        error : 'printer_error',
        reason: String(e),
      });
    }
  } catch (e) {
    logger.error('🖨️ orders print ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_print_error' });
  }
});

// Handler condiviso per COMANDA (PIZZERIA | CUCINA)
async function handlePrintComanda(req, res) {
  try {
    const id = toNum(req.params.id);
    const full = await getOrderFullById(id);
    if (!full) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }

    const centerRaw = (
      (req.body && req.body.center) ||
      (req.query && req.query.center) ||
      'pizzeria'
    )
      .toString()
      .toUpperCase();

    const center = centerRaw === 'CUCINA' ? 'CUCINA' : 'PIZZERIA';
    const copies = Math.max(
      1,
      toNum(
        (req.body && req.body.copies) ||
          (req.query && req.query.copies),
        1,
      ),
    );

    try {
      for (let i = 0; i < copies; i += 1) {
        await printOrderForCenter(full, center);
      }
      logger.info('🧾 comanda OK', { id, center, copies });
      return res.json({ ok: true, center, copies });
    } catch (e) {
      logger.warn('🧾 comanda ⚠️', {
        id,
        center,
        error: String(e),
      });
      return res.status(502).json({
        ok    : false,
        error : 'printer_error',
        reason: String(e),
      });
    }
  } catch (e) {
    logger.error('🧾 comanda ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_comanda_error' });
  }
}

// Alias: /print/comanda (nuovo) e /print-comanda (compat)
router.post('/:id(\\d+)/print/comanda', handlePrintComanda);
router.post('/:id(\\d+)/print-comanda', handlePrintComanda);

// ============================================================================
// EXPORT
// ============================================================================

module.exports = router;
