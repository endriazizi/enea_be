// C:\Users\Endri Azizi\progetti-dev\my_dev\be\src\api\nfc-session.js
// ============================================================================
// API NFC Session — interrogazione stato sessione (ultimo ordine, ecc.)
// - GET /api/nfc/session/last-order?session_id=123
//   → { ok:true, hasOrder:boolean, order: { id, status, total, items:[...] } | null }
// Stile: commenti lunghi, log con emoji
// ============================================================================
'use strict';

const express = require('express');
const router  = express.Router();
const { query } = require('../db');

router.get('/last-order', async (req, res) => {
  const log = req.app.get('logger');
  try {
    const sessionId = Number(req.query.session_id || 0) || 0;
    if (!sessionId) return res.status(400).json({ ok:false, error:'session_id_required' });

    // 1) prendo last_order_id dalla sessione
    const rows1 = await query('SELECT last_order_id FROM table_sessions WHERE id = ?', [ sessionId ]);
    const lastOrderId = Number(rows1?.[0]?.last_order_id || 0) || 0;
    if (!lastOrderId) {
      log?.info?.('📭 [NFC] no last_order for session', { sessionId });
      return res.json({ ok:true, hasOrder:false, order:null });
    }

    // 2) header + total aggregato
    const rows2 = await query(`
      SELECT
        o.id, o.status, o.customer_name, o.phone, o.note, o.people,
        o.channel, o.reservation_id, o.table_id, o.room_id, o.scheduled_at,
        o.created_at, o.updated_at,
        IFNULL(SUM(oi.qty * oi.price), 0) AS total
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.id = ?
      GROUP BY o.id
    `, [ lastOrderId ]);

    if (!rows2?.length) {
      log?.warn?.('❓ [NFC] last_order_id presente ma ordine non trovato', { sessionId, lastOrderId });
      return res.json({ ok:true, hasOrder:false, order:null });
    }

    const order = rows2[0];

    // 3) items dettagliati
    const items = await query(`
      SELECT id, name, qty, price, notes
      FROM order_items
      WHERE order_id = ?
      ORDER BY id
    `, [ lastOrderId ]);

    log?.info?.('📦 [NFC] last-order found', { sessionId, lastOrderId, items: items.length });
    return res.json({ ok:true, hasOrder:true, order: { ...order, items } });
  } catch (e) {
    req.app.get('logger')?.error?.('💥 [NFC] /session/last-order failed', { error: String(e) });
    return res.status(500).json({ ok:false, error:'last_order_failed' });
  }
});

module.exports = router;
