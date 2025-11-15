// C:\Users\Endri Azizi\progetti-dev\my_dev\be\src\services\orders.service.js
// ============================================================================
// ORDERS API (REST + SSE) — stile Endri: commenti lunghi, log con emoji
// Rotte:
//   GET    /api/orders                         → lista (filtri: status|hours|from|to|q)
//   GET    /api/orders/:id                     → dettaglio (header + items + categoria)
//   POST   /api/orders                         → crea ordine + items
//   PATCH  /api/orders/:id/status              → cambio stato (emette SSE "status")
//   POST   /api/orders/:id/print               → stampa comande (PIZZERIA/CUCINA)
//   POST   /api/orders/print                   → compat: body { id }
//   GET    /api/orders/count-by-status         → counts per status (range)
//   GET    /api/orders/stream                  → Server-Sent Events (created/status)
// Note DB: tabelle `orders` e `order_items`; categoria item via JOIN categories
// ============================================================================

const express = require('express');
const router = express.Router();
const { EventEmitter } = require('events');

const pool = require('../db');              // ← il tuo pool mysql2/promise
const log  = require('../logger') || console;
const { format } = require('date-fns');
const { it } = require('date-fns/locale');

// --- Event Bus per SSE -------------------------------------------------------
const bus = new EventEmitter();
bus.setMaxListeners(200);

// UTIL -------------------------------------------------------------

/** Normalizza range temporale: accetta ?hours oppure ?from&?to (YYYY-MM-DD HH:mm:ss) */
function resolveRange(query) {
  const now = new Date();
  if (query.from && query.to) return { from: query.from, to: query.to };
  const h = Number(query.hours ?? 6);
  const from = new Date(now.getTime() - Math.max(1, h) * 3600 * 1000);
  return {
    from: format(from, 'yyyy-MM-dd HH:mm:ss'),
    to:   format(now,  'yyyy-MM-dd HH:mm:ss'),
  };
}

function statusWhere(status) {
  if (!status || status === 'all') return '1=1';
  return 'o.status = ?';
}
function statusParams(status) {
  if (!status || status === 'all') return [];
  return [String(status)];
}

/** Legge gli items con categoria *via categories*, non p.category (che non c’è nel tuo DB) */
async function loadItems(orderId, conn) {
  const sql = `
    SELECT i.id, i.order_id, i.product_id, i.name, i.qty, i.price, i.notes, i.created_at,
           COALESCE(c.name, 'Altro') AS category
    FROM order_items i
    LEFT JOIN products   p ON p.id = i.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE i.order_id = ?
    ORDER BY i.id ASC
  `;
  const [rows] = await (conn || pool).query(sql, [orderId]);
  return rows.map(r => ({ ...r, price: Number(r.price) }));
}

async function loadHeader(orderId, conn) {
  const sql = `
    SELECT o.id, o.customer_name, o.phone, o.email, o.people, o.scheduled_at,
           o.note, o.channel, o.status, o.created_at, o.updated_at,
           (SELECT SUM(ii.qty * ii.price) FROM order_items ii WHERE ii.order_id=o.id) AS total
    FROM orders o
    WHERE o.id = ?
  `;
  const [rows] = await (conn || pool).query(sql, [orderId]);
  if (!rows.length) return null;
  const h = rows[0];
  return { ...h, total: h.total != null ? Number(h.total) : null };
}

