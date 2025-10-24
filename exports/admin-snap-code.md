# 🧩 Project code (file ammessi in .)

_Generato: Fri, Oct 24, 2025  2:02:53 AM_

### ./package.json
```
{
    "name": "server-mysql",
    "version": "0.1.0",
    "type": "commonjs",
    "main": "src/server.js",
    "scripts": {
        "start": "node src/server.js",
        "dev": "cross-env NODE_ENV=development nodemon server.js"
    },
    "dependencies": {
        "bcryptjs": "3.0.2",
        "cors": "^2.8.5",
        "dotenv": "^16.4.5",
        "express": "^4.19.2",
        "iconv-lite": "0.7.0",
        "install": "0.13.0",
        "jq": "1.7.2",
        "jsonwebtoken": "9.0.2",
        "mysql2": "^3.10.0",
        "nodemailer": "7.0.10",
        "pngjs": "7.0.0",
        "socket.io": "^4.7.5",
        "winston": "^3.13.0",
        "winston-daily-rotate-file": "^4.7.1"
    },
    "devDependencies": {
        "cross-env": "^10.1.0",
        "nodemon": "^3.1.0",
        "tree-cli": "0.6.7"
    },
    "overrides": {}
}
```

### ./readme.md
```
Eliminare node_modules (progetto corrente)
rmdir /s /q node_modules

Windows (CMD/PowerShell)
rmdir /s /q .git
git init -b main
git add -A
git commit -m "feat: fresh start"

git checkout -b develop


Se il tuo git init non supporta -b main:

git init
git checkout -b main

-- git remote add origin https://github.com/endriazizi/enea_be.git
Collegare il nuovo remoto (facoltativo)
git remote add origin https://github.com/endriazizi/enea_be.git
git push -u origin main
git push -u origin develop

Consigli finali (best practice)

Branch protection sul remoto:

Proteggi main (niente push diretti, solo PR).

develop come branch di lavoro (puoi proteggerlo se vuoi PR anche lì).

Alias utili:

git config alias.lg "log --oneline --graph --decorate --all"
git lg```

### ./src/api/auth.js
```
// /api/auth — Login + Me (JWT HS256)
// Stile: log chiari, errori espliciti, dipendenze standard.

const express = require('express');
const router = express.Router();

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const env = require('../env');         // ✅ unica fonte di verità (contiene JWT)
const logger = require('../logger');   // ✅ winston instance
const { query } = require('../db');    // ✅ mysql2/promise pool
const requireAuth = require('../middleware/auth'); // Bearer verifier

// Helper robusto: crea JWT HS256
function signToken(user) {
  // Payload minimal: sub (user id), email e (opz.) roles
  const payload = {
    sub: user.id,
    email: user.email,
    roles: user.roles ? String(user.roles).split(',') : [] // se hai colonna roles (csv)
  };

  return jwt.sign(payload, env.JWT.secret, {
    algorithm: 'HS256',
    expiresIn: env.JWT.ttlSeconds
  });
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  logger.info('🔐 [AUTH] login ▶️', { email });

  // Validazione minima input
  if (!email || !password) {
    logger.warn('🔐 [AUTH] login ⚠️ missing fields', { email: !!email, password: !!password });
    return res.status(400).json({ error: 'missing_credentials' });
  }

  try {
    // 1) Cerca utente
    const rows = await query('SELECT * FROM users WHERE email=? LIMIT 1', [email]);
    const user = rows?.[0];

    if (!user) {
      logger.warn('🔐 [AUTH] login ❌ no_user', { email });
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    // 2) Verifica password (bcrypt)
    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) {
      logger.warn('🔐 [AUTH] login ❌ bad_password', { userId: user.id });
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    // 3) Firma token
    if (!env.JWT || !env.JWT.secret) {
      // 👇 Questo era il tuo errore: env.JWT undefined
      logger.error('🔐 [AUTH] login 💥 misconfigured JWT', { jwt: env.JWT });
      return res.status(500).json({ error: 'jwt_misconfigured' });
    }

    const token = signToken(user);

    // 4) Response “safe” (no campi sensibili)
    const safeUser = {
      id: user.id,
      email: user.email,
      name: user.name || user.full_name || null,
      roles: user.roles ? String(user.roles).split(',') : []
    };

    logger.info('🔐 [AUTH] login ✅', { userId: user.id });
    res.json({ token, user: safeUser });
  } catch (err) {
    logger.error('🔐 [AUTH] login 💥 error', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/auth/me  (protetta da Bearer)
// Usa middleware che decodifica JWT e attacca req.user (id/email/roles).
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.sub;
    const rows = await query('SELECT id, email, name, roles FROM users WHERE id=? LIMIT 1', [userId]);
    const user = rows?.[0] || null;
    if (!user) return res.status(404).json({ error: 'not_found' });
    res.json({
      id: user.id,
      email: user.email,
      name: user.name || null,
      roles: user.roles ? String(user.roles).split(',') : []
    });
  } catch (err) {
    logger.error('🔐 [AUTH] me 💥 error', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
```

### ./src/api/health.js
```
// src/api/health.js
// Endpoints di diagnostica. /api/health/time mostra orari server+DB.

const router = require('express').Router();
const { query } = require('../db');

router.get('/time', async (_req, res) => {
  try {
    const now = new Date();
    const app = {
      nowLocal: now.toString(),          // locale del server
      nowUTC: now.toISOString(),         // UTC
      tzResolved: Intl.DateTimeFormat().resolvedOptions().timeZone || '(unknown)',
      envTZ: process.env.TZ || '(unset)'
    };

    const rows = await query(`
      SELECT 
        NOW()              AS dbNowLocal, 
        UTC_TIMESTAMP()    AS dbNowUTC,
        @@time_zone        AS dbTimeZone,
        TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS dbOffsetMinutes
    `);

    const db = rows && rows[0] ? rows[0] : {};

    res.json({ ok: true, app, db });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

module.exports = router;
```

### ./src/api/orders.js
```
// src/api/orders.js
const express = require('express');
const router = express.Router();

const logger = require('../logger');      // ✅ winston
const { query } = require('../db');       // ✅ mysql2/promise pool

// 🔧 helper: carica un ordine con items
async function hydrateOrder(orderId) {
  const [order] = await query('SELECT * FROM orders WHERE id=?', [orderId]);
  if (!order) return null;
  const items = await query('SELECT * FROM order_items WHERE order_id=?', [orderId]);
  return { ...order, items }; // <-- FIX: spread corretto
}

// GET /api/orders  → tutti (solo header, senza items)
// Per caricare la board rapidamente
router.get('/', async (req, res) => {
  try {
    logger.info('📥 [GET] /api/orders (all headers)');
    const rows = await query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/orders', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/orders/all → alias, con hydrate (items inclusi)
router.get('/all', async (req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/all (hydrate each)');
    const heads = await query('SELECT id FROM orders ORDER BY created_at DESC');
    const full = [];
    for (const h of heads) {
      const o = await hydrateOrder(h.id);
      if (o) full.push(o);
    }
    res.json(full);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/all', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/orders/pending
router.get('/pending', async (req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/pending');
    const rows = await query('SELECT * FROM orders WHERE status="pending" ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/pending', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/orders/completed
router.get('/completed', async (req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/completed');
    const rows = await query('SELECT * FROM orders WHERE status="completed" ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/completed', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/orders/today  → ultimi 24h
router.get('/today', async (req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/today (last 24h)');
    const rows = await query(
      'SELECT * FROM orders WHERE created_at >= NOW() - INTERVAL 1 DAY ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/today', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/orders/:id  → dettaglio + items
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    logger.info('📥 [GET] /api/orders/:id', { id });
    const full = await hydrateOrder(id);
    if (!full) return res.status(404).json({ error: 'not_found' });
    res.json(full);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/:id', { id, error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// PATCH /api/orders/:id/status  → aggiorna stato (pending|confirmed|preparing|ready|completed)
router.patch('/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  try {
    logger.info('✏️ [PATCH] /api/orders/:id/status', { id, body: req.body });

    const valid = ['pending', 'confirmed', 'preparing', 'ready', 'completed'];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: 'invalid_status', valid });
    }

    await query('UPDATE orders SET status=? WHERE id=?', [status, id]);
    res.json({ ok: true, id, status });
  } catch (err) {
    logger.error('❌ [PATCH] /api/orders/:id/status', { id, error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
```

### ./src/api/printer.js
```
// server/src/api/printer.js
const express = require('express');
const net = require('net');
const { printOrder, loadPrinterCfg } = require('../utils/print');

const router = express.Router();

router.get('/printer/health', (req, res) => {
  const cfg = loadPrinterCfg();
  if (!cfg.enabled) return res.json({ ok: false, reason: 'disabled', cfg });

  const socket = new net.Socket();
  socket.setTimeout(1500);

  socket.once('connect', () => { socket.destroy(); res.json({ ok: true, cfg }); });
  socket.once('timeout', () => { socket.destroy(); res.status(504).json({ ok: false, reason: 'timeout', cfg }); });
  socket.once('error', (e) => { socket.destroy(); res.status(502).json({ ok: false, reason: e.code || e.message, cfg }); });

  try { socket.connect(cfg.port, cfg.ip); } catch (e) { res.status(500).json({ ok: false, reason: e.message, cfg }); }
});

router.post('/printer/test', async (req, res) => {
  try {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const order = {
      id: 'TEST',
      created_at: now,
      items: [
        { qty: 1, name: 'Margherita', price: 6.5 },
        { qty: 2, name: 'Diavola', price: 8.0, notes: 'Piccante 🔥' },
      ],
      total: 22.5,
    };
    await printOrder(order); // usa cfg da env
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ ok: false, reason: e.code || e.message });
  }
});

module.exports = router;
```

### ./src/api/products.js
```
// 🌐 REST: lista prodotti attivi
const router = require('express').Router();                 // istanzia router
const { query } = require('../db');                         // query wrapper con log

router.get('/', async (req, res, next) => {                 // GET /api/products
  try {
    const rows = await query('SELECT * FROM products WHERE is_active=1 ORDER BY category, name'); // query
    res.json(rows);                                         // risponde con JSON
  } catch (e) {
    next(e);                                                // passa all'error handler globale
  }
});

module.exports = router;                                    // esporta router
```

