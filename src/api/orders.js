// src/api/orders.js
// ============================================================================
// /api/orders — gestione ordini (lista, dettaglio, creazione, stato, stampa)
//
// Allineato con:
// - OrderBuilderPage (creazione ordini da tavolo + prenotazione + NFC session)
// - TablesListPage (preview ordini per tavolo + stampa conto/comanda)
//
// Caratteristiche principali:
// - LIST: filtro per hours/from/to/status/q/table_id
//   - se passi ?table_id=XX ⇒ restituisce ordini "full" con righe e meta tavolo/sala
// - GET /:id                 ⇒ dettaglio ordine completo (righe + meta tavolo/sala/prenotazione)
// - GET /:id/batches         ⇒ storico mandate T1/T2/T3 (order_batches + snapshot righe)
// - GET /active-by-session   ⇒ ordine attivo per session_id NFC (best-effort + backfill)
// - POST /                   ⇒ crea ordine, ricalcola totale lato server, valorizza table_id, lega NFC
// - POST /:id/items          ⇒ aggiunge righe ad un ordine esistente (supporto T2/T3 lato BE)
// - PATCH /:id/status        ⇒ cambio stato semplice (pending/confirmed/preparing/...)
// - POST /:id/print          ⇒ stampa CONTO (printOrderDual, best-effort) + batch Tn
// - POST /:id/print/comanda  ⇒ stampa comanda PIZZERIA/CUCINA + batch Tn
// - POST /:id/print-comanda  ⇒ alias compat
//
// Tutte le integrazioni extra (SSE, Socket.IO, stampa, customers.resolve) sono
// opzionali: se i moduli non ci sono, logghiamo un warning e continuiamo.
// ============================================================================

'use strict';

const express = require('express');
const router  = express.Router();

const logger = require('../logger');
const { query } = require('../db');

// === requireAuth con fallback DEV ============================================
let requireAuth;
try {
  ({ requireAuth } = require('../middleware/auth'));
  if (typeof requireAuth !== 'function') throw new Error('requireAuth non è una funzione');
  logger.info('🔐 requireAuth caricato da ../middleware/auth');
} catch {
  logger.warn('⚠️ requireAuth non disponibile. Uso FALLBACK DEV (solo locale).');
  requireAuth = (req, _res, next) => {
    req.user = { id: 0, email: process.env.AUTH_DEV_USER || 'dev@local' };
    next();
  };
}

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
    error: String((e && e.message) || e),
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
    error: String((e && e.message) || e),
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
  logger.warn(
    'ℹ️ [orders] print-order non disponibile (../utils/print-order mancante o non valido)',
    { error: String((e && e.message) || e) },
  );
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
    error: String((e && e.message) || e),
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
       o.table_id,    -- colonna aggiunta da 007_add_table_id_to_orders.sql
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

/**
 * Ricalcola il totale ordine sulla base delle righe presenti in order_items.
 * Aggiorna anche updated_at e restituisce il nuovo totale numerico.
 */