/** Stampa tramite TCP 9100 (ESC/POS). Non usa il simbolo € (codepage). */
async function printComande(order, opts = {}) {
  try {
    const enabled = String(process.env.PRINTER_ENABLED || 'false') === 'true';
    if (!enabled) {
      log.warn('🖨️  PRINTER_DISABLED — niente stampa', { service: 'server' });
      return { ok: true, skipped: true };
    }

    // Stampanti da .env (di default stessa per entrambi i reparti)
    const pizHost = process.env.PIZZERIA_PRINTER_IP || process.env.PRINTER_IP;
    const pizPort = Number(process.env.PIZZERIA_PRINTER_PORT || process.env.PRINTER_PORT || 9100);
    const kitHost = process.env.KITCHEN_PRINTER_IP  || process.env.PRINTER_IP;
    const kitPort = Number(process.env.KITCHEN_PRINTER_PORT  || process.env.PRINTER_PORT || 9100);

    const PIZZERIA_CATEGORIES = (process.env.PIZZERIA_CATEGORIES || 'PIZZE,PIZZE ROSSE,PIZZE BIANCHE')
      .split(',').map(s => s.trim().toUpperCase());
    const KITCHEN_CATEGORIES  = (process.env.KITCHEN_CATEGORIES  || 'BEVANDE,ANTIPASTI')
      .split(',').map(s => s.trim().toUpperCase());

    // Split items per reparto
    const pizItems = order.items.filter(i => PIZZERIA_CATEGORIES.includes(String(i.category || '').toUpperCase()));
    const kitItems = order.items.filter(i => KITCHEN_CATEGORIES.includes(String(i.category || '').toUpperCase()));

    const { createConnection } = require('net');

    function sendRaw(host, port, text) {
      return new Promise((resolve, reject) => {
        const sock = createConnection({ host, port }, () => {
          sock.write(text, () => sock.end());
        });
        sock.on('error', reject);
        sock.on('close', () => resolve(true));
      });
    }

    function buildTextCopy(title, items) {
      const brand = process.env.BRAND_NAME || 'Pizzeria';
      const now   = format(new Date(), "dd/MM/yyyy HH:mm", { locale: it });
      let out = '';
      out += '\x1B!\x38'; // font doppia altezza/larghezza (ESC ! n)
      out += `${brand}\n`;
      out += '\x1B!\x00';
      out += `${title}  #${order.id}\n`;
      out += `Cliente: ${order.customer_name || '-'}  Tel: ${order.phone || '-'}\n`;
      out += `Quando: ${order.scheduled_at || now}\n`;
      out += '------------------------------\n';
      for (const it of items) {
        out += ` ${it.qty} x ${it.name}\n`;
        if (it.notes) out += `  * ${it.notes}\n`;
      }
      out += '------------------------------\n';
      out += '\n\n\n\x1DVA\x00'; // cut parziale
      return out;
    }

    if (pizItems.length) {
      await sendRaw(pizHost, pizPort, buildTextCopy('PIZZERIA', pizItems));
    }
    if (kitItems.length) {
      await sendRaw(kitHost, kitPort, buildTextCopy('CUCINA', kitItems));
    }

    log.info('🖨️  Comande stampate', { service: 'server', id: order.id });
    return { ok: true };
  } catch (err) {
    log.error('🖨️  orders_print_error ❌', { service: 'server', error: String(err) });
    return { ok: false, error: 'orders_print_error', reason: String(err) };
  }
}

// ROUTES ----------------------------------------------------------------------

// Lista ordini
router.get('/', async (req, res) => {
  try {
    const { from, to } = resolveRange(req.query);
    const whereStatus = statusWhere(req.query.status);
    const params = [from, to, ...statusParams(req.query.status)];
    const sql = `
      SELECT o.id, o.customer_name, o.phone, o.email, o.people, o.scheduled_at,
             o.note, o.channel, o.status, o.created_at, o.updated_at,
             (SELECT SUM(i.qty*i.price) FROM order_items i WHERE i.order_id=o.id) AS total
      FROM orders o
      WHERE o.created_at BETWEEN ? AND ?
        AND ${whereStatus}
      ORDER BY o.id DESC
      LIMIT 500
    `;
    const [rows] = await pool.query(sql, params);
    const mapped = rows.map(r => ({ ...r, total: r.total != null ? Number(r.total) : null }));
    res.json(mapped);
  } catch (err) {
    log.error('📦 ORDERS.list ❌', { service: 'server', error: String(err) });
    res.status(500).json({ ok: false, error: 'orders_list_error', reason: String(err) });
  }
});

// Dati aggregati per badge
router.get('/count-by-status', async (req, res) => {
  try {
    const { from, to } = resolveRange(req.query);
    const sql = `
      SELECT o.status, COUNT(*) AS n
      FROM orders o
      WHERE o.created_at BETWEEN ? AND ?
      GROUP BY o.status
    `;
    const [rows] = await pool.query(sql, [from, to]);
    const out = rows.reduce((acc, r) => { acc[r.status] = Number(r.n); return acc; }, {});
    res.json(out);
  } catch (err) {
    log.error('📦 ORDERS.countByStatus ❌', { service: 'server', error: String(err) });
    res.status(500).json({ ok: false, error: 'orders_count_error', reason: String(err) });
  }
});