### ./src/api/reservations.js
```
'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../logger');
const svc = require('../services/reservations.service');           // CRUD/base
const resvActions = require('../services/reservations-status.service'); // status + audit
const printerSvc = require('../services/thermal-printer.service'); // stampa
const env = require('../env');

// === auth con fallback DEV ===================================================
let requireAuth;
try {
  ({ requireAuth } = require('./auth'));
  if (typeof requireAuth !== 'function') throw new Error('requireAuth non è una funzione');
  logger.info('🔐 requireAuth caricato da ./auth');
} catch {
  logger.warn('⚠️ requireAuth non disponibile. Uso FALLBACK DEV (solo locale).');
  requireAuth = (req, _res, next) => { req.user = { id: 0, email: 'dev@local' }; next(); };
}

// ============================ LIST/GET/POST/PATCH/DELETE =====================

router.get('/', async (req, res) => {
  try {
    const filter = {
      status: req.query.status || undefined,
      from  : req.query.from   || undefined,
      to    : req.query.to     || undefined,
      q     : req.query.q      || undefined
    };
    logger.info('📥 [GET] /api/reservations', { filter });
    const rows = await svc.list(filter);
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// Supporto UI
router.get('/rooms', async (_req, res) => {
  try { res.json(await svc.listRooms()); }
  catch (err) {
    logger.error('❌ /rooms', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/support/tables/by-room/:roomId(\\d+)', async (req, res) => {
  try { res.json(await svc.listTablesByRoom(Number(req.params.roomId))); }
  catch (err) {
    logger.error('❌ /support/tables/by-room', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/support/count-by-status', async (req, res) => {
  try { res.json(await svc.countByStatus({ from: req.query.from, to: req.query.to })); }
  catch (err) {
    logger.error('❌ /support/count-by-status', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// Dettaglio
router.get('/:id(\\d+)', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  try {
    const r = await svc.getById(id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    res.json(r);
  } catch (err) {
    logger.error('❌ [GET] /:id', { id, error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// Crea
router.post('/', async (req, res) => {
  try {
    const created = await svc.create(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    logger.error('❌ [POST] /', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// Aggiorna parziale
router.patch('/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    const updated = await svc.update(Number(req.params.id), req.body || {});
    res.json(updated);
  } catch (err) {
    const code = err.statusCode || 500;
    logger.error('❌ [PATCH] /:id', { error: String(err) });
    res.status(code).json({ error: err.message || 'internal_error' });
  }
});

// Elimina
router.delete('/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    await svc.remove(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    const code = err.statusCode || 500;
    logger.error('❌ [DELETE] /:id', { error: String(err) });
    res.status(code).json({ error: err.message || 'internal_error' });
  }
});

// ============================ CAMBIO STATO + MAIL ============================

router.put('/:id(\\d+)/status', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { action, reason } = req.body || {};
    if (!id || !action) return res.status(400).json({ error: 'id e action sono obbligatori' });

    const updated = await resvActions.updateStatus({
      reservationId: id,
      action,
      reason: typeof reason === 'string' ? reason.trim() : null,
      user: req.user,
    });

    return res.json({ ok: true, reservation: updated });
  } catch (err) {
    const code = err.statusCode || 500;
    logger.error('❌ status change failed', { err: String(err) });
    return res.status(code).json({ error: err.sqlMessage || err.message });
  }
});

// ================================ STAMPA =====================================

router.post('/print/daily', requireAuth, async (req, res) => {
  try {
    const date = (req.body?.date || new Date().toISOString().slice(0,10));
    const status = req.body?.status || 'all';
    const rows = await svc.list({ from: date, to: date, status });
    logger.info('🧾 print/daily', { date, status, rows: rows.length });
    const out = await printerSvc.printDailyReservations({ date, rows, user: req.user });
    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/daily', { error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

router.post('/print/placecards', requireAuth, async (req, res) => {
  try {
    const date = (req.body?.date || new Date().toISOString().slice(0,10));
    const status = req.body?.status || 'accepted';
    const qrBaseUrl = req.body?.qr_base_url || env.QR_BASE_URL || '';
    const rows = await svc.list({ from: date, to: date, status });
    logger.info('🧾 print/placecards', { date, status, rows: rows.length });
    const out = await printerSvc.printPlaceCards({
      date, rows, user: req.user,
      logoText: env.BIZ_NAME,
      qrBaseUrl
    });
    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/placecards', { error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Segnaposto singolo
router.post('/:id(\\d+)/print/placecard', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });

    const r = await svc.getById(id);
    if (!r) return res.status(404).json({ error: 'not_found' });

    const qrBaseUrl = req.body?.qr_base_url || env.QR_BASE_URL || '';

    const out = await printerSvc.printPlaceCards({
      date: (r.start_at || '').toString().slice(0, 10),
      rows: [r],
      user: req.user,
      logoText: env.BIZ_NAME,
      qrBaseUrl,
    });

    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/placecard (single)', { error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

module.exports = router;
```

### ./src/api/rooms.js
```
// src/api/rooms.js
const express = require('express');
const router = express.Router();

const logger = require('../logger');
const { query } = require('../db');

// GET /api/rooms → tutte le sale attive
router.get('/', async (req, res) => {
  try {
    logger.info('📥 [GET] /api/rooms');
    const rows = await query(
      'SELECT id, name, is_active, sort_order FROM rooms WHERE is_active=1 ORDER BY sort_order, name'
    );
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/rooms', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// (Opzionali) POST / PATCH  — li tieni per il futuro
// router.post('/', ...)
// router.patch('/:id', ...)

module.exports = router;
```

### ./src/api/tables.js
```
// src/api/tables.js
// Router TAVOLI
// - Lista tutti i tavoli
// - Lista per sala (by-room/:roomId)
// - Cambio stato tavolo (PATCH /:id/status)
// NOTE:
//   • Non usiamo campi inesistenti nel tuo schema (es: "label").
//   • Generiamo un alias "label" leggibile con i campi REALI (table_number/id).
//   • Log verbosi con emoji per debug chiaro.

const express = require('express');
const router = express.Router();
const { query } = require('../db');
const logger = require('../logger');

// Helper per label leggibile: Tavolo <num> o fallback all'id
const LABEL_EXPR = `CONCAT('Tavolo ', COALESCE(CAST(t.table_number AS CHAR), CAST(t.id AS CHAR)))`;

// ---------------------------------------------------------------------------
// GET /api/tables  → tutti i tavoli
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    logger.info('📥 [GET] /api/tables');

    const rows = await query(
      `
      SELECT
        t.id,
        t.room_id,
        t.table_number,
        t.seats          AS capacity,
        t.status,
        ${LABEL_EXPR}    AS label,
        t.updated_at
      FROM tables t
      ORDER BY t.room_id IS NULL, t.room_id, t.table_number IS NULL, t.table_number, t.id
      `,
      []
    );

    logger.info('📤 tables rows', { count: rows.length });
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/tables', { error: String(err) });
    res.status(500).json({ error: 'Tables list failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/tables/by-room/:roomId  → tavoli di una sala
// ---------------------------------------------------------------------------
router.get('/by-room/:roomId', async (req, res) => {
  const roomId = Number(req.params.roomId);
  try {
    logger.info('📥 [GET] /api/tables/by-room/:roomId', { roomId });

    if (!Number.isFinite(roomId)) {
      return res.status(400).json({ error: 'roomId non valido' });
    }

    const rows = await query(
      `
      SELECT
        t.id,
        t.room_id,
        t.table_number,
        t.seats          AS capacity,
        t.status,
        ${LABEL_EXPR}    AS label,
        t.updated_at
      FROM tables t
      WHERE t.room_id = ?
      ORDER BY t.table_number IS NULL, t.table_number, t.id
      `,
      [roomId]
    );

    logger.info('📤 tables/by-room rows', { count: rows.length });
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/tables/by-room/:roomId', { roomId, error: String(err) });
    res.status(500).json({ error: 'Tables by room failed' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/tables/:id/status  → cambia stato (free|reserved|occupied)
// ---------------------------------------------------------------------------
router.patch('/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  try {
    logger.info('📥 [PATCH] /api/tables/:id/status', { id, status });

    const allowed = ['free', 'reserved', 'occupied'];
    if (!Number.isFinite(id) || !allowed.includes(String(status))) {
      return res.status(400).json({ error: 'Parametri non validi' });
    }

    const sql = `UPDATE tables SET status=? , updated_at = CURRENT_TIMESTAMP WHERE id=?`;
    await query(sql, [status, id]);

    logger.info('✅ table status updated', { id, status });
    res.json({ ok: true, id, status });
  } catch (err) {
    logger.error('❌ [PATCH] /api/tables/:id/status', { id, error: String(err) });
    res.status(500).json({ error: 'Update table status failed' });
  }
});

module.exports = router;
```

### ./src/config.js
```
// Carica variabili ambiente e fornisce valori default
require('dotenv').config();


module.exports = {
port: Number(process.env.PORT || 3000),
db: {
host: process.env.DB_HOST || 'localhost',
user: process.env.DB_USER || 'root',
password: process.env.DB_PASSWORD || '',
name: process.env.DB_NAME || 'pizzeria'
},
corsWhitelist: (process.env.CORS_WHITELIST || 'http://localhost:8100,http://localhost:8101')
.split(',')
.map(s => s.trim())
.filter(Boolean),
printerIp: process.env.PRINTER_IP || '192.168.1.50',
logs: {
dir: process.env.LOG_DIR || './logs',
level: process.env.LOG_LEVEL || 'info',
maxFiles: process.env.LOG_MAX_FILES || '14d',
maxSize: process.env.LOG_MAX_SIZE || '10m'
}
};```

### ./src/controllers/productsContreller.js
```
const productService = require('../services/product.service');

module.exports = {
  getAll: async (req, res) => {
    try {
      const products = await productService.getAll();
      res.json(products);
    } catch (err) {
      res.status(500).json({ message: "Errore recupero prodotti" });
    }
  },

  getById: async (req, res) => {
    try {
      const product = await productService.getById(Number(req.params.id));
      if (!product) return res.status(404).json({ message: "Prodotto non trovato" });
      res.json(product);
    } catch (err) {
      res.status(500).json({ message: "Errore recupero prodotto" });
    }
  },

  create: async (req, res) => {
    try {
      const newProduct = await productService.create(req.body);
      res.status(201).json(newProduct);
    } catch (err) {
      res.status(500).json({ message: "Errore creazione prodotto" });
    }
  },

  update: async (req, res) => {
    try {
      const updatedProduct = await productService.update(Number(req.params.id), req.body);
      if (!updatedProduct) return res.status(404).json({ message: "Prodotto non trovato" });
      res.json(updatedProduct);
    } catch (err) {
      res.status(500).json({ message: "Errore aggiornamento prodotto" });
    }
  },

  remove: async (req, res) => {
    try {
      const deleted = await productService.remove(Number(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Prodotto non trovato" });
      res.json({ message: "Prodotto eliminato" });
    } catch (err) {
      res.status(500).json({ message: "Errore eliminazione prodotto" });
    }
  }
};
```

### ./src/cors.js
```
const mysql = require('mysql2/promise');
const cfg = require('./config');
const logger = require('./logger');


let pool;


async function getPool() {
if (!pool) {
logger.info({ msg: 'DB: creating pool', host: cfg.db.host, db: cfg.db.name });
pool = mysql.createPool({
host: cfg.db.host,
user: cfg.db.user,
password: cfg.db.password,
database: cfg.db.name,
waitForConnections: true,
connectionLimit: 10
});
}
return pool;
}


async function query(sql, params = []) {
const p = await getPool();
const start = Date.now();
const [rows] = await p.query(sql, params);
const ms = Date.now() - start;
logger.info({ msg: 'DB query', sql, params, rowsCount: Array.isArray(rows) ? rows.length : 0, ms });
return rows;
}


module.exports = { getPool, query };```