async function recalcOrderTotal(orderId) {
  const rows = await query(
    'SELECT IFNULL(SUM(qty * price), 0) AS total FROM order_items WHERE order_id = ?',
    [orderId],
  );
  const total = rows && rows[0] ? Number(rows[0].total || 0) : 0;

  await query(
    `UPDATE orders
       SET total = ?, updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [total, orderId],
  );

  return total;
}

// ============================================================================
// 🆕 Modello professionale — helper per qty negative / correzioni
// ============================================================================

/**
 * Costruisce una mappa { `${name}@@${price}` -> agg_qty } per tutte
 * le voci che hanno almeno una riga con qty negativa nel batch items.
 *
 * Usiamo una singola query su order_items per recuperare la qty "base"
 * attuale in DB per ciascuna combinazione (name, price).
 *
 * @param {number} orderId
 * @param {Array<{ name:string, price:number, qty:number }>} items
 * @returns {Promise<Map<string, number>>}
 */
async function buildBaseQtyMapForCorrections(orderId, items) {
  const negativeKeys = [];
  const seen = new Set();

  for (const raw of items || []) {
    const qty = Number(raw && raw.qty);
    if (!Number.isFinite(qty) || qty >= 0) continue;

    const name = (raw.name || '').toString().trim();
    if (!name) continue;

    const priceNum = Number(raw.price || 0);
    const key = `${name}@@${priceNum.toFixed(2)}`;

    if (seen.has(key)) continue;
    seen.add(key);
    negativeKeys.push({ name, price: priceNum, key });
  }

  const baseMap = new Map();
  if (!negativeKeys.length) {
    return baseMap; // nessuna qty negativa → niente query DB
  }

  const params = [orderId];
  const conds  = [];

  for (const nk of negativeKeys) {
    conds.push('(oi.name = ? AND oi.price = ?)');
    params.push(nk.name, nk.price);
  }

  const sql = `
    SELECT
      oi.name,
      oi.price,
      IFNULL(SUM(oi.qty), 0) AS agg_qty
    FROM order_items oi
    WHERE oi.order_id = ?
      AND (${conds.join(' OR ')})
    GROUP BY oi.name, oi.price
  `;

  const rows = await query(sql, params);

  for (const r of rows || []) {
    const name      = (r.name || '').toString().trim();
    const priceNum  = Number(r.price || 0);
    const key       = `${name}@@${priceNum.toFixed(2)}`;
    const aggQtyNum = Number(r.agg_qty || 0);
    baseMap.set(key, aggQtyNum);
  }

  return baseMap;
}

/**
 * Valida un batch di righe (positive e negative) prima dell'insert.
 *
 * Regole:
 * - se una correzione (qty < 0) si riferisce ad una combinazione (name,price)
 *   che NON esiste in DB → errore qty_under_zero
 * - se applicando i delta la qty aggregata andasse sotto zero → errore qty_under_zero
 *
 * Se tutto ok, non ritorna nulla.
 *
 * @param {number} orderId
 * @param {Array<{ name:string, price:number, qty:number }>} items
 * @throws {Error & { status?:number, code?:string, payload?:any }}
 */
async function validateItemDeltas(orderId, items) {
  if (!Array.isArray(items) || !items.length) return;

  const baseMap = await buildBaseQtyMapForCorrections(orderId, items);
  const aggMap  = new Map(baseMap);

  for (const item of items) {
    const name = (item.name || '').toString().trim();
    const priceNum = Number(item.price || 0);
    const deltaQty = Number(item.qty || 0);

    if (!deltaQty) continue; // qty = 0 non influenza niente

    const key = `${name}@@${priceNum.toFixed(2)}`;

    // Caso: correzione su voce non presente in DB → partiamo da 0, ma è già errore
    if (deltaQty < 0 && !baseMap.has(key)) {
      const baseQty  = 0;
      const aggAfter = baseQty + deltaQty;

      logger.warn('⚠️ [orders] correzione su voce inesistente', {
        order_id : orderId,
        name,
        price    : priceNum,
        base_qty : baseQty,
        delta_qty: deltaQty,
        agg_after: aggAfter,
      });

      const err = new Error('qty_under_zero');
      err.status  = 400;
      err.code    = 'qty_under_zero';
      err.payload = {
        name,
        price    : priceNum,
        base_qty : baseQty,
        delta_qty: deltaQty,
        agg_after: aggAfter,
      };
      throw err;
    }

    const prevQty = Number(
      aggMap.has(key)
        ? aggMap.get(key)
        : (baseMap.get(key) ?? 0),
    );
    const nextQty = prevQty + deltaQty;

    if (nextQty < 0) {
      logger.warn('⚠️ [orders] correzione porterebbe qty sotto zero', {
        order_id : orderId,
        name,
        price    : priceNum,
        base_qty : prevQty,
        delta_qty: deltaQty,
        agg_after: nextQty,
      });

      const err = new Error('qty_under_zero');
      err.status  = 400;
      err.code    = 'qty_under_zero';
      err.payload = {
        name,
        price    : priceNum,
        base_qty : prevQty,
        delta_qty: deltaQty,
        agg_after: nextQty,
      };
      throw err;
    }

    // Aggiorno qty "virtuale" dopo il delta
    aggMap.set(key, nextQty);
  }
}

// ============================================================================
// 🆕 Helper NFC: lega ordine ↔ sessione
// ============================================================================

// === INIZIO MODIFICA: bind ordine ↔ sessione tavolo ========================
async function bindOrderToSession(sessionId, orderId) {
  // best-effort: se manca uno dei due, non facciamo nulla
  if (!sessionId || !orderId) return;

  try {
    // 🔁 NOTA IMPORTANTE:
    // Usiamo la tabella ESISTENTE "table_sessions", che è la stessa
    // letta da /api/nfc/session/last-order per trovare last_order_id.
    await query(
      `UPDATE table_sessions
          SET last_order_id = ?, updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [orderId, sessionId],
    );

    logger.info('🔗 [NFC] bind order→session OK', {
      sessionId,
      orderId,
    });
  } catch (e) {
    // Non deve MAI bloccare la creazione ordine / stampa: solo warning.
    logger.warn('⚠️ [NFC] bind order→session KO (best-effort, continuo)', {
      sessionId,
      orderId,
      error: String((e && e.message) || e),
    });
  }
}
// === FINE MODIFICA ==========================================================

