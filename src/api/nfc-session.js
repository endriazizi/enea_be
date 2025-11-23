// C:\Users\Endri Azizi\progetti-dev\my_dev\be\src\api\nfc-session.js
'use strict';

// ============================================================================
// API NFC Session — interrogazione stato sessione (ultimo ordine, carrello, ecc.)
// - GET  /api/nfc/session/active?table_id=XX
//      → { ok:true, active:false }
//        { ok:true, active:true, session_id, started_at, cart_updated_at? }
// - POST /api/nfc/session/close
//      → chiude una sessione (per session_id, con opzionale table_id per log)
//        body: { session_id:number, table_id?:number }
// - GET  /api/nfc/session/cart?session_id=123
//      → { ok:true, session_id, version, cart, updated_at? } | 404 se nessuna
// - PUT  /api/nfc/session/cart
//      → { ok:true, session_id, version, updated_at? } oppure 409 (version_conflict)
// - GET  /api/nfc/session/last-order?session_id=123
//      → { ok:true, hasOrder:boolean, order: { id, status, total, items:[...] } | null }
// Stile: commenti lunghi, log con emoji
// ============================================================================

const express = require('express');
const router  = express.Router();
const { query } = require('../db');
const nfcSvc   = require('../services/nfc.service');

// ---------------------------------------------------------------------------
// GET /api/nfc/session/active?table_id=XX
// ---------------------------------------------------------------------------
// Usato dalla Lista Tavoli per mostrare il badge "Sessione attiva".
// NON crea nuove sessioni: è un semplice check sullo stato corrente.
// ---------------------------------------------------------------------------
router.get('/active', async (req, res) => {
  const log = req.app.get('logger');
  try {
    const tableId = Number(req.query.table_id || 0) || 0;
    if (!tableId) {
      return res.status(400).json({ ok: false, error: 'table_id_required' });
    }

    // 1) prendo la sessione attiva (se esiste)
    const active = await nfcSvc.getActiveSession(tableId);
    if (!active) {
      log?.info?.('📭 [NFC] nessuna sessione attiva per tavolo', { tableId });
      return res.json({ ok: true, active: false });
    }

    // 2) best-effort: leggo metadati carrello per avere cart_updated_at
    let cartMeta = null;
    try {
      cartMeta = await nfcSvc.getSessionCart(active.id);
    } catch (e) {
      log?.warn?.('⚠️ [NFC] getSessionCart in /active fallita (ignoro)', {
        tableId,
        session_id: active.id,
        error: String(e),
      });
    }

    const payload = {
      ok: true,
      active: true,
      session_id: active.id,
      started_at: active.opened_at || null,
      cart_updated_at: cartMeta?.cart_updated_at || null,
    };

    log?.info?.('🟢 [NFC] sessione attiva trovata', {
      tableId,
      session_id: active.id,
    });

    return res.json(payload);
  } catch (e) {
    log?.error?.('💥 [NFC] /session/active failed', { error: String(e) });
    return res.status(500).json({ ok: false, error: 'active_failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/nfc/session/close
// ---------------------------------------------------------------------------
// Chiude una sessione tavolo.
// - via session_id (preferito) → chiude quella specifica riga.
// - opzionale table_id: solo per log / fallback.
// Non crea nuove sessioni; se non c'è nulla da chiudere, closed=0.
// ---------------------------------------------------------------------------
router.post('/close', async (req, res) => {
  const log = req.app.get('logger');
  try {
    const body = req.body || {};
    const sessionId = Number(body.session_id || 0) || 0;
    const tableId   = Number(body.table_id   || 0) || 0;

    if (!sessionId && !tableId) {
      return res
        .status(400)
        .json({ ok: false, error: 'session_id_or_table_id_required' });
    }

    let closed = 0;
    let effectiveSessionId = sessionId || null;

    // Se ho session_id, provo a chiudere direttamente quella riga
    if (sessionId) {
      const resSel = await query(
        'SELECT id, table_id, closed_at FROM table_sessions WHERE id = ? LIMIT 1',
        [sessionId],
      );
      const row = resSel?.[0];
      if (!row) {
        log?.warn?.('❓ [NFC] /close con session_id inesistente', {
          sessionId,
          tableId,
        });
      } else if (row.closed_at) {
        log?.info?.('ℹ️ [NFC] /close su sessione già chiusa', {
          sessionId,
          tableId: row.table_id,
        });
        effectiveSessionId = row.id;
      } else {
        const resUpd = await query(
          `UPDATE table_sessions
              SET closed_at = NOW(),
                  closed_by = ?
            WHERE id = ? AND closed_at IS NULL`,
          ['api:nfc-session/close', sessionId],
        );
        closed = Number(resUpd?.affectedRows || 0);
        effectiveSessionId = row.id;
        log?.info?.('🔴 [NFC] Sessione CHIUSA via session_id', {
          sessionId,
          tableId: row.table_id,
          closed,
        });
      }
    }

    // Se non ho session_id oppure non ho chiuso nulla, ma ho tableId,
    // faccio fallback su closeActiveSession(table_id).
    if (!closed && tableId) {
      const result = await nfcSvc.closeActiveSession(tableId, {
        by: 'api:nfc-session/close',
      });
      closed = Number(result?.closed || 0);
      if (!effectiveSessionId && result?.session_id) {
        effectiveSessionId = result.session_id;
      }
      log?.info?.('🔴 [NFC] Sessione CHIUSA via table_id', {
        tableId,
        closed,
        session_id: result?.session_id || null,
      });
    }

    return res.json({
      ok: true,
      closed,
      session_id: effectiveSessionId,
    });
  } catch (e) {
    log?.error?.('💥 [NFC] /session/close failed', { error: String(e) });
    return res.status(500).json({ ok: false, error: 'close_failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/nfc/session/cart?session_id=SID
// ---------------------------------------------------------------------------
// Restituisce lo snapshot carrello lato BE.
// - 200 con payload se esiste
// - 404 se nessuna sessione o nessun carrello
// ---------------------------------------------------------------------------
router.get('/cart', async (req, res) => {
  const log = req.app.get('logger');
  try {
    const sessionId = Number(req.query.session_id || 0) || 0;
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'session_id_required' });
    }

    const meta = await nfcSvc.getSessionCart(sessionId);
    if (!meta) {
      log?.info?.('📭 [NFC] nessun carrello per sessione', { sessionId });
      return res.status(404).json({ ok: false, error: 'cart_not_found' });
    }

    let cartObj = null;
    if (meta.cart_json) {
      try {
        cartObj = JSON.parse(meta.cart_json);
      } catch (e) {
        log?.warn?.('⚠️ [NFC] cart_json non parseable, ritorno stringa raw', {
          sessionId,
          error: String(e),
        });
        cartObj = meta.cart_json;
      }
    }

    return res.json({
      ok: true,
      session_id: sessionId,
      version: meta.version ?? 0,
      cart: cartObj,
      updated_at: meta.cart_updated_at ?? null,
    });
  } catch (e) {
    log?.error?.('💥 [NFC] /session/cart (GET) failed', { error: String(e) });
    return res.status(500).json({ ok: false, error: 'cart_get_failed' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/nfc/session/cart
// ---------------------------------------------------------------------------
// Salva lo snapshot carrello con optimistic locking via version.
// Body: { session_id, version, cart }
// - 200 se ok
// - 409 se version_conflict (stato cambiato nel frattempo)
// ---------------------------------------------------------------------------
router.put('/cart', async (req, res) => {
  const log = req.app.get('logger');
  try {
    const body = req.body || {};
    const sessionId = Number(body.session_id || 0) || 0;
    const version   = Number(body.version   || 0) || 0;
    const cart      = body.cart ?? null;

    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'session_id_required' });
    }

    try {
      const result = await nfcSvc.saveSessionCart(sessionId, version, cart);
      return res.json({
        ok: true,
        session_id: sessionId,
        version: result?.version ?? 0,
        updated_at: result?.updated_at ?? null,
      });
    } catch (err) {
      if (err && err.status === 409) {
        // Conflitto di versione → passo through info corrente se disponibile.
        log?.warn?.('⚠️ [NFC] saveSessionCart version_conflict', {
          sessionId,
          current: err.current || null,
        });
        return res.status(409).json({
          ok: false,
          error: 'version_conflict',
          current: err.current || null,
        });
      }
      throw err;
    }
  } catch (e) {
    log?.error?.('💥 [NFC] /session/cart (PUT) failed', { error: String(e) });
    return res.status(500).json({ ok: false, error: 'cart_save_failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/nfc/session/last-order?session_id=123
// ---------------------------------------------------------------------------
// Ultimo ordine associato alla sessione (se table_sessions.last_order_id è
// valorizzato). Implementazione originale tua, ripresa e lasciata invariata.
// ---------------------------------------------------------------------------
router.get('/last-order', async (req, res) => {
  const log = req.app.get('logger');
  try {
    const sessionId = Number(req.query.session_id || 0) || 0;
    if (!sessionId)
      return res
        .status(400)
        .json({ ok: false, error: 'session_id_required' });

    // 1) prendo last_order_id dalla sessione
    const rows1 = await query(
      'SELECT last_order_id FROM table_sessions WHERE id = ?',
      [sessionId],
    );
    const lastOrderId = Number(rows1?.[0]?.last_order_id || 0) || 0;
    if (!lastOrderId) {
      log?.info?.('📭 [NFC] no last_order for session', { sessionId });
      return res.json({ ok: true, hasOrder: false, order: null });
    }

    // 2) header + total aggregato
    const rows2 = await query(
      `
      SELECT
        o.id, o.status, o.customer_name, o.phone, o.note, o.people,
        o.channel, o.reservation_id, o.table_id, o.room_id, o.scheduled_at,
        o.created_at, o.updated_at,
        IFNULL(SUM(oi.qty * oi.price), 0) AS total
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.id = ?
      GROUP BY o.id
    `,
      [lastOrderId],
    );

    if (!rows2?.length) {
      log?.warn?.(
        '❓ [NFC] last_order_id presente ma ordine non trovato',
        { sessionId, lastOrderId },
      );
      return res.json({ ok: true, hasOrder: false, order: null });
    }

    const order = rows2[0];

    // 3) items dettagliati
    const items = await query(
      `
      SELECT id, name, qty, price, notes
      FROM order_items
      WHERE order_id = ?
      ORDER BY id
    `,
      [lastOrderId],
    );

    log?.info?.('📦 [NFC] last-order found', {
      sessionId,
      lastOrderId,
      items: items.length,
    });
    return res.json({ ok: true, hasOrder: true, order: { ...order, items } });
  } catch (e) {
    req.app
      .get('logger')
      ?.error?.('💥 [NFC] /session/last-order failed', { error: String(e) });
    return res.status(500).json({ ok: false, error: 'last_order_failed' });
  }
});

module.exports = router;