### ./src/db/index.js
```
// src/db/index.js
// Pool MySQL + query() con log. Sessione forzata in UTC, dateStrings per evitare shift.

const mysql = require('mysql2/promise');
const env = require('../env');
const logger = require('../logger');

const pool = mysql.createPool({
  host: env.DB.host,
  port: env.DB.port,
  user: env.DB.user,
  password: env.DB.password,
  database: env.DB.database,
  waitForConnections: env.DB.waitForConnections,
  connectionLimit: env.DB.connectionLimit,
  queueLimit: env.DB.queueLimit,
  // 🔑 IMPORTANTI per time:
  dateStrings: true,   // DATETIME come stringa → niente auto-conversione a Date locale
  timezone: 'Z' ,       // ‘Z’ = UTC per le conversioni lato driver (di fatto con dateStrings non incide, ma è esplicito)
   multipleStatements: true // <-- AGGIUNGI QUESTO
});

// Forza la sessione MySQL a UTC
async function ensureUtcSession() {
  try {
    await pool.query(`SET time_zone = '+00:00'`);
    logger.info('🕒 DB session time_zone set to UTC (+00:00)');
  } catch (err) {
    logger.warn('⚠️ DB time_zone SET failed (continuo lo stesso)', { error: String(err) });
  }
}

async function query(sql, params = []) {
  const t0 = Date.now();
  try {
    const [rows] = await pool.query(sql, params);
    const ms = (Date.now() - t0).toFixed(0);
    logger.info('🐬 SQL ✅', { duration_ms: ms, sql: shorten(sql), params });
    return rows;
  } catch (err) {
    const ms = (Date.now() - t0).toFixed(0);
    logger.error('🐬 SQL ❌', { duration_ms: ms, error: String(err), sql: shorten(sql), params });
    throw err;
  }
}

// log più leggibile
function shorten(s, max = 320) {
  if (!s) return s;
  const one = String(s).replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '…[truncated]' : one;
}

module.exports = { pool, query, ensureUtcSession };
```

### ./src/db/migrator.js
```
// 🧰 Migrator: esegue tutti i file .sql in /migrations in ordine e li registra.
// Idempotente: salta le già applicate. Sanifica BOM e alcune direttive SET iniziali.

const fs = require('fs');
const path = require('path');
const { query } = require('./index');
const logger = require('../logger');

function sanitizeSql(raw) {
  // Rimuovi BOM, normalizza newline
  let sql = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  // Opzionale: togli direttive SET comuni (non indispensabili)
  sql = sql
    .replace(/^\s*SET\s+NAMES\s+utf8mb4\s*;\s*/gim, '')
    .replace(/^\s*SET\s+time_zone\s*=\s*['"][^'"]+['"]\s*;\s*/gim, '');

  return sql.trim();
}

async function runMigrations() {
  // Tabella tracking
  await query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(200) NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) {
    logger.warn('🧰 MIGRATION ⚠️ cartella mancante', { dir });
    return;
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const applied = await query(`SELECT filename FROM migrations ORDER BY id`);
  const appliedSet = new Set(applied.map(r => r.filename));

  for (const f of files) {
    if (appliedSet.has(f)) {
      logger.info('🧰 MIGRATION ⏭️ skip (già applicata)', { file: f });
      continue;
    }
    const full = path.join(dir, f);
    const raw = fs.readFileSync(full, 'utf8');
    const sql = sanitizeSql(raw);

    logger.info('🧰 MIGRATION ▶️ apply', { file: f });
    try {
      // Grazie a multipleStatements: true possiamo inviare il file intero
      await query(sql);
      await query(`INSERT INTO migrations (filename) VALUES (?)`, [f]);
      logger.info('🧰 MIGRATION ✅ done', { file: f });
    } catch (e) {
      logger.error('🧰 MIGRATION ❌ failed', { file: f, error: String(e) });
      throw e; // meglio fallire che partire con DB a metà
    }
  }

  logger.info('🧰 MIGRATION ✅ all up to date', { total: files.length });
}

module.exports = { runMigrations };
```

### ./src/db/schema-check.js
```
// src/db/schema-check.js
// 🔎 Verifica schema DB all'avvio: stampa colonne reali e confronta con "atteso".
// Utile per beccare subito mismatch (es. colonne mancanti o tipi diversi) prima che esplodano le query.
//
// NOTE:
// - L'oggetto EXPECTED qui sotto è già allineato a quanto hai nel DB reale (dai log che hai condiviso).
// - Se in futuro cambi lo schema (tipi, nullabilità, enum, nuove colonne), aggiorna SOLO EXPECTED.
// - I log mostreranno:
//     🧩 SCHEMA ▶️ <tabella> (elenco colonne reali)
//     ⚠️ SCHEMA <tabella>: difformità rilevate  → se c'è mismatch
//     ✅ SCHEMA <tabella>: OK (match atteso)     → se è tutto in regola

const { query } = require('./index');
const logger = require('../logger');

// 🔁 Schema atteso (allineato al tuo DB reale dai log dell'ultimo avvio)
const EXPECTED = {
  rooms: {
    // DB reale: id = BIGINT NOT NULL
    id: { data_type: 'bigint', nullable: 'NO' },
    name: { data_type: 'varchar', nullable: 'NO' },
    is_active: { data_type: 'tinyint', nullable: 'YES' },
    // DB reale: sort_order = int NOT NULL
    sort_order: { data_type: 'int', nullable: 'NO' },
    // DB reale: created_at = timestamp NOT NULL
    created_at: { data_type: 'timestamp', nullable: 'NO' },
  },

  tables: {
    id: { data_type: 'int', nullable: 'NO' },
    // Abbiamo normalizzato: room_id = BIGINT per matchare rooms.id, NULLABLE
    room_id: { data_type: 'bigint', nullable: 'YES' },
    // DB reale: table_number = int NOT NULL
    table_number: { data_type: 'int', nullable: 'NO' },
    seats: { data_type: 'int', nullable: 'YES' },
    status: {
      data_type: 'enum', nullable: 'YES',
      column_type: "enum('free','reserved','occupied')"
    },
    // DB reale: updated_at = timestamp NOT NULL
    updated_at: { data_type: 'timestamp', nullable: 'NO' },
  },

  users: {
  id:         { data_type: 'bigint',   nullable: 'NO'  },
  first_name: { data_type: 'varchar',  nullable: 'YES' },
  last_name:  { data_type: 'varchar',  nullable: 'YES' },
  email:      { data_type: 'varchar',  nullable: 'YES' },
  phone:      { data_type: 'varchar',  nullable: 'YES' },
  created_at: { data_type: 'timestamp',nullable: 'NO'  },
  updated_at: { data_type: 'timestamp',nullable: 'YES' },
},

  reservations: {
    id: { data_type: 'bigint', nullable: 'NO' },
    customer_first: { data_type: 'varchar', nullable: 'YES' },
    customer_last: { data_type: 'varchar', nullable: 'YES' },
    phone: { data_type: 'varchar', nullable: 'YES' },
    email: { data_type: 'varchar', nullable: 'YES' },
    user_id: { data_type: 'bigint', nullable: 'YES' }, // 👈 aggiungi
    party_size: { data_type: 'int', nullable: 'NO' },
    start_at: { data_type: 'datetime', nullable: 'NO' },
    end_at: { data_type: 'datetime', nullable: 'NO' },
    notes: { data_type: 'varchar', nullable: 'YES' },
    status: {
      data_type: 'enum', nullable: 'YES',
      column_type: "enum('pending','accepted','rejected','cancelled')"
    },
    status_note: { data_type: 'text', nullable: 'YES' }, // 👈 aggiungi
    status_changed_at: { data_type: 'timestamp', nullable: 'YES' }, // 👈 aggiungi
    client_token: { data_type: 'varchar', nullable: 'YES' },
    table_id: { data_type: 'int', nullable: 'YES' },
    created_at: { data_type: 'timestamp', nullable: 'NO' },
  }

};

async function fetchColumns(table) {
  const rows = await query(`
    SELECT
      COLUMN_NAME        AS name,
      DATA_TYPE          AS data_type,
      IS_NULLABLE        AS nullable,
      COLUMN_TYPE        AS column_type,
      COLUMN_KEY         AS column_key,
      ORDINAL_POSITION   AS pos
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = ?
    ORDER BY ORDINAL_POSITION
  `, [table]);

  // Map normalizzato (chiavi lowercase) per robustezza
  const map = {};
  for (const r of rows) {
    map[String(r.name).toLowerCase()] = {
      data_type: String(r.data_type).toLowerCase(),
      nullable: String(r.nullable).toUpperCase(),
      column_type: r.column_type ? String(r.column_type).toLowerCase() : null,
      column_key: r.column_key || '',
      pos: r.pos
    };
  }
  return { list: rows, map };
}

function diffTable(_table, got, exp) {
  const diffs = { missing: [], extra: [], typeMismatch: [] };

  // Colonne attese ma mancanti
  Object.keys(exp).forEach(k => {
    if (!got.map[k]) diffs.missing.push(k);
  });

  // Colonne “extra” nel DB reale (non previste)
  Object.keys(got.map).forEach(k => {
    if (!exp[k]) diffs.extra.push(k);
  });

  // Differenze su tipo / nullabilità / enum
  Object.keys(exp).forEach(k => {
    const g = got.map[k];
    if (!g) return;
    const e = exp[k];
    const mismatch = [];
    if (e.data_type && g.data_type !== e.data_type) mismatch.push(`type: ${g.data_type} ≠ ${e.data_type}`);
    if (e.nullable && g.nullable !== e.nullable) mismatch.push(`null: ${g.nullable} ≠ ${e.nullable}`);
    if (e.column_type && g.column_type !== e.column_type) mismatch.push(`column_type: ${g.column_type} ≠ ${e.column_type}`);
    if (mismatch.length) diffs.typeMismatch.push({ column: k, details: mismatch.join(', ') });
  });

  return diffs;
}

async function checkOne(table) {
  try {
    const got = await fetchColumns(table);
    const exp = EXPECTED[table] || {};
    const diffs = diffTable(table, got, exp);

    // 📋 Dump “reale” leggibile (ordine naturale)
    logger.info(`🧩 SCHEMA ▶️ ${table} (reale)`, {
      columns: got.list.map(c => ({
        pos: c.pos,
        name: c.name,
        data_type: c.data_type,
        nullable: c.nullable,
        column_type: c.column_type,
        key: c.column_key
      }))
    });

    if (!Object.keys(exp).length) {
      logger.warn(`⚠️ SCHEMA ${table}: non ho un "atteso" definito, mi limito a stampare le colonne reali.`);
      return;
    }

    // Diff sintetico
    if (diffs.missing.length || diffs.extra.length || diffs.typeMismatch.length) {
      logger.warn(`⚠️ SCHEMA ${table}: difformità rilevate`, diffs);
    } else {
      logger.info(`✅ SCHEMA ${table}: OK (match atteso)`);
    }
  } catch (err) {
    logger.error(`❌ SCHEMA ${table}: errore durante il check`, { error: String(err) });
  }
}

async function runSchemaCheck() {
  logger.info('🔎 SCHEMA CHECK ▶️ start');
  const tables = Object.keys(EXPECTED);
  for (const t of tables) {
    // sequenziale per log ordinati
    // eslint-disable-next-line no-await-in-loop
    await checkOne(t);
  }
  logger.info('🔎 SCHEMA CHECK ✅ done');
}

module.exports = { runSchemaCheck };
```