// ============================================================================
// NEW: Helper per T1/T2/T3 (order_batches con snapshot JSON)
// ============================================================================

/**
 * Crea una riga in order_batches per l'ordine indicato.
 * - batch_no = MAX(batch_no)+1 per quell'ordine
 * - items_snapshot_json = snapshot righe ordine (id,product_id,name,qty,price,notes,category)
 *
 * best-effort:
 * - se la tabella non esiste o dà errore → log WARN ma NON blocca la stampa.
 */
async function createOrderBatchSnapshot(orderId, options = {}) {
  const { sentBy = null, note = null } = options || {};
  try {
    // 1) prossimo batch_no
    const rows = await query(
      'SELECT IFNULL(MAX(batch_no), 0) AS max_no FROM order_batches WHERE order_id = ?',
      [orderId],
    );
    const maxNo = rows && rows[0] ? Number(rows[0].max_no || 0) : 0;
    const nextNo = maxNo + 1;

    // 2) snapshot righe corrente (ordine completo, con categoria già risolta)
    const items = await query(
      `SELECT i.id,
              i.product_id,
              i.name,
              i.qty,
              i.price,
              i.notes,
              COALESCE(c.name, 'Altro') AS category
       FROM order_items i
       LEFT JOIN products   p ON p.id = i.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE i.order_id = ?
       ORDER BY i.id ASC`,
      [orderId],
    );

    const snapshot = (items || []).map((it) => ({
      id        : it.id,
      product_id: it.product_id,
      name      : it.name,
      qty       : Number(it.qty || 0),
      price     : Number(it.price || 0),
      notes     : it.notes || null,
      category  : it.category || 'Altro',
    }));

    await query(
      `INSERT INTO order_batches (
         order_id,
         batch_no,
         sent_at,
         sent_by,
         note,
         items_snapshot_json
       )
       VALUES (
         ?,
         ?,
         UTC_TIMESTAMP(),
         ?,
         ?,
         ?
       )`,
      [
        orderId,
        nextNo,
        sentBy || null,
        note || null,
        JSON.stringify(snapshot),
      ],
    );

    logger.info('🧾 [orders] batch snapshot creato', {
      order_id: orderId,
      batch_no: nextNo,
      items   : snapshot.length,
      note    : note || null,
      sentBy  : sentBy || null,
    });
  } catch (e) {
    // NON deve mai bloccare stampa / flusso ordine
    logger.warn('⚠️ [orders] createOrderBatchSnapshot KO (best-effort, continuo)', {
      order_id: orderId,
      error   : String((e && e.message) || e),
    });
  }
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
    error: String((e && e.message) || e),
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

// ============================================================================
// 🆕 GET /api/orders/active-by-session?session_id=18
//     - usa nfc_sessions.last_order_id se presente
//     - altrimenti cerca l'ultimo ordine "aperto" per quel tavolo
//       e fa backfill di last_order_id (best-effort)
// ============================================================================

router.get('/active-by-session', async (req, res) => {
  try {
    const raw = req.query.session_id || req.query.sessionId;
    const sessionId = toNum(raw, 0);
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'missing_session_id' });
    }

    // 🔎 Leggo dalla tabella REALE usata dal resto del BE: table_sessions
    const rows = await query(
      `SELECT id, table_id, last_order_id
         FROM table_sessions
        WHERE id = ?
        LIMIT 1`,
      [sessionId],
    );

    const session = rows && rows[0];
    if (!session) {
      logger.info('📭 [NFC] active-by-session: session non trovata', { sessionId });
      // FE può distinguere con 404, ma di solito qui non ci arrivi se hai appena aperto la sessione
      return res.status(404).json({ ok: false, error: 'session_not_found' });
    }

    let orderId = session.last_order_id ? Number(session.last_order_id) : null;
    let order   = null;

    // 1) Provo dal last_order_id
    if (orderId) {
      order = await getOrderFullById(orderId);
      if (!order) {
        logger.warn('📭 [NFC] active-by-session: last_order_id non valido', {
          sessionId,
          orderId,
        });
        orderId = null;
      }
    }

    // 2) Se non ho ordine, provo dal tavolo (ultimo ordine "aperto")
    if (!order) {
      if (!session.table_id) {
        logger.info('📭 [NFC] active-by-session: nessun table_id e nessun last_order', {
          sessionId,
        });
        return res.status(200).json(null);
      }

      const ordRows = await query(
        `SELECT id
           FROM orders
          WHERE table_id = ?
            AND status IN ('pending','confirmed','preparing','ready')
          ORDER BY id DESC
          LIMIT 1`,
        [session.table_id],
      );

      if (!ordRows || !ordRows[0]) {
        logger.info('📭 [NFC] active-by-session: nessun ordine aperto per tavolo', {
          sessionId,
          table_id: session.table_id,
        });
        return res.status(200).json(null);
      }

      orderId = ordRows[0].id;
      order   = await getOrderFullById(orderId);

      // Backfill last_order_id best-effort su table_sessions
      try {
        await query(
          `UPDATE table_sessions
             SET last_order_id = ?, updated_at = UTC_TIMESTAMP()
           WHERE id = ?`,
          [orderId, sessionId],
        );
        logger.info('🔗 [NFC] backfill last_order_id da orders', {
          sessionId,
          orderId,
          table_id: session.table_id,
        });
      } catch (e) {
        logger.warn('⚠️ [NFC] backfill last_order_id KO (best-effort)', {
          sessionId,
          orderId,
          error: String((e && e.message) || e),
        });
      }
    }

    if (!order) {
      return res.status(200).json(null);
    }

    logger.info('📦 [NFC] active order by session', {
      sessionId,
      order_id: order.id,
      table_id: order.table_id,
    });

    // Qui ritorniamo direttamente l'ordine "full"
    res.json(order);
  } catch (e) {
    logger.error('📦 orders active-by-session ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_active_by_session_error' });
  }
});