// Dettaglio
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const header = await loadHeader(id);
    if (!header) return res.status(404).json({ ok: false, error: 'not_found' });
    const items = await loadItems(id);
    res.json({ ...header, items });
  } catch (err) {
    log.error('📦 ORDERS.get ❌', { service: 'server', error: String(err) });
    res.status(500).json({ ok: false, error: 'orders_get_error', reason: String(err) });
  }
});

// Crea ordine
router.post('/', async (req, res) => {
  const body = req.body || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO orders (customer_name, phone, email, people, scheduled_at, note, channel, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())`,
      [
        body.customer_name || null,
        body.phone ?? null,
        body.email ?? null,
        body.people ?? null,
        body.scheduled_at ?? null,
        body.note ?? null,
        body.channel || 'admin',
        'pending'
      ]
    );
    const orderId = r.insertId;
    const items = Array.isArray(body.items) ? body.items : [];
    for (const it of items) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_id, name, qty, price, notes, created_at)
         VALUES (?,?,?,?,?,?,NOW())`,
        [orderId, it.product_id ?? null, it.name, it.qty, it.price, it.notes ?? null]
      );
    }
    await conn.commit();

    const full = { ...(await loadHeader(orderId, conn)), items: await loadItems(orderId, conn) };
    // SSE → created
    bus.emit('created', { id: full.id, status: full.status });

    log.info('🧾 ORDERS.create ✅', { service: 'server', id: orderId, items: items.length });
    res.status(201).json(full);
  } catch (err) {
    await conn.rollback();
    log.error('🧾 ORDERS.create ❌', { service: 'server', error: String(err) });
    res.status(500).json({ ok: false, error: 'orders_create_error', reason: String(err) });
  } finally {
    conn.release();
  }
});

// Cambio stato
router.patch('/:id(\\d+)/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const next = String(req.body?.status || '').toLowerCase();
    await pool.query(`UPDATE orders SET status=?, updated_at=NOW() WHERE id=?`, [next, id]);

    const full = { ...(await loadHeader(id)), items: await loadItems(id) };

    // SSE → status
    bus.emit('status', { id, status: next });

    log.info('🔁 ORDERS.status ✅', { service: 'server', id, next });
    res.json(full);
  } catch (err) {
    log.error('🔁 ORDERS.status ❌', { service: 'server', error: String(err) });
    res.status(500).json({ ok: false, error: 'orders_status_error', reason: String(err) });
  }
});

// Stampa (compat 1): /orders/:id/print
router.post('/:id(\\d+)/print', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const full = { ...(await loadHeader(id)), items: await loadItems(id) };
    if (!full) return res.status(404).json({ ok: false, error: 'not_found' });
    const out = await printComande(full, req.body || {});
    if (!out.ok) return res.status(502).json(out);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'orders_print_error', reason: String(err) });
  }
});

// Stampa (compat 2): POST /orders/print { id }
router.post('/print', async (req, res) => {
  const id = Number(req.body?.id);
  if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });
  try {
    const full = { ...(await loadHeader(id)), items: await loadItems(id) };
    if (!full) return res.status(404).json({ ok: false, error: 'not_found' });
    const out = await printComande(full, req.body || {});
    if (!out.ok) return res.status(502).json(out);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'orders_print_error', reason: String(err) });
  }
});

// SSE stream
router.get('/stream', (req, res) => {
  // headers SSE
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders?.();

  log.info('🧵 ORDERS.stream ▶️ open', { service: 'server', ip: req.ip });

  // keep-alive (Heroku/Proxy friendly)
  const ping = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: "ok"\n\n`);
  }, 25000);

  const onCreated = (payload) => {
    res.write(`event: created\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const onStatus = (payload) => {
    res.write(`event: status\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  bus.on('created', onCreated);
  bus.on('status',  onStatus);

  req.on('close', () => {
    clearInterval(ping);
    bus.off('created', onCreated);
    bus.off('status',  onStatus);
    log.info('🧵 ORDERS.stream ⏹ close', { service: 'server', ip: req.ip });
  });
});

module.exports = router;