### ./src/env.js
```
'use strict';

/**
 * Loader centralizzato env + piccoli helper.
 * Mantieni questo file dove sta (src/env.js).
 */

const fs = require('fs');
const path = require('path');

// Carico .env se presente (non fallire se manca)
try {
  const dotenvPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(dotenvPath)) {
    require('dotenv').config({ path: dotenvPath });
  }
} catch (_) {}

/* === Helpers === */
function toBool(v, def = false) {
  if (v === undefined || v === null || String(v).trim() === '') return def;
  const s = String(v).toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(s);
}
function toInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function mask(value, front = 2, back = 2) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= front + back) return '*'.repeat(s.length);
  return s.slice(0, front) + '*'.repeat(s.length - front - back) + s.slice(-back);
}

/* === Config === */
const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',

  PORT: toInt(process.env.PORT, 3000),

  // CORS (lista separata da virgola)
  CORS_WHITELIST: (process.env.CORS_WHITELIST || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  DB: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: toInt(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'app',
  },

  LOG: {
    dir: process.env.LOG_DIR || './logs',
    retentionDays: toInt(process.env.LOG_RETENTION_DAYS, 14),
    level: process.env.LOG_LEVEL || 'info',
  },

  RESV: {
    // Durate “di default” se le usi per end_at
    defaultLunchMinutes : toInt(process.env.RESV_LUNCH_MINUTES, 60),
    defaultDinnerMinutes: toInt(process.env.RESV_DINNER_MINUTES, 90),

    // Override già presente in passato
    allowAcceptOverride : toBool(process.env.RESV_ALLOW_ACCEPT_OVERRIDE, false),

    // ✅ Nuovi flag
    allowBacktrack      : toBool(process.env.RESV_ALLOW_BACKTRACK, true),
    allowAnyTransition  : toBool(process.env.RESV_ALLOW_ANY_TRANSITION, true),
    forceTransitions    : toBool(process.env.RESV_FORCE_TRANSITIONS, false),

    // Email: invia sempre notifica su cambio stato?
    notifyAlways        : toBool(process.env.RESV_NOTIFY_ALWAYS, true),
  },

  // Email / SMTP
  MAIL: {
    enabled: toBool(process.env.MAIL_ENABLED, true),
    host   : process.env.SMTP_HOST || 'smtp.gmail.com',
    port   : toInt(process.env.SMTP_PORT, 587),
    secure : toBool(process.env.SMTP_SECURE, false),
    user   : process.env.SMTP_USER || '',
    pass   : process.env.SMTP_PASS || '',
    from   : process.env.MAIL_FROM || 'Prenotazioni <no-reply@example.com>',
    replyTo: process.env.MAIL_REPLY_TO || '',
    bizName: process.env.BIZ_NAME || 'La Mia Attività',
  },

  // Util per debugging a runtime delle variabili
  _debugMailConfig() {
    const m = env.MAIL;
    return {
      enabled: m.enabled,
      host: m.host,
      port: m.port,
      secure: m.secure,
      user: mask(m.user, 3, 2),
      from: m.from,
      replyTo: m.replyTo,
      bizName: m.bizName,
      resvNotifyAlways: env.RESV.notifyAlways,
    };
  },
};

module.exports = env;
```

### ./src/logger.js
```
// Logger Winston con console + (opzionale) rotate su file.
// Exportiamo direttamente l'istanza (non { logger }) per evitare "info is not a function".

const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const isProd = (process.env.NODE_ENV || 'development') === 'production';

const logger = createLogger({
  level: isProd ? 'info' : 'debug',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: 'server' },
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(info => {
          const { level, message, timestamp, ...rest } = info;
          return `${timestamp} ${level} ${message} ${Object.keys(rest).length ? JSON.stringify(rest) : ''}`;
        })
      )
    }),
    new DailyRotateFile({
      dirname: 'logs',
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '5m',
      maxFiles: '14d',
      zippedArchive: true
    })
  ]
});

module.exports = logger;
```

### ./src/log-http.js
```
const logger = require('./logger');


module.exports = function httpLogger(req, res, next) {
const start = Date.now();
const { method, url, headers } = req;
const reqBody = req.body; // express.json già attivo in server.js


// intercetta res.send/res.json per catturare il body
const oldJson = res.json.bind(res);
const oldSend = res.send.bind(res);
let respBody;


res.json = (data) => { respBody = data; return oldJson(data); };
res.send = (data) => { respBody = data; return oldSend(data); };


res.on('finish', () => {
const ms = Date.now() - start;
// Evita log eccessivi: limita response a 2048 caratteri
const respPreview = typeof respBody === 'string' ? respBody : JSON.stringify(respBody);
const limitedResp = respPreview?.length > 2048 ? respPreview.slice(0, 2048) + '...[truncated]' : respPreview;


logger.info({
msg: 'HTTP', method, url, status: res.statusCode, ms, headers,
reqBody,
respBody: limitedResp
});
});


next();
};```

### ./src/middleware/auth.js
```
'use strict';

// src/middleware/auth.js
// JWT guard con bypass DEV opzionale. Mantiene il tuo stile di log.

const jwt = require('jsonwebtoken');
const env = require('../env');
const logger = require('../logger');

/** Estrae il token da Authorization / header custom / cookie */
function extractToken(req) {
  const h = req.headers['authorization'] || req.headers['Authorization'];
  if (h && typeof h === 'string') {
    const [type, token] = h.split(' ');
    if (/^Bearer$/i.test(type) && token) return token.trim();
  }
  const x = req.headers['x-access-token'];
  if (typeof x === 'string' && x.trim()) return x.trim();
  if (req.cookies && req.cookies.token) return req.cookies.token;
  return null;
}

/** Middleware principale */
function requireAuth(req, res, next) {
  const token = extractToken(req);

  // Nessun token → bypass DEV (se abilitato), altrimenti 401
  if (!token) {
    if (env.AUTH.devBypass) {
      logger.warn('🔓 AUTH DEV BYPASS (no token)', { path: req.path });
      req.user = { id: env.AUTH.devUserId, email: env.AUTH.devUserEmail };
      return next();
    }
    logger.warn('🔒 AUTH missing token', { path: req.path });
    return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Missing token' });
  }

  // Verifica JWT
  try {
    const payload = jwt.verify(token, env.JWT.secret);
    req.user = {
      id: payload.sub || payload.id || payload.userId || 0,
      email: payload.email || 'user@unknown',
    };
    return next();
  } catch (err) {
    if (env.AUTH.devBypass) {
      logger.warn('🔓 AUTH DEV BYPASS (invalid token)', { path: req.path, error: String(err) });
      req.user = { id: env.AUTH.devUserId, email: env.AUTH.devUserEmail };
      return next();
    }
    logger.warn('🔒 AUTH invalid/expired token', { path: req.path, error: String(err) });
    return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Invalid or expired token' });
  }
}

/** Utility opzionale per emettere un token (se ti serve nel login) */
function issueToken(user) {
  const payload = { sub: user.id, email: user.email };
  return jwt.sign(payload, env.JWT.secret, { expiresIn: env.JWT.ttlSeconds + 's' });
}

module.exports = requireAuth;
module.exports.requireAuth = requireAuth;
module.exports.issueToken = issueToken;
```

### ./src/middleware/reqres-logger.js
```
// 🌐 Middleware logging: stampa request e response body (⚠️ attenzione in prod)
const logger = require('../logger');   // ✅ istanza diretta

// genera un id richiesta per correlare i log
const rid = () => 'r-' + Math.random().toString(36).slice(2, 8);

module.exports = function reqResLogger(req, res, next) {
  const id = rid();
  const start = Date.now();

  logger.info('🔌 HTTP ▶️ REQUEST', {
    id, method: req.method, url: req.originalUrl, query: req.query,
    headers: { 'user-agent': req.headers['user-agent'], 'content-type': req.headers['content-type'] },
    body: req.body
  });

  const _json = res.json.bind(res);
  res.json = (payload) => { logger.info('🔌 HTTP 📤 RESPONSE BODY', { id, payload }); return _json(payload); };

  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.info('🔌 HTTP ✅ RESPONSE', { id, status: res.statusCode, duration_ms: ms });
  });

  next();
}
```

### ./src/server.js
```
// src/server.js
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');

const env = require('./env');          // carica .env e config
const logger = require('./logger');    // winston

const app = express();
const server = http.createServer(app);

app.use(express.json());

// CORS (in dev lo lasciamo permissivo; puoi sostituire con env.corsWhitelist)
app.use(cors({ origin: true, credentials: true }));

// --- Helper per controllare che i file richiesti esistano ---
function ensureExists(relPath, friendlyName) {
  const abs = path.join(__dirname, relPath);
  const ok =
    fs.existsSync(abs) ||
    fs.existsSync(abs + '.js') ||
    fs.existsSync(path.join(abs, 'index.js'));
  if (!ok) {
    logger.error(`❌ Manca il file ${friendlyName}:`, { expected: abs });
  } else {
    logger.info(`✅ Trovato ${friendlyName}`, { file: abs });
  }
  return ok;
}

// --- Ping diagnostico (no-cache) ---
app.get('/api/ping', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, time: new Date().toISOString() });
});

// --- Mount API (ognuna viene verificata con ensureExists) ---
if (ensureExists('api/auth', 'API /api/auth')) {
  app.use('/api/auth', require('./api/auth'));
}
if (ensureExists('api/reservations', 'API /api/reservations')) {
  app.use('/api/reservations', require('./api/reservations'));
} else {
  app.use('/api/reservations', (_req, res) =>
    res.status(501).json({ error: 'Reservations API not installed yet' })
  );
}
if (ensureExists('api/products', 'API /api/products')) {
  app.use('/api/products', require('./api/products'));
}
if (ensureExists('api/orders', 'API /api/orders')) {
  app.use('/api/orders', require('./api/orders'));
}
if (ensureExists('api/tables', 'API /api/tables')) {
  app.use('/api/tables', require('./api/tables'));
}
if (ensureExists('api/rooms', 'API /api/rooms')) {
  app.use('/api/rooms', require('./api/rooms'));
}


// === INIZIO MODIFICA (mount printer routes) ===
app.use('/api', require('./api/printer'));
// === FINE MODIFICA ===
// app.get('/health', (_req, res) => res.json({ ok: true, time: Date.nnpmow() }));

// Health
app.use('/api/health', require('./api/health'));

// --- Socket.IO (opzionale, già nel tuo progetto) ---
const { Server } = require('socket.io');
const io = new Server(server, {
  path: '/socket.io',
  cors: { origin: true, credentials: true }
});
if (ensureExists('sockets/index', 'Sockets entry')) {
  require('./sockets/index')(io);
} else {
  logger.warn('⚠️ sockets/index non trovato: i socket non saranno gestiti');
  io.on('connection', (s) => {
    logger.info('🔌 socket connected (fallback)', { id: s.id });
  });
}

// --- Schema checker (stampa colonne reali + diff atteso) ---
if (ensureExists('db/schema-check', 'Schema checker')) {
  const { runSchemaCheck } = require('./db/schema-check');
  runSchemaCheck().catch(err => {
    // non blocco l'avvio: loggo e continuo
    logger.error('❌ Schema check failed', { error: String(err) });
  });
}

// --- Migrator (applica le migration .sql) ---
if (ensureExists('db/migrator', 'DB migrator')) {
  const { runMigrations } = require('./db/migrator');
  runMigrations()
    .then(() => logger.info('🧰 MIGRATIONS ✅ all applied'))
    .catch((e) => logger.error('❌ Startup failed (migrations)', { error: String(e) }));
}


server.listen(env.PORT, () => {
  logger.info(`🚀 HTTP listening on :${env.PORT}`);
});
```