// 🔎 Storico mandate / T1-Tn (order_batches)
// Nota routing: deve stare PRIMA di "/:id(\\d+)".
router.get('/:id(\\d+)/batches', async (req, res) => {
  try {
    const id = toNum(req.params.id);

    const rows = await query(
      `SELECT
         b.id,
         b.order_id,
         b.batch_no,
         b.sent_at,
         b.sent_by,
         b.note,
         b.items_snapshot_json
       FROM order_batches b
       WHERE b.order_id = ?
       ORDER BY b.batch_no ASC, b.id ASC`,
      [id],
    );

    const mapped = (rows || []).map((r) => {
      let items = null;
      if (r.items_snapshot_json) {
        try {
          items = JSON.parse(r.items_snapshot_json);
        } catch {
          items = null;
        }
      }
      return {
        id       : r.id,
        order_id : r.order_id,
        batch_no : r.batch_no,
        sent_at  : r.sent_at,
        sent_by  : r.sent_by,
        note     : r.note,
        items,
      };
    });

    res.json(mapped);
  } catch (e) {
    logger.error('📄 order_batches list ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'order_batches_list_error' });
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

// ➕ Aggiunge righe ad un ordine esistente (T2/T3 lato BE + correzioni qty negative)
router.post('/:id(\\d+)/items', async (req, res) => {
  const log = req.app.get('logger') || logger;

  try {
    const id = toNum(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, error: 'invalid_id' });
    }

    const dto   = req.body || {};
    const items = Array.isArray(dto.items) ? dto.items : [];

    if (!items.length) {
      return res.status(400).json({ ok: false, error: 'no_items' });
    }

    // Verifico che l'ordine esista
    const existing = await query(
      'SELECT id FROM orders WHERE id = ? LIMIT 1',
      [id],
    );
    if (!existing || !existing[0]) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }

    // Normalizzazione:
    // - trim name
    // - qty numerica (qty=0 scartata)
    // - price numerico
    const normalized = [];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;

      const name = (it.name || '').toString().trim();
      if (!name) continue;

      const qty = toNum(it.qty, 0);
      if (!qty) continue; // qty = 0 → non ha effetto

      const priceNum = toNum(it.price, 0);

      normalized.push({
        product_id: it.product_id != null ? it.product_id : null,
        name,
        qty,
        price: priceNum,
        notes: it.notes || null,
      });
    }

    if (!normalized.length) {
      return res.status(400).json({ ok: false, error: 'no_items' });
    }

    const hasCorrections = normalized.some((it) => it.qty < 0);

    // 🧮 Validazione "modello professionale" per qty negative
    if (hasCorrections) {
      await validateItemDeltas(id, normalized);
    }

    let insertedRows = 0;

    // INSERT riga-per-riga (volumi contenuti, leggibile)
    for (const it of normalized) {
      const result = await query(
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
          id,
          it.product_id,
          it.name,
          it.qty,
          it.price,
          it.notes,
        ],
      );
      insertedRows += Number(result && result.affectedRows || 0);

      if (it.qty < 0) {
        log.info('➖ [orders] correction line', {
          order_id : id,
          base_name: it.name,
          delta_qty: it.qty,
          price    : it.price,
        });
      } else {
        log.info('➕ [orders] add item line', {
          order_id: id,
          name    : it.name,
          qty     : it.qty,
          price   : it.price,
        });
      }
    }

    const newTotal = await recalcOrderTotal(id);
    const full     = await getOrderFullById(id);

    // Notifiche SSE / Socket.IO (come prima)
    try {
      sse.emitStatus({ id, status: full && full.status, total: newTotal });
    } catch (e) {
      logger.warn('🧵 SSE emitStatus (items) ⚠️', { error: String(e) });
    }
    try {
      socketBus.broadcastUpdated(full);
    } catch (e) {
      logger.warn('📡 socket broadcastUpdated (items) ⚠️', { error: String(e) });
    }

    log.info('➕ [orders] items added (modello professionale)', {
      id,
      lines         : normalized.length,
      inserted_rows : insertedRows,
      total         : newTotal,
      has_corrections: hasCorrections,
    });

    // Manteniamo la risposta compatibile: ritorniamo l'ordine "full"
    res.status(201).json(full);
  } catch (e) {
    const id = toNum(req.params.id);

    // Caso specifico: qty_under_zero (violazione regole correzioni)
    if (e && e.code === 'qty_under_zero') {
      logger.warn('⚠️ orders add-items — qty_under_zero', {
        id,
        detail: e.payload || null,
      });
      return res.status(e.status || 400).json({
        ok    : false,
        error : 'qty_under_zero',
        detail: e.payload || null,
      });
    }

    logger.error('➕ orders add-items ❌', {
      error: String(e),
      id,
    });
    res.status(500).json({
      ok    : false,
      error : 'orders_add_items_error',
      reason: String(e),
    });
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
    const displayName =
      dto.customer_name ||
      (dto.customer && (dto.customer.name || dto.customer.display_name)) ||
      null;

    let customer_user_id = null;
    try {
      customer_user_id = await resolveCustomerUserId(
        { query },
        { email, phone, displayName },
      );
      if (customer_user_id) {
        logger.info('🧩 [Orders] mapped customer_user_id', {
          email,
          phone,
          displayName,
          customer_user_id,
        });
      }
    } catch (e) {
      logger.warn('⚠️ [Orders] resolveCustomerUserId KO', {
        error: String((e && e.message) || e),
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
          { error: String((e && e.message) || e) },
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

    // 🆕 Se arriva session_id dal FE (NFC), lego l'ordine alla sessione
    const sessionId =
      dto.session_id ||
      dto.sessionId ||
      null;

    if (sessionId) {
      await bindOrderToSession(toNum(sessionId, 0), orderId);
    }

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

// Elimina ordine (protetto)
router.delete('/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    const id = toNum(req.params.id);

    const rows = await query('SELECT id FROM orders WHERE id = ? LIMIT 1', [id]);
    if (!rows || !rows[0]) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }

    // Best-effort: rimuoviamo righe / batches e testa ordine.
    // Nota: questa è una cancellazione hard; se preferisci soft-delete
    // possiamo invece aggiornare lo status a 'cancelled' o 'deleted'.
    try {
      await query('DELETE FROM order_items WHERE order_id = ?', [id]);
      await query('DELETE FROM order_batches WHERE order_id = ?', [id]);
      await query('DELETE FROM orders WHERE id = ?', [id]);
    } catch (e) {
      logger.warn('⚠️ orders delete inner queries KO', { id, error: String(e) });
      return res.status(500).json({ ok: false, error: 'orders_delete_error', reason: String(e) });
    }

    // Notify SSE / Socket.IO (best-effort)
    try {
      sse.emitStatus({ id, status: 'deleted' });
    } catch (e) {
      logger.warn('🧵 SSE emitStatus (deleted) ⚠️', { error: String(e) });
    }
    try {
      socketBus.broadcastUpdated({ id, deleted: true });
    } catch (e) {
      logger.warn('📡 socket broadcastUpdated (deleted) ⚠️', { error: String(e) });
    }

    logger.info('🗑️ orders delete OK', { id });
    return res.json({ ok: true });
  } catch (e) {
    logger.error('🗑️ orders delete ❌', { error: String(e) });
    return res.status(500).json({ ok: false, error: 'orders_delete_error' });
  }
});

// Stampa CONTO (best-effort) + batch snapshot Tn
router.post('/:id(\\d+)/print', async (req, res) => {
  try {
    const id = toNum(req.params.id);
    const full = await getOrderFullById(id);
    if (!full) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }

    // Tn: ogni volta che stampo il CONTO registro un batch
    const sentBy =
      (req.user && (req.user.email || req.user.username || req.user.id)) ||
      null;
    await createOrderBatchSnapshot(id, {
      sentBy,
      note: 'CONTO',
    });

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

    // Tn: ogni volta che invio COMANDA registro un batch
    const sentBy =
      (req.user && (req.user.email || req.user.username || req.user.id)) ||
      null;
    await createOrderBatchSnapshot(id, {
      sentBy,
      note: `COMANDA:${center}`,
    });

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