### ./src/services/mailer.service.js
```
'use strict';

/**
 * Mailer centralizzato: invia email per cambio stato prenotazione.
 * - Unifica i template per pending/accepted/rejected/cancelled
 * - Logga SEMPRE la configurazione rilevante (mascherata)
 */

const nodemailer = require('nodemailer');
const env = require('../env');
const logger = require('../logger');

// cache singleton transporter
let _transporter = null;

function getTransporter() {
  if (!env.MAIL.enabled) return null;
  if (_transporter) return _transporter;

  _transporter = nodemailer.createTransport({
    host: env.MAIL.host,
    port: env.MAIL.port,
    secure: env.MAIL.secure,
    auth: (env.MAIL.user && env.MAIL.pass) ? {
      user: env.MAIL.user,
      pass: env.MAIL.pass,
    } : undefined,
  });

  logger.info('📧 SMTP configured', env._debugMailConfig());
  return _transporter;
}

function subjectFor(status, bizName) {
  switch (status) {
    case 'accepted':  return `✅ ${bizName}: prenotazione confermata`;
    case 'rejected':  return `❌ ${bizName}: prenotazione rifiutata`;
    case 'cancelled': return `⚠️ ${bizName}: prenotazione annullata`;
    case 'pending':
    default:          return `🕘 ${bizName}: prenotazione in attesa`;
  }
}

function htmlFor({ reservation, prevStatus, nextStatus, reason, bizName }) {
  const r = reservation || {};
  const name = [r.customer_first, r.customer_last].filter(Boolean).join(' ').trim() || 'Cliente';
  const dt = r.start_at
    ? new Date(r.start_at).toLocaleString('it-IT')
    : 'data/ora non disponibile';

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">
      <h2 style="margin:0 0 8px">${bizName}</h2>
      <p>Ciao <b>${name}</b>,</p>
      <p>ti informiamo che lo stato della tua prenotazione è ora: <b>${nextStatus}</b>.</p>
      <ul>
        <li><b>Quando:</b> ${dt}</li>
        <li><b>Coperti:</b> ${r.party_size || '-'}</li>
        ${r.table_name ? `<li><b>Tavolo:</b> ${r.table_name}</li>` : ''}
        ${r.notes ? `<li><b>Note:</b> ${r.notes}</li>` : ''}
      </ul>
      ${reason ? `<p><b>Nota:</b> ${escapeHtml(reason)}</p>` : ''}
      <p style="margin-top:20px">Grazie,<br/>${bizName}</p>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Invia mail generica di cambio stato.
 * @param {Object} p
 *   - to: destinatario (string)
 *   - reservation: oggetto prenotazione
 *   - prevStatus: string
 *   - nextStatus: string
 *   - reason?: string
 *   - replyTo?: string
 * @returns {Promise<{accepted: string[], rejected: string[], messageId: string}>}
 */
async function sendReservationStatusEmail(p = {}) {
  const cfg = env._debugMailConfig();
  logger.info('📧 sendReservationStatusEmail called', {
    to: p?.to,
    prevStatus: p?.prevStatus,
    nextStatus: p?.nextStatus,
    reason: (p?.reason || '').toString().slice(0, 200),
    cfg,
  });

  if (!env.MAIL.enabled) {
    logger.warn('📧 MAIL_ENABLED=false → non invio. (noop)');
    return { accepted: [], rejected: [p?.to].filter(Boolean), messageId: 'noop' };
  }
  const tx = getTransporter();
  if (!tx) {
    logger.error('📧 transporter non disponibile');
    throw new Error('mailer_not_configured');
  }

  const from = env.MAIL.from;
  const replyTo = p.replyTo || env.MAIL.replyTo || undefined;
  const subject = subjectFor(p.nextStatus, env.MAIL.bizName);
  const html = htmlFor({
    reservation: p.reservation,
    prevStatus: p.prevStatus,
    nextStatus: p.nextStatus,
    reason: p.reason,
    bizName: env.MAIL.bizName,
  });

  const info = await tx.sendMail({
    from, to: p.to, subject, html, replyTo,
  });

  logger.info('📧 sent', {
    to: p.to,
    subject,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  });

  return { accepted: info.accepted, rejected: info.rejected, messageId: info.messageId };
}

module.exports = {
  sendReservationStatusEmail,
};
```

### ./src/services/product.service.js
```
const { query } = require('../db'); // ✅ usa wrapper unico

module.exports = {
  getAll: async () => {
    const rows = await query("SELECT * FROM products ORDER BY created_at DESC");
    return rows;
  },

  getById: async (id) => {
    const rows = await query("SELECT * FROM products WHERE id = ?", [id]);
    return rows[0];
  },

  create: async (data) => {
    const { name, description, price, category } = data;
    const res = await query(
      "INSERT INTO products (name, description, price, category) VALUES (?, ?, ?, ?)",
      [name, description, price, category]
    );
    return { id: res.insertId, ...data };
  },

  update: async (id, data) => {
    const { name, description, price, category } = data;
    const res = await query(
      "UPDATE products SET name=?, description=?, price=?, category=? WHERE id=?",
      [name, description, price, category, id]
    );
    return res.affectedRows > 0 ? { id, ...data } : null;
  },

  remove: async (id) => {
    const res = await query("DELETE FROM products WHERE id=?", [id]);
    return res.affectedRows > 0;
  }
};
```

### ./src/services/reservations.service.js
```
'use strict';

/**
 * Service unico per le PRENOTAZIONI (CRUD + supporto UI).
 * - Stile: commenti esplicativi, log SQL con durata, niente sorprese.
 * - NB: Non cambiare i percorsi: usa ../db, ../env, ../logger come nel resto del progetto.
 */

const db     = require('../db');
const env    = require('../env');
const logger = require('../logger');

// ------------------------------- Helpers ------------------------------------

/** Logga una query con durata; in caso di errore logga e rilancia. */
async function q(sql, params = []) {
  const t0 = Date.now();
  try {
    const [rows] = await db.query(sql, params);
    const ms = Date.now() - t0;
    logger.info('SQL ✅', { service: 'server', duration_ms: String(ms), sql, params });
    return rows || [];
  } catch (err) {
    const ms = Date.now() - t0;
    logger.error('SQL ❌', { service: 'server', duration_ms: String(ms), sql, params, error: String(err) });
    throw err;
  }
}

/** Pad 2 cifre. */
function pad2(n) { return String(n).padStart(2, '0'); }

/** Aggiunge minuti ad una data ISO (string) e ritorna ISO MySQL compatibile (YYYY-MM-DD HH:mm:ss). */
function addMinutesISO(isoLike, minutes) {
  if (!isoLike) return null;
  const d = new Date(isoLike);
  if (Number.isNaN(+d)) return null;
  d.setMinutes(d.getMinutes() + Number(minutes || 0));
  // formato MySQL (local time compatibile)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
}

/** Converte ISO (con o senza 'T') in datetime string MySQL. */
function toMySqlDateTime(isoLike) {
  if (!isoLike) return null;
  const d = new Date(isoLike);
  if (Number.isNaN(+d)) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
}

/**
 * Calcola end_at:
 *  - Se non fornito, usa soglia oraria: <16:00 → lunchMinutes, altrimenti dinnerMinutes.
 *  - Le durate arrivano da env.RESV.defaultLunchMinutes / defaultDinnerMinutes.
 */
function computeEndAt(startAtIso) {
  if (!startAtIso) return null;
  const d = new Date(startAtIso);
  if (Number.isNaN(+d)) return null;

  const hh = d.getHours();
  const isLunch = hh < 16;
  const mins = isLunch ? env.RESV.defaultLunchMinutes : env.RESV.defaultDinnerMinutes;
  return addMinutesISO(startAtIso, mins);
}

/** Pulisce un valore testuale (stringa o null) */
function s(v) {
  const t = (v ?? '').toString().trim();
  return t === '' ? null : t;
}

// ------------------------------- API ----------------------------------------

/**
 * Lista prenotazioni con filtri opzionali:
 *  - from/to: YYYY-MM-DD (filtra su DATE(r.start_at))
 *  - status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'all'
 *  - q: ricerca su nome/cognome/telefono/email
 */
async function list(filter = {}) {
  const where = [];
  const params = [];

  if (filter.from) { where.push('DATE(r.start_at) >= ?'); params.push(filter.from); }
  if (filter.to)   { where.push('DATE(r.start_at) <= ?'); params.push(filter.to); }

  if (filter.status && filter.status !== 'all') {
    where.push('r.status = ?');
    params.push(filter.status);
  }

  if (filter.q) {
    where.push(`(
      r.customer_first LIKE ? OR
      r.customer_last  LIKE ? OR
      r.phone          LIKE ? OR
      r.email          LIKE ?
    )`);
    const w = `%${filter.q}%`;
    params.push(w, w, w, w);
  }

  const sql = `
    SELECT
      r.id, r.customer_first, r.customer_last, r.phone, r.email,
      r.party_size, r.start_at, r.end_at, r.status,
      r.table_id, r.notes, r.created_at, r.updated_at,
      t.room_id,
      /* Etichetta tavolo comoda per UI */
      CONCAT('Tavolo ', COALESCE(t.table_number, t.id)) AS table_name,
      t.table_number
    FROM reservations r
    LEFT JOIN tables t ON t.id = r.table_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.start_at ASC, r.id ASC
  `;

  return await q(sql, params);
}

/** Dettaglio singola prenotazione. */
async function getById(id) {
  const rows = await q(
    `SELECT
        r.id, r.customer_first, r.customer_last, r.phone, r.email,
        r.party_size, r.start_at, r.end_at, r.status,
        r.table_id, r.notes, r.created_at, r.updated_at,
        t.room_id,
        CONCAT('Tavolo ', COALESCE(t.table_number, t.id)) AS table_name,
        t.table_number
     FROM reservations r
     LEFT JOIN tables t ON t.id = r.table_id
     WHERE r.id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

/** Crea prenotazione (end_at autocalcolato se mancante). */
async function create(dto = {}) {
  const customer_first = s(dto.customer_first);
  const customer_last  = s(dto.customer_last);
  const phone          = s(dto.phone);
  const email          = s(dto.email);
  const notes          = s(dto.notes);
  const table_id       = dto.table_id ?? null;

  // start_at: accetta ISO; normalizza in datetime MySQL.
  const start_at = toMySqlDateTime(dto.start_at);
  if (!start_at) {
    const e = new Error('start_at richiesto o non valido');
    e.statusCode = 400;
    throw e;
  }

  // end_at: se non fornito → compute
  const end_at = dto.end_at ? toMySqlDateTime(dto.end_at) : computeEndAt(dto.start_at);

  const party_size = Number(dto.party_size || 1);
  const status = 'pending'; // default: pending

  const result = await q(
    `INSERT INTO reservations
      (customer_first, customer_last, phone, email,
       party_size, start_at, end_at, status,
       table_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [customer_first, customer_last, phone, email,
     party_size, start_at, end_at, status,
     table_id, notes]
  );

  const id = result.insertId;
  return await getById(id);
}

/** Patch parziale. Se cambia start_at e non passi end_at → ricalcolo end_at. */
async function update(id, dto = {}) {
  const fields = [];
  const params = [];

  // Campi ammessi
  if (dto.customer_first !== undefined) { fields.push('customer_first = ?'); params.push(s(dto.customer_first)); }
  if (dto.customer_last  !== undefined) { fields.push('customer_last  = ?'); params.push(s(dto.customer_last)); }
  if (dto.phone          !== undefined) { fields.push('phone          = ?'); params.push(s(dto.phone)); }
  if (dto.email          !== undefined) { fields.push('email          = ?'); params.push(s(dto.email)); }
  if (dto.party_size     !== undefined) { fields.push('party_size     = ?'); params.push(Number(dto.party_size || 1)); }
  if (dto.table_id       !== undefined) { fields.push('table_id       = ?'); params.push(dto.table_id ?? null); }
  if (dto.notes          !== undefined) { fields.push('notes          = ?'); params.push(s(dto.notes)); }

  // gestione data/ora
  let startWasChanged = false;
  if (dto.start_at !== undefined) {
    fields.push('start_at       = ?');
    params.push(toMySqlDateTime(dto.start_at));
    startWasChanged = true;
  }

  if (dto.end_at !== undefined) {
    fields.push('end_at         = ?');
    params.push(dto.end_at ? toMySqlDateTime(dto.end_at) : null);
  } else if (startWasChanged) {
    // se non specifichi end_at ma cambi start_at → ricalcolo comodo
    const recalculated = computeEndAt(dto.start_at);
    fields.push('end_at         = ?');
    params.push(recalculated);
  }

  if (!fields.length) {
    // niente da fare → ritorno il record attuale
    return await getById(id);
  }

  fields.push('updated_at = NOW()');

  await q(
    `UPDATE reservations SET ${fields.join(', ')} WHERE id = ? LIMIT 1`,
    [...params, id]
  );

  return await getById(id);
}

/** Hard delete (coerente con FE). */
async function remove(id) {
  await q(`DELETE FROM reservations WHERE id = ? LIMIT 1`, [id]);
  return { ok: true };
}

// ----------------------------- Supporto UI ----------------------------------

async function listRooms() {
  return await q(
    `SELECT id, name, is_active, sort_order
     FROM rooms
     ORDER BY COALESCE(sort_order, 9999), name ASC`,
    []
  );
}

async function listTablesByRoom(roomId) {
  return await q(
    `SELECT id, room_id, table_number, capacity, label, status, updated_at
     FROM tables
     WHERE room_id = ?
     ORDER BY COALESCE(table_number, 9999), id ASC`,
    [roomId]
  );
}

// ---------------------------- Conteggio per status ---------------------------

/**
 * Ritorna { pending, accepted, rejected, cancelled, total }
 * Filtrando opzionalmente per range data (DATE(start_at) tra from e to).
 */
async function countByStatus({ from, to } = {}) {
  const where = [];
  const params = [];
  if (from) { where.push('DATE(start_at) >= ?'); params.push(from); }
  if (to)   { where.push('DATE(start_at) <= ?'); params.push(to); }

  const rows = await q(
    `SELECT status, COUNT(*) AS c
     FROM reservations
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     GROUP BY status`,
    params
  );

  const out = { pending: 0, accepted: 0, rejected: 0, cancelled: 0, total: 0 };
  for (const r of rows) {
    if (out[r.status] !== undefined) out[r.status] = Number(r.c || 0);
    out.total += Number(r.c || 0);
  }
  return out;
}

// ---------------------------------------------------------------------------

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  listRooms,
  listTablesByRoom,
  countByStatus
};
```

### ./src/services/reservations-status.service.js
```
'use strict';

/**
 * Stato prenotazioni: transizioni + audit + (NEW) mail automatica.
 * Mantiene lo stile: commenti esplicativi e log dettagliati.
 */

const env = require('../env');
const logger = require('../logger');
const db = require('../db'); // assumo export { query } o compatibile
const mailer = require('./mailer.service');

// Mapping action → status
function actionToStatus(action) {
  switch (String(action || '').trim()) {
    case 'accept': return 'accepted';
    case 'reject': return 'rejected';
    case 'cancel': return 'cancelled';
    default: return null;
  }
}

// State machine “di base”
const ALLOWED = {
  pending : ['accepted', 'rejected', 'cancelled'],
  accepted: ['cancelled'],
  rejected: [],
  cancelled: [],
};

// Decide se ammettere current → next
function canTransition(current, next) {
  if (!current || !next) return false;
  if (current === next) return true;

  // Richiesta: consentire rientri e qualunque cambio se indicato da .env
  if (env.RESV.forceTransitions) {
    logger.warn('⚠️ forceTransitions ON: consento %s → %s', current, next);
    return true;
  }
  if (env.RESV.allowAnyTransition) {
    logger.warn('↩️ allowAnyTransition ON: consento %s → %s', current, next);
    return true;
  }

  // Altrimenti regole base + override puntuali
  const base = ALLOWED[current] || [];
  if (base.includes(next)) return true;

  if (current === 'rejected' && next === 'accepted' && env.RESV.allowAcceptOverride) {
    logger.warn('↩️ override: consento %s → %s (allowAcceptOverride)', current, next);
    return true;
  }
  if (current === 'cancelled' && env.RESV.allowBacktrack &&
      (next === 'rejected' || next === 'accepted' || next === 'pending')) {
    logger.warn('↩️ backtrack: consento %s → %s (allowBacktrack)', current, next);
    return true;
  }
  return false;
}

function denyTransition(current, next) {
  const msg = `Transizione non consentita: ${current} → ${next}`;
  const err = new Error(msg);
  err.statusCode = 409;
  return err;
}

// Carica prenotazione
async function getById(id) {
  const [rows] = await db.query(
    'SELECT id, customer_first, customer_last, email, phone, party_size, start_at, end_at, status, table_id, notes FROM reservations WHERE id=? LIMIT 1',
    [id]
  );
  return rows && rows[0] ? rows[0] : null;
}

// Scrive audit (tabella semplice; adatta i nomi se i tuoi sono diversi)
async function insertAudit({ reservationId, prevStatus, nextStatus, reason, user }) {
  await db.query(
    `INSERT INTO reservations_status_audit 
     (reservation_id, prev_status, next_status, reason, user_id, user_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [reservationId, prevStatus, nextStatus, reason || null, user?.id || null, user?.email || null]
  );
}

// Aggiorna stato in tabella
async function updateStatusInDb(id, nextStatus) {
  await db.query(
    'UPDATE reservations SET status=?, updated_at=NOW() WHERE id=? LIMIT 1',
    [nextStatus, id]
  );
}

async function updateStatus({ reservationId, action, reason, user }) {
  // 1) Carico attuale
  const r = await getById(reservationId);
  if (!r) {
    const e = new Error('not_found');
    e.statusCode = 404;
    throw e;
  }

  const current = r.status;
  const next = actionToStatus(action);
  if (!next) {
    const e = new Error('invalid_action');
    e.statusCode = 400;
    throw e;
  }

  // 2) Regole transizione
  if (!canTransition(current, next)) {
    throw denyTransition(current, next);
  }

  logger.info('🔁 RESV status change', {
    id: reservationId, prev: current, next,
    reason: reason || null,
    notify: env.RESV.notifyOnStatusChange
  });

  // 3) Update + audit (transaction semplice)
  await updateStatusInDb(reservationId, next);
  await insertAudit({ reservationId, prevStatus: current, nextStatus: next, reason, user });

  // 4) Ricarico la riga aggiornata
  const updated = await getById(reservationId);

  // 5) Email (sempre, se abilitata e c'è destinazione)
  if (env.RESV.notifyOnStatusChange) {
    const to = (updated?.email || '').trim();
    if (to) {
      try {
        // Log env mail *rilevante* per diagnosi (mascherato in mailer)
        logger.info('📧 notify status change', {
          id: reservationId,
          to,
          prevStatus: current,
          nextStatus: next,
          mailEnabled: env.MAIL.enabled,
          smtpHost: env.MAIL.host,
          smtpPort: env.MAIL.port,
          smtpSecure: env.MAIL.secure,
          mailFrom: env.MAIL.from || null,
          mailReplyTo: env.MAIL.replyTo || null
        });

        const info = await mailer.sendStatusUpdateEmail({
          to,
          reservation: updated,
          prevStatus: current,
          nextStatus: next,
          reason,
          replyTo: env.MAIL.replyTo
        });
        updated._mail = { sent: !info?.skipped, messageId: info?.messageId || null };
      } catch (err) {
        logger.error('📧 notify KO', { id: reservationId, error: String(err) });
        updated._mail = { sent: false, error: String(err) };
      }
    } else {
      logger.warn('📧 notify SKIP (no email)', { id: reservationId });
      updated._mail = { sent: false, reason: 'no_email' };
    }
  }

  return updated;
}

async function getAudit({ reservationId, limit = 50 }) {
  const [rows] = await db.query(
    `SELECT id, reservation_id, prev_status, next_status, reason, user_email, created_at
     FROM reservations_status_audit
     WHERE reservation_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    [reservationId, limit]
  );
  return rows || [];
}

module.exports = {
  updateStatus,
  getAudit,
  canTransition
};
```

### ./src/services/thermal-printer.service.js
```
'use strict';

/**
 * Stampa termica (ESC/POS) - daily e placecards.
 * - DAILY: supporto “flat” (tabella classica) e “grouped by time” (blocchi con titolo orario).
 * - Nome cartellino adattivo (una riga, riduzione orizzontale, ellissi).
 * - Padding gestito per evitare tagli dei QR.
 * - Logo PNG centrato.
 * - Date/ora rese in BIZ_TZ (indipendenti dal fuso del server).
 * - Supporto DB utc vs naive (DB_TIME_IS_UTC).
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const iconv = require('iconv-lite');
const { PNG } = require('pngjs');
const logger = require('../logger');

// ─────────────────────────────────────────────────────────────────────────────
// ENV
// ─────────────────────────────────────────────────────────────────────────────
const RESOLVED_HOST = process.env.PRINTER_IP || process.env.PRINTER_HOST || '127.0.0.1';
const RESOLVED_PORT = Number(process.env.PRINTER_PORT || 9100);
const WIDTH_MM      = Number(process.env.PRINTER_WIDTH_MM || 80);
const CODEPAGE      = (process.env.PRINTER_CODEPAGE || 'cp858').toLowerCase();

const DISPLAY_TZ     = process.env.BIZ_TZ || 'Europe/Rome';
const QR_BASE_URL    = (process.env.QR_BASE_URL || '').trim();
const LOGO_PATH      = process.env.PRINTER_LOGO_PATH || 'assets/logo.png';
const DB_TIME_IS_UTC = String(process.env.DB_TIME_IS_UTC || 'false') === 'true';

// DAILY → grouped?
const DAILY_GROUPED  = String(process.env.PRINTER_DAILY_GROUPED ?? 'true') !== 'false';
// Aspetto titolo del blocco orario
const GROUP_T_W = Math.max(1, Math.min(8, Number(process.env.PRINTER_GROUP_TITLE_W || 2)));
const GROUP_T_H = Math.max(1, Math.min(8, Number(process.env.PRINTER_GROUP_TITLE_H || 2)));

// QR config (cartellini)
const QR_SIZE_ENV   = Number(process.env.PRINTER_QR_SIZE || 5);
const QR_ECC_ENV    = String(process.env.PRINTER_QR_ECC || 'H').toUpperCase();
const QR_CAPTION_GAP= Number(process.env.PRINTER_QR_CAPTION_GAP_LINES || 1);

// Padding per separare i cartellini
const TOP_PAD_LINES    = Number(process.env.PRINTER_TOP_PAD_LINES || 2);
const BOTTOM_PAD_LINES = Number(process.env.PRINTER_BOTTOM_PAD_LINES || 4);

// Colonne / dot disponibili
const COLS     = WIDTH_MM >= 70 ? 48 : 32;   // 80mm≈48 col, 58mm≈32 col
const MAX_DOTS = WIDTH_MM >= 70 ? 576 : 384; // indicativo per raster PNG

// ───────────────── ESC/POS helpers ──────────────────────────────────────────
const ESC = Buffer.from([0x1B]);
const GS  = Buffer.from([0x1D]);
const LF  = Buffer.from([0x0A]);

const INIT         = Buffer.concat([ESC, Buffer.from('@')]);      // ESC @
const ALIGN_LEFT   = Buffer.concat([ESC, Buffer.from('a'), Buffer.from([0])]);
const ALIGN_CENTER = Buffer.concat([ESC, Buffer.from('a'), Buffer.from([1])]);
const BOLD_ON      = Buffer.concat([ESC, Buffer.from('E'), Buffer.from([1])]);
const BOLD_OFF     = Buffer.concat([ESC, Buffer.from('E'), Buffer.from([0])]);
const DOUBLE_ON    = Buffer.concat([GS,  Buffer.from('!'), Buffer.from([0x11])]); // h/w 2x
const DOUBLE_OFF   = Buffer.concat([GS,  Buffer.from('!'), Buffer.from([0x00])]);
const CUT_FULL     = Buffer.concat([GS,  Buffer.from('V'), Buffer.from([0])]);

// feed n righe (padding preciso)
function FEED(n = 0) {
  const nn = Math.max(0, Math.min(255, Number(n)||0));
  return Buffer.concat([ESC, Buffer.from('d'), Buffer.from([nn])]);
}

// Dimensione font fine-grained (1..8)
function SIZE(w = 1, h = 1) {
  const W = Math.max(1, Math.min(8, w));
  const H = Math.max(1, Math.min(8, h));
  const v = ((W - 1) << 4) | (H - 1);
  return Buffer.concat([GS, Buffer.from('!'), Buffer.from([v])]);
}

function selectCodepageBuffer() {
  const map = { cp437:0, cp850:2, cp858:19, cp852:18, cp1252:16 };
  const n = map[CODEPAGE] ?? 19;
  return Buffer.concat([ESC, Buffer.from('t'), Buffer.from([n])]);
}
function encode(text) { return iconv.encode(String(text || '').replace(/\r/g, ''), CODEPAGE, { addBOM:false }); }
function line(text='') { return Buffer.concat([ encode(text), LF ]); }

function wrap(text, width = COLS) {
  const words = String(text || '').split(/\s+/);
  const rows = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else { rows.push(cur); cur = w; }
  }
  if (cur) rows.push(cur);
  return rows;
}
function padRight(s, n) { return String(s || '').padEnd(n, ' '); }

function sendToPrinter(buffers) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: RESOLVED_HOST, port: RESOLVED_PORT }, () => {
      for (const b of buffers) socket.write(b);
      socket.end();
    });
    socket.setTimeout(8000);
    socket.on('timeout', () => { socket.destroy(new Error('timeout')); });
    socket.on('error', reject);
    socket.on('close', (hadErr) => hadErr ? reject(new Error('printer socket closed with error'))
                                          : resolve(true));
  });
}

// ─────────────── Date/ora sicure (DB UTC vs naive) ──────────────────────────
function parseDbDate(s) {
  const str = String(s || '').trim();
  if (!str) return new Date(NaN);
  if (str.includes('T')) return new Date(str); // ISO ready
  const base = str.replace(' ', 'T');
  return DB_TIME_IS_UTC ? new Date(base + 'Z') : new Date(base);
}

function formatTimeHHmm(start_at) {
  const d = parseDbDate(start_at);
  return new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DISPLAY_TZ,
  }).format(d);
}
function formatDateHuman(d) {
  return new Intl.DateTimeFormat('it-IT', {
    weekday:'long', day:'2-digit', month:'2-digit', year:'numeric', timeZone: DISPLAY_TZ,
  }).format(d);
}
function formatYmdHuman(ymd) {
  const d = DB_TIME_IS_UTC
    ? new Date(String(ymd||'').trim() + 'T00:00:00Z')
    : new Date(String(ymd||'').trim() + 'T00:00:00');
  return formatDateHuman(d);
}
function up(s) { return (s || '').toString().toUpperCase(); }

// ─────────────────────── Raster PNG (logo) ──────────────────────────────────
function buildRasterFromPNG(png, maxWidthDots = MAX_DOTS, threshold = 200) {
  let targetW = Math.min(maxWidthDots, png.width);
  const ratio = targetW / png.width;
  const targetH = Math.max(1, Math.round(png.height * ratio));
  const bytesPerRow = Math.ceil(targetW / 8);
  const bmp = Buffer.alloc(bytesPerRow * targetH, 0x00);

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(png.width - 1, Math.round(x / ratio));
      const sy = Math.min(png.height - 1, Math.round(y / ratio));
      const idx = (sy * png.width + sx) << 2;
      const r = png.data[idx], g = png.data[idx+1], b = png.data[idx+2], a = png.data[idx+3];
      const gray = a === 0 ? 255 : Math.round(0.2126*r + 0.7152*g + 0.0722*b);
      const bit = gray < threshold ? 1 : 0;
      if (bit) bmp[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
    }
  }

  const m  = 0;
  const xL = bytesPerRow & 0xff, xH = (bytesPerRow >> 8) & 0xff;
  const yL = targetH & 0xff,      yH = (targetH >> 8) & 0xff;

  return Buffer.concat([GS, Buffer.from('v0', 'ascii'), Buffer.from([m, xL, xH, yL, yH]), bmp, LF]);
}

let LOGO_RASTER = null;
(function preloadLogo() {
  try {
    const abs = path.resolve(process.cwd(), LOGO_PATH);
    if (fs.existsSync(abs)) {
      const buf = fs.readFileSync(abs);
      const png = PNG.sync.read(buf);
      const raster = buildRasterFromPNG(png, Math.floor(MAX_DOTS * 0.85), 190);
      LOGO_RASTER = Buffer.concat([ALIGN_CENTER, raster, LF]);
      logger.info(`🖼️ Logo caricato: ${abs}`);
    } else {
      logger.warn(`Logo non trovato: ${abs}`);
    }
  } catch (e) {
    logger.warn('Logo PNG non caricabile', e);
  }
})();

// ──────────────────────── QR ESC/POS (Model 2) ──────────────────────────────
function qrStoreData(data) {
  const payload = encode(data);
  const len = payload.length + 3;
  const pL = len & 0xff, pH = (len >> 8) & 0xff;
  return Buffer.concat([GS, Buffer.from('('), Buffer.from('k'), Buffer.from([pL, pH, 0x31, 0x50, 0x30]), payload]);
}
function qrSetModuleSize(size = 6) {
  const s = Math.max(1, Math.min(16, size));
  return Buffer.concat([GS, Buffer.from('('), Buffer.from('k'), Buffer.from([0x03,0x00,0x31,0x43,s])]);
}
function qrSetECCFromEnv() {
  const map = { L: 48, M: 48, Q: 49, H: 51 };
  const lv = map[QR_ECC_ENV] ?? 51;
  return Buffer.concat([GS, Buffer.from('('), Buffer.from('k'), Buffer.from([0x03,0x00,0x31,0x45, lv])]);
}
function qrPrint() { return Buffer.concat([GS, Buffer.from('('), Buffer.from('k'), Buffer.from([0x03,0x00,0x31,0x51,0x30])]); }

// ───────────────────── Nome adattivo su una riga (cartellini) ───────────────
function printAdaptiveName(buffers, name, maxCols = COLS) {
  const txt = up(name || '');
  const widths = [3, 2, 1];
  const H = 2;
  let chosenW = 1;

  for (const w of widths) {
    const maxLen = Math.floor(maxCols / w);
    if (txt.length <= maxLen) { chosenW = w; break; }
  }
  const maxLenAtChosen = Math.floor(maxCols / chosenW);
  const shown = txt.length > maxLenAtChosen
    ? txt.slice(0, Math.max(0, maxLenAtChosen - 1)) + '…'
    : txt;

  buffers.push(SIZE(chosenW, H), BOLD_ON, ALIGN_CENTER, line(shown), BOLD_OFF, SIZE(1,1));
}

// ─────────────────────────── DAILY (flat) ───────────────────────────────────
function buildDailyFlat(out, rows) {
  // intestazione colonne
  out.push(ALIGN_LEFT, BOLD_ON);
  out.push(line(
    padRight('ORA',5) + ' ' +
    padRight('TAV',4) + ' ' +
    padRight('PAX',3) + ' ' +
    padRight('NOME', COLS-5-1-4-1-3-1)
  ));
  out.push(BOLD_OFF, line('-'.repeat(COLS)));

  rows.sort((a,b) => String(a.start_at).localeCompare(String(b.start_at)));

  for (const r of rows) {
    const time = formatTimeHHmm(r.start_at);
    const tav  = (r.table_number || r.table_id || '-').toString();
    const pax  = (r.party_size || '-').toString();
    const name = ((r.customer_first || '') + ' ' + (r.customer_last || '')).trim() || '—';

    const left = `${padRight(time,5)} ${padRight(tav,4)} ${padRight(pax,3)} `;
    const nameWidth = COLS - left.length;
    const nameRows = wrap(name, nameWidth);
    out.push(line(left + padRight(nameRows[0] || '', nameWidth)));
    for (let i=1;i<nameRows.length;i++) out.push(line(' '.repeat(left.length) + nameRows[i]));

    if (r.phone) out.push(line(' '.repeat(left.length) + String(r.phone)));
    if (r.notes) {
      const notesRows = wrap('NOTE: ' + r.notes, COLS - left.length);
      for (const rr of notesRows) out.push(line(' '.repeat(left.length) + rr));
    }
    out.push(line(' '.repeat(COLS)));
  }
}

// ───────────────────── DAILY (grouped by time) ──────────────────────────────
function buildDailyGroupedBlocks(out, rows) {
  // 1) raggruppo per HH:mm già nel fuso di stampa
  const groups = new Map(); // key: 'HH:mm' → array di rows
  for (const r of rows) {
    const t = formatTimeHHmm(r.start_at);
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(r);
  }
  // 2) ordino le chiavi orarie (numericamente 00..23:59)
  const keys = Array.from(groups.keys()).sort((a, b) => {
    const [ah, am] = a.split(':').map(Number);
    const [bh, bm] = b.split(':').map(Number);
    return ah !== bh ? ah - bh : am - bm;
  });

  // 3) per ogni gruppo → titolo grande centrato + elenco senza ora
  for (const k of keys) {
    const list = groups.get(k) || [];
    // Titolo del gruppo (orario), ben visibile
    out.push(ALIGN_CENTER, SIZE(GROUP_T_W, GROUP_T_H), BOLD_ON, line(k), BOLD_OFF, SIZE(1,1));
    out.push(line('-'.repeat(COLS)));

    // Righe: TAV  PAX  NOME (+ phone/notes)
    list.sort((a,b) => (a.table_number ?? a.table_id ?? 0) - (b.table_number ?? b.table_id ?? 0));

    for (const r of list) {
      const tav  = (r.table_number || r.table_id || '-').toString();
      const pax  = (r.party_size || '-').toString();
      const name = ((r.customer_first || '') + ' ' + (r.customer_last || '')).trim() || '—';

      const left = `${padRight(tav,4)} ${padRight(pax,3)} `;
      const nameWidth = COLS - left.length;
      const nameRows = wrap(name, nameWidth);
      out.push(ALIGN_LEFT, line(left + padRight(nameRows[0] || '', nameWidth)));
      for (let i=1;i<nameRows.length;i++) out.push(line(' '.repeat(left.length) + nameRows[i]));

      if (r.phone) out.push(line(' '.repeat(left.length) + String(r.phone)));
      if (r.notes) {
        const notesRows = wrap('NOTE: ' + r.notes, COLS - left.length);
        for (const rr of notesRows) out.push(line(' '.repeat(left.length) + rr));
      }
      out.push(line(' '.repeat(COLS)));
    }

    // separatore tra blocchi
    out.push(line('-'.repeat(COLS)));
  }
}

// ───────────────────────────── DAILY main ───────────────────────────────────
async function printDailyReservations({ date, rows, user }) {
  logger.info('🖨️ DAILY begin', {
    date, rows: rows?.length || 0, host: RESOLVED_HOST, port: RESOLVED_PORT,
    cols: COLS, codepage: CODEPAGE, tz: DISPLAY_TZ, utc: DB_TIME_IS_UTC, grouped: DAILY_GROUPED
  });

  const out = [];
  out.push(INIT, selectCodepageBuffer(), ALIGN_CENTER, BOLD_ON, DOUBLE_ON);
  out.push(line('PRENOTAZIONI'));
  out.push(DOUBLE_OFF, BOLD_OFF);

  const header = formatYmdHuman(date).toUpperCase();
  out.push(line(header));
  out.push(line('-'.repeat(COLS)));

  if (DAILY_GROUPED) buildDailyGroupedBlocks(out, rows);
  else               buildDailyFlat(out, rows);

  out.push(ALIGN_CENTER, line(`Operatore: ${user?.email || 'sistema'}`));
  out.push(line(''), line(''), CUT_FULL);

  await sendToPrinter(out);
  return { jobId: `daily_${Date.now()}`, printedCount: rows.length };
}

// ─────────────────────────── PLACE CARDS ────────────────────────────────────
function buildOnePlaceCardBuffers(r, opts = {}) {
  const out = [];

  const time = formatTimeHHmm(r.start_at);
  const dateObj = parseDbDate(String(r.start_at || ''));
  const dateHuman = formatDateHuman(dateObj);

  const tav  = (r.table_number || r.table_id || '-').toString();
  const pax  = (r.party_size || '-').toString();
  const sala = r.room_name || r.room || r.room_id || '-';
  const name = ((r.customer_last || '') + ' ' + (r.customer_first || '')).trim() || 'OSPITE';

  out.push(INIT, selectCodepageBuffer(), ALIGN_CENTER);

  if (TOP_PAD_LINES > 0) out.push(FEED(TOP_PAD_LINES));
  if (LOGO_RASTER) out.push(LOGO_RASTER);

  out.push(SIZE(2,1), BOLD_ON, line(`TAVOLO ${tav}`), BOLD_OFF, SIZE(1,1));
  printAdaptiveName(out, name, COLS);

  out.push(BOLD_ON, line(`${time}  •  ${dateHuman}`), BOLD_OFF);
  out.push(line(`SALA:  ${sala}   •   COPERTI: ${pax}`));
  out.push(line(''));

  const qrUrl = opts.qrUrl || (QR_BASE_URL ? `${QR_BASE_URL.replace(/\/+$/,'')}/` : null);
  if (qrUrl) {
    out.push(line('Scansiona il QR del locale'));
    if (QR_CAPTION_GAP > 0) out.push(FEED(QR_CAPTION_GAP));
    out.push(ALIGN_CENTER, qrSetModuleSize(QR_SIZE_ENV), qrSetECCFromEnv(), qrStoreData(qrUrl), qrPrint());
    out.push(line(''));
  }

  if (BOTTOM_PAD_LINES > 0) out.push(FEED(BOTTOM_PAD_LINES));
  out.push(CUT_FULL);
  return out;
}

async function printPlaceCards({ date, rows, user, logoText, qrBaseUrl }) {
  logger.info('🖨️ PLACECARDS begin', {
    date, rows: rows?.length || 0, host: RESOLVED_HOST, port: RESOLVED_PORT,
    cols: COLS, codepage: CODEPAGE, tz: DISPLAY_TZ, utc: DB_TIME_IS_UTC
  });

  const buffers = [];
  for (const r of rows) {
    buffers.push(...buildOnePlaceCardBuffers(r, {
      qrUrl: qrBaseUrl || (QR_BASE_URL || null),
    }));
  }

  await sendToPrinter(buffers);
  return { jobId: `placecards_${Date.now()}`, printedCount: rows.length };
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  printDailyReservations,
  printPlaceCards,
};
```

### ./src/sockets/index.js
```
const logger = require('../logger');

module.exports = function(io) {
  io.on('connection', (socket) => {
    logger.info('🔌 SOCKET connected', { id: socket.id });

    socket.on('ping', () => {
      logger.info('🏓 ping from', { id: socket.id });
      socket.emit('pong');
    });

    socket.on('disconnect', (reason) => {
      logger.info('🔌 SOCKET disconnected', { id: socket.id, reason });
    });
  });
};
```

### ./src/sockets/orders.js
```
// 📡 Socket.IO: gestione ordini (lista/nuovo/update)
const { query } = require('../db');                         // query wrapper
const logger = require('../logger');                        // ✅ istanza diretta
const { printOrder } = require('../utils/print');           // stampa (fallback su file se KO)
const env = require('../env');                              // config

module.exports = (io) => {
  io.on('connection', (socket) => {
    logger.info('📡 SOCKET connected', { id: socket.id });

    socket.on('get-orders', async () => {
      logger.info('📡 get-orders ▶️', { from: socket.id });
      const rows = await query('SELECT * FROM orders ORDER BY created_at DESC');
      for (const r of rows) {
        r.items = await query('SELECT * FROM order_items WHERE order_id=?', [r.id]);
      }
      socket.emit('orders-list', rows);
    });

    socket.on('new-order', async (order) => {
      logger.info('📡 new-order ▶️', { body: order });
      const res = await query(
        `INSERT INTO orders (total, currency, customer_first, customer_last, phone, email, delivery_address, status)
         VALUES (?,?,?,?,?,?,?, 'pending')`,
        [
          order.total, order.currency,
          order.customer?.firstName || null,
          order.customer?.lastName  || null,
          order.customer?.phone     || null,
          order.customer?.email     || null,
          order.customer?.deliveryAddress || null
        ]
      );
      const orderId = res.insertId;

      for (const it of (order.items || [])) {
        await query(
          `INSERT INTO order_items (order_id, product_name, qty, price, notes, ingredients)
           VALUES (?,?,?,?,?,?)`,
          [orderId, it.name, it.qty, it.price, it.notes || '', (it.chosenIngredients||[]).join(',')]
        );
      }

      const [o] = await query('SELECT * FROM orders WHERE id=?', [orderId]);
      o.items = await query('SELECT * FROM order_items WHERE order_id=?', [orderId]);

      io.emit('order-created', o);
      logger.info('📡 order-created ✅ broadcast', { orderId });

      // stampa non bloccante
      const printerCfg = { enabled: !!env.PRINTER?.ip, ip: env.PRINTER?.ip || '127.0.0.1', port: env.PRINTER?.port || 9100 };
      printOrder(o, printerCfg).catch(e => logger.error('🖨️ PRINT ❌', { error: String(e), orderId }));
    });

    socket.on('update-status', async ({ id, status }) => {
      logger.info('📡 update-status ▶️', { id, status });
      await query('UPDATE orders SET status=? WHERE id=?', [status, id]);
      io.emit('order-updated', { id, status });
    });

    socket.on('disconnect', (reason) => {
      logger.info('📡 SOCKET disconnected', { id: socket.id, reason });
    });
  });
};
```

### ./src/sockets/reservations.js
```
// 📡 Socket.IO — Prenotazioni tavolo (realtime) + creazione anche da Admin
const logger = require('../logger'); // ✅ istanza diretta
const {
  createReservation,
  updateReservationStatus,
  assignReservationTable,
  listReservations
} = require('../services/reservations.service');

module.exports = (io) => {
  io.on('connection', (socket) => {
    logger.info('📡 [RES] SOCKET connected', { id: socket.id });

    socket.on('register-admin', () => socket.join('admins'));
    socket.on('register-customer', (token) => token && socket.join(`c:${token}`));

    socket.on('reservations-get', async (filter = {}) => {
      logger.info('📡 [RES] reservations-get ▶️', { from: socket.id, filter });
      const rows = await listReservations(filter);
      socket.emit('reservations-list', rows);
    });

    socket.on('reservation-new', async (dto) => {
      logger.info('📡 [RES] reservation-new ▶️', { origin: 'customer', body: dto });
      const r = await createReservation(dto);
      io.to('admins').emit('reservation-created', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-created', r);
      logger.info('📡 [RES] reservation-created ✅ broadcast', { id: r.id });
    });

    socket.on('reservation-admin-new', async (dto) => {
      logger.info('📡 [RES] reservation-admin-new ▶️', { origin: 'admin', body: dto });
      const r = await createReservation(dto);
      io.to('admins').emit('reservation-created', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-created', r);
      logger.info('📡 [RES] reservation-created ✅ (admin)', { id: r.id });
    });

    socket.on('reservation-update-status', async ({ id, status }) => {
      logger.info('📡 [RES] reservation-update-status ▶️', { id, status });
      const r = await updateReservationStatus(id, status);
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    socket.on('reservation-assign-table', async ({ id, table_id }) => {
      logger.info('📡 [RES] reservation-assign-table ▶️', { id, table_id });
      const r = await assignReservationTable(id, table_id);
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    socket.on('disconnect', (reason) => {
      logger.info('📡 [RES] SOCKET disconnected', { id: socket.id, reason });
    });
  });
};
```
