# 🧩 Project code (file ammessi in .)

_Generato: Mon, Oct 27, 2025  1:59:18 AM_

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
        "twilio": "5.10.3",
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

const env = require('../env');         // ✅ unica fonte di verità
const logger = require('../logger');   // ✅ winston
const { query } = require('../db');    // ✅ mysql2/promise pool
const requireAuth = require('../middleware/auth'); // Bearer verifier

// Helper robusto: crea JWT HS256
function signToken(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    roles: user.roles ? String(user.roles).split(',') : []
  };
  return jwt.sign(payload, env.JWT.secret, {
    algorithm: 'HS256',
    expiresIn: env.JWT.ttlSeconds
  });
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  logger.info('🔐 [AUTH] login ▶️', { email, hasPwd: !!password });

  if (!email || !password) {
    logger.warn('🔐 [AUTH] login ⚠️ missing fields', { email: !!email, password: !!password });
    return res.status(400).json({ error: 'missing_credentials' });
  }

  try {
    // 1) utente
    const rows = await query('SELECT * FROM users WHERE email=? LIMIT 1', [email]);
    const user = rows?.[0];

    if (!user) {
      logger.warn('🔐 [AUTH] login ❌ no_user', { email });
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    // 2) password (hash in colonna password_hash)
    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) {
      logger.warn('🔐 [AUTH] login ❌ bad_password', { userId: user.id });
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    // 3) JWT ready?
    if (!env.JWT || !env.JWT.secret) {
      logger.error('🔐 [AUTH] login 💥 misconfigured JWT', { jwtConfigured: !!env.JWT, hasSecret: !!(env.JWT && env.JWT.secret) });
      return res.status(500).json({ error: 'jwt_misconfigured' });
    }

    // 4) token + risposta "safe"
    const token = signToken(user);
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

// GET /api/auth/me (protetta)
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.sub || req.user?.id;
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

### ./src/api/notifications.js
```
// src/api/notifications.js
'use strict';

const express = require('express');
const router  = express.Router();

const logger = require('../logger');
const env    = require('../env');

// servizi già presenti nel tuo BE
const mailer = require('../services/mailer.service');      // ✉️
const wa     = require('../services/whatsapp.service');    // 📲 (Twilio)

/**
 * POST /api/notifications/email
 * Body: { kind: 'reservation-pending-admin' | 'reservation-pending-customer', reservation: {...} }
 */
router.post('/email', async (req, res) => {
  const kind = String(req.body?.kind || '').trim();
  const reservation = req.body?.reservation || null;

  if (!kind || !reservation) {
    return res.status(400).json({ ok: false, error: 'missing_kind_or_reservation' });
  }

  if (!env.MAIL?.enabled) {
    logger.warn('📧 notifications/email SKIP (MAIL disabled)', { kind });
    return res.json({ ok: false, reason: 'mail_disabled' });
  }

  try {
    let to, subject, html;
    const status = reservation.status || 'pending';

    if (kind === 'reservation-pending-admin') {
      to = env.MAIL?.user || env.MAIL?.from; // admin predefinito: usa SMTP_USER o MAIL_FROM
      subject = `[PENDING] Prenotazione #${reservation.id || '?'} — ${reservation.start_at || ''}`;
      html = `
        <p>C'è una nuova prenotazione <b>in attesa</b>.</p>
        <ul>
          <li>#${reservation.id || '?'}</li>
          <li>Quando: ${reservation.start_at || '-'}</li>
          <li>Cliente: ${(reservation.customer_first || '')} ${(reservation.customer_last || '')}</li>
          <li>Coperti: ${reservation.party_size || '-'}</li>
          <li>Telefono: ${reservation.phone || '-'}</li>
          <li>Email: ${reservation.email || '-'}</li>
        </ul>
      `;
    } else if (kind === 'reservation-pending-customer') {
      to = reservation.email || null;
      if (!to) {
        logger.warn('📧 pending-customer SKIP (no email)', { id: reservation.id });
        return res.json({ ok: false, reason: 'no_customer_email' });
      }
      subject = `${env.MAIL?.bizName || 'Prenotazioni'} — richiesta ricevuta`;
      html = `
        <p>Ciao ${(reservation.customer_first || '')} ${(reservation.customer_last || '')},</p>
        <p>abbiamo ricevuto la tua richiesta di prenotazione per <b>${reservation.start_at || '-'}</b> (persone: <b>${reservation.party_size || '-'}</b>).</p>
        <p>Stato attuale: <b>${String(status).toUpperCase()}</b>. Ti avviseremo appena viene confermata.</p>
      `;
    } else {
      return res.status(400).json({ ok: false, error: 'unknown_kind' });
    }

    const sent = await mailer.sendRaw({ to, subject, html });
    logger.info('📧 notifications/email ✅', { kind, to, messageId: sent?.messageId });
    return res.json({ ok: true, messageId: sent?.messageId || null });
  } catch (err) {
    logger.error('📧 notifications/email ❌', { kind, error: String(err) });
    return res.status(500).json({ ok: false, error: 'send_failed' });
  }
});

/**
 * POST /api/notifications/whatsapp/twilio
 * Body: { kind: 'reservation-pending', reservation: {...} }
 */
router.post('/whatsapp/twilio', async (req, res) => {
  const kind = String(req.body?.kind || '').trim();
  const reservation = req.body?.reservation || null;

  if (!kind || !reservation) {
    return res.status(400).json({ ok: false, error: 'missing_kind_or_reservation' });
  }

  if (!env.WA?.enabled) {
    logger.warn('📲 WA SKIP (disabled)', { kind });
    return res.json({ ok: false, reason: 'wa_disabled' });
  }

  try {
    if (kind !== 'reservation-pending') {
      return res.status(400).json({ ok: false, error: 'unknown_kind' });
    }
    // testo generico "in attesa"
    const result = await wa.sendStatusChange({
      to: reservation.phone || reservation.contact_phone || null,
      reservation,
      status: reservation.status || 'pending'
    });
    logger.info('📲 WA pending ▶️', { id: reservation.id, ok: !!result?.ok, reason: result?.reason });
    return res.json({ ok: !!result?.ok, sid: result?.sid || null, reason: result?.reason || null });
  } catch (err) {
    logger.error('📲 WA pending ❌', { error: String(err) });
    return res.status(500).json({ ok: false, error: 'wa_failed' });
  }
});

module.exports = router;
```

### ./src/api/orders.js
```
'use strict';

// src/api/orders.js — ORDINI (header + items + stato + notify + socket + SSE)

const express = require('express');
const router = express.Router();

const logger = require('../logger');
const { query } = require('../db');
const Orders = require('../services/orders.service');
const notify = require('../services/notify.service');
const sse = require('../services/orders.sse');

// Helper: id numerico
const toId = (v) => Number.parseInt(v, 10);

// Carica + items
async function hydrateOrder(orderId) {
  const [order] = await query('SELECT * FROM orders WHERE id=?', [orderId]);
  if (!order) return null;
  const items = await query('SELECT * FROM order_items WHERE order_id=?', [orderId]);
  return { ...order, items };
}

// ---------------- LISTE ------------------------------------------------------
router.get('/', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders');
    const rows = await Orders.listHeaders();
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/orders', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/all', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/all');
    const out = await Orders.listFull();
    res.json(out);
  } catch (err) {
    logger.error('❌ [GET] /api/orders/all', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/pending', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/pending');
    res.json(await Orders.listByStatus('pending'));
  } catch (err) {
    logger.error('❌ [GET] /api/orders/pending', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/completed', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/completed');
    res.json(await Orders.listByStatus('completed'));
  } catch (err) {
    logger.error('❌ [GET] /api/orders/completed', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/today', async (_req, res) => {
  try {
    logger.info('📥 [GET] /api/orders/today');
    res.json(await Orders.listLastHours(24));
  } catch (err) {
    logger.error('❌ [GET] /api/orders/today', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---------------- DETTAGLIO --------------------------------------------------
router.get('/:id(\\d+)', async (req, res) => {
  const id = toId(req.params.id);
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

// ---------------- CREA -------------------------------------------------------
router.post('/', async (req, res) => {
  const dto = req.body || {};
  try {
    logger.info('➕ [POST] /api/orders ▶️', {
      source: dto.source || dto.channel || 'web',
      items: Array.isArray(dto.items) ? dto.items.length : 0
    });

    const created = await Orders.create(dto);
    const full = await hydrateOrder(created.id);

    // Notifiche (best-effort)
    try { await notify.onOrderCreated(full); }
    catch (e) { logger.error('🔔 notify NEW ❌', { id: created.id, error: String(e) }); }

    // Socket
    try {
      const io = require('../sockets/index').io();
      io.emit('orders:created', { id: created.id, order: full });
      logger.info('📡 socket orders:created ✅', { id: created.id });
    } catch (e) {
      logger.warn('📡 socket orders:created ⚠️', { id: created.id, error: String(e) });
    }

    // SSE
    try {
      sse.broadcast('order-created', { id: created.id, order: full });
    } catch (e) {
      logger.warn('🧵 SSE broadcast order-created ⚠️', { error: String(e) });
    }

    res.status(201).json(full);
  } catch (err) {
    logger.error('❌ [POST] /api/orders', { error: String(err) });
    res.status(500).json({ error: err.message || 'internal_error' });
  }
});

// ---------------- STATO ------------------------------------------------------
router.patch('/:id(\\d+)/status', async (req, res) => {
  const id = toId(req.params.id);
  const status = String(req.body?.status || '').toLowerCase();
  try {
    logger.info('✏️ [PATCH] /api/orders/:id/status ▶️', { id, status });

    const ok = await Orders.setStatus(id, status);
    if (!ok) return res.status(404).json({ error: 'not_found' });

    const full = await hydrateOrder(id);

    // socket
    try {
      const io = require('../sockets/index').io();
      io.emit('orders:status', { id, status, order: full });
      logger.info('📡 socket orders:status ✅', { id, status });
    } catch (e) {
      logger.warn('📡 socket orders:status ⚠️', { id, error: String(e) });
    }

    // SSE
    try {
      sse.broadcast('order-status', { id, status, order: full });
    } catch (e) {
      logger.warn('🧵 SSE broadcast order-status ⚠️', { id, error: String(e) });
    }

    // notify (cliente)
    try { await notify.onOrderStatus(full, status); }
    catch (e) { logger.error('🔔 notify STATUS ❌', { id, status, error: String(e) }); }

    res.json({ ok: true, id, status });
  } catch (err) {
    logger.error('❌ [PATCH] /api/orders/:id/status', { id, error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---------------- STREAM SSE -------------------------------------------------
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');

  res.write(`event: hello\n`);
  res.write(`data: ${JSON.stringify({ ok: true, t: Date.now() })}\n\n`);

  sse.add(res);

  const ping = setInterval(() => {
    try { res.write(`event: ping\ndata: ${Date.now()}\n\n`); } catch (_) {}
  }, 15000);

  req.on('close', () => {
    clearInterval(ping);
    sse.remove(res);
  });
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
const router  = express.Router();

const logger = require('../logger');
const env    = require('../env');
const svc    = require('../services/reservations.service');

// === requireAuth con fallback DEV ============================================
let requireAuth;
try {
  ({ requireAuth } = require('./auth'));
  if (typeof requireAuth !== 'function') throw new Error('requireAuth non è una funzione');
  logger.info('🔐 requireAuth caricato da ./auth');
} catch (e) {
  logger.warn('⚠️ requireAuth non disponibile. Uso FALLBACK DEV (solo locale).');
  requireAuth = (req, _res, next) => {
    req.user = {
      id: Number(process.env.AUTH_DEV_ID || 0),
      email: process.env.AUTH_DEV_USER || 'dev@local'
    };
    next();
  };
}

// Azioni di stato + audit (state machine già esistente)
const resvActions = require('../services/reservations-status.service'); // path corretto
// Mailer (esistente)
const mailer = require('../services/mailer.service');
// WhatsApp (esistente)
const wa = require('../services/whatsapp.service');

// ================================ LIST =======================================
// GET /api/reservations?status=&from=&to=&q=
router.get('/', async (req, res) => {
  try {
    const filter = {
      status: req.query.status || undefined,
      from  : req.query.from   || undefined,
      to    : req.query.to     || undefined,
      q     : req.query.q      || undefined,
    };
    logger.info('📥 [GET] /api/reservations', { service: 'server', filter });
    const rows = await svc.list(filter);
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// ================================ SUPPORT ====================================
// GET /api/reservations/support/count-by-status?from=&to=
router.get('/support/count-by-status', async (req, res) => {
  try {
    const from = req.query.from || null;
    const to   = req.query.to   || null;
    const rows = await svc.countByStatus({ from, to });
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations/support/count-by-status', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// ================================ CRUD =======================================

router.get('/:id(\\d+)', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  try {
    const r = await svc.getById(id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    res.json(r);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations/:id', { id, error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const dto = req.body || {};
    const r = await svc.create(dto, { user: req.user });
    logger.info('➕ [POST] /api/reservations OK', { id: r.id });
    res.status(201).json(r);
  } catch (err) {
    logger.error('❌ [POST] /api/reservations', { error: String(err) });
    res.status(500).json({ error: err.message || 'internal_error' });
  }
});

router.put('/:id(\\d+)', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  try {
    const dto = req.body || {};
    const r = await svc.update(id, dto, { user: req.user });
    if (!r) return res.status(404).json({ error: 'not_found' });
    logger.info('✏️ [PUT] /api/reservations/:id OK', { id });
    res.json(r);
  } catch (err) {
    logger.error('❌ [PUT] /api/reservations/:id', { id, error: String(err) });
    res.status(500).json({ error: err.message || 'internal_error' });
  }
});

// ========================== CAMBIO STATO + NOTIFICHE =========================
// PUT /api/reservations/:id/status  body { action, reason?, notify?, email?, reply_to? }
router.put('/:id(\\d+)/status', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const action   = (req.body?.action || '').toString().trim();
  const reason   = (req.body?.reason || '').toString().trim() || null;
  const notify   = (req.body?.notify !== undefined) ? !!req.body.notify : undefined; // se omesso decide env
  const toEmail  = (req.body?.email || '').toString().trim() || null;   // override
  const replyTo  = (req.body?.reply_to || '').toString().trim() || null;

  if (!action) return res.status(400).json({ error: 'missing_action' });

  try {
    // Applica la transizione (state machine già esistente con audit)
    const updated = await resvActions.updateStatus({
      reservationId: id,
      action,
      reason,
      user: req.user
    });

    // === EMAIL (stessa logica già presente nel tuo snapshot) =================
    try {
      const mustNotify = (notify === true) || (notify === undefined && !!env.RESV?.notifyAlways);
      if (mustNotify) {
        const dest = toEmail || updated.contact_email || updated.email || null;
        if (dest) {
          await mailer.sendStatusChangeEmail({
            to: dest,
            reservation: updated,
            newStatus: updated.status,
            reason,
            replyTo
          });
          logger.info('📧 status-change mail ✅', { id, to: dest, status: updated.status });
        } else {
          logger.warn('📧 status-change mail SKIP (no email)', { id, status: updated.status });
        }
      } else {
        logger.info('📧 status-change mail SKIPPED by notify/env', { id, notify });
      }
    } catch (err) {
      logger.error('📧 status-change mail ❌', { id, error: String(err) });
    }

    // === WHATSAPP (Twilio) — stessa logica esistente =========================
    try {
      const waRes = await wa.sendStatusChange({
        to: updated.contact_phone || updated.phone || null,
        reservation: updated,
        status: updated.status,
        reason
      });
      if (waRes?.ok) {
        logger.info('📲 status-change WA ✅', { id, sid: waRes.sid });
      } else {
        logger.warn('📲 status-change WA skipped', { id, why: waRes?.reason || 'unknown' });
      }
    } catch (err) {
      logger.error('📲 status-change WA ❌', { id, error: String(err) });
    }

    return res.json({ ok: true, reservation: updated });
  } catch (err) {
    logger.error('❌ [PUT] /api/reservations/:id/status', { id, error: String(err) });
    return res.status(400).json({ error: err.message || 'invalid_transition' });
  }
});

// ================== REJECT + EMAIL + WHATSAPP (dedicato) =====================
// POST /api/reservations/:id/reject-notify  body { reason, email?, reply_to? }
router.post('/:id(\\d+)/reject-notify', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const reason   = (req.body?.reason || '').toString().trim() || null;
  const toEmail  = (req.body?.email || '').toString().trim() || null;
  const replyTo  = (req.body?.reply_to || '').toString().trim() || null;

  try {
    const existing = await svc.getById(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const updated = await resvActions.updateStatus({
      reservationId: id,
      action: 'reject',
      reason,
      user: req.user
    });

    // email dedicata al rifiuto
    try {
      const dest = toEmail || updated.contact_email || updated.email || null;
      if (dest) {
        const sent = await mailer.sendReservationRejectionEmail({
          to: dest,
          reservation: updated,
          reason,
          replyTo,
        });
        logger.info('📧 reject-notify ✅', { id, to: dest, messageId: sent?.messageId });
      } else {
        logger.warn('📧 reject-notify: nessuna email disponibile', { id });
      }
    } catch (err) {
      logger.error('📧 reject-notify ❌', { id, error: String(err) });
    }

    // whatsapp
    try {
      const waRes = await wa.sendStatusChange({
        to: updated.contact_phone || updated.phone || null,
        reservation: updated,
        status: updated.status,
        reason,
      });
      if (waRes?.ok) {
        logger.info('📲 reject-notify WA ✅', { id, sid: waRes.sid });
      } else {
        logger.warn('📲 reject-notify WA skipped', { id, reason: waRes?.reason });
      }
    } catch (err) {
      logger.error('📲 reject-notify WA ❌', { id, error: String(err) });
    }

    return res.json({ ok: true, reservation: updated });
  } catch (err) {
    logger.error('❌ reject-notify', { id, error: String(err) });
    return res.status(500).json({ error: err.message || 'internal_error' });
  }
});

// ============================== DELETE (HARD) ================================
// DELETE /api/reservations/:id?force=true|false
// Regola: allowed se status='cancelled'. Se RESV_ALLOW_DELETE_ANY_STATUS=true o force=true → qualsiasi stato.
router.delete('/:id(\\d+)', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const forceParam = String(req.query.force || '').toLowerCase();
  const force = (forceParam === '1' || forceParam === 'true' || forceParam === 'yes');

  const allowAnyByEnv =
    (env.RESV && env.RESV.allowDeleteAnyStatus === true) ||
    (String(process.env.RESV_ALLOW_DELETE_ANY_STATUS || '').toLowerCase() === 'true');

  try {
    const existing = await svc.getById(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    // Policy
    const canAny = allowAnyByEnv || force;
    if (!canAny && String(existing.status || '').toLowerCase() !== 'cancelled') {
      return res.status(409).json({
        error: 'delete_not_allowed',
        message: 'Puoi eliminare solo prenotazioni in stato CANCELLED (usa ?force=true o abilita RESV_ALLOW_DELETE_ANY_STATUS).'
      });
    }

    const ok = await svc.remove(id, { user: req.user, reason: 'hard-delete' });
    if (!ok) return res.status(500).json({ error: 'delete_failed' });

    logger.info('🗑️ [DELETE] /api/reservations/:id OK', { id, force, allowAnyByEnv, status: existing.status });
    return res.json({ ok: true, id });
  } catch (err) {
    logger.error('❌ [DELETE] /api/reservations/:id', { id, error: String(err) });
    res.status(500).json({ error: err.message || 'internal_error' });
  }
});

// ================================ PRINT ======================================
const printerSvc = require('../services/thermal-printer.service');

// POST /api/reservations/print/daily  body { date, status? }
router.post('/print/daily', requireAuth, async (req, res) => {
  try {
    const date = (req.body?.date || '').toString().slice(0,10);
    const status = (req.body?.status || 'all').toString().toLowerCase();

    const rows = await svc.list({ from: date, to: date, status: status === 'all' ? undefined : status });
    const out = await printerSvc.printDailyReservations({
      date,
      rows,
      user: req.user,
      logoText: process.env.BIZ_NAME || 'LA MIA ATTIVITÀ'
    });
    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/daily', { error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// POST /api/reservations/print/placecards  body { date, status?, qr_base_url? }
router.post('/print/placecards', requireAuth, async (req, res) => {
  try {
    const date   = (req.body?.date || '').toString().slice(0,10);
    const status = (req.body?.status || 'accepted').toString().toLowerCase();
    const qrBaseUrl = req.body?.qr_base_url || process.env.QR_BASE_URL || '';

    const rows = await svc.list({ from: date, to: date, status });
    const out = await printerSvc.printPlaceCards({
      date,
      rows,
      user: req.user,
      logoText: process.env.BIZ_NAME || 'LA MIA ATTIVITÀ',
      qrBaseUrl
    });
    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/placecards', { error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// POST /api/reservations/:id/print/placecard
router.post('/:id(\\d+)/print/placecard', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });

    const r = await svc.getById(id);
    if (!r) return res.status(404).json({ error: 'not_found' });

    const qrBaseUrl = req.body?.qr_base_url || process.env.QR_BASE_URL || '';

    const out = await printerSvc.printPlaceCards({
      date: (r.start_at || '').toString().slice(0, 10),
      rows: [r],
      user: req.user,
      logoText: process.env.BIZ_NAME || 'LA MIA ATTIVITÀ',
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

  // 🔐 AUTENTICAZIONE (bypass dev opzionale)
  AUTH: {
    devBypass   : toBool(process.env.AUTH_DEV_BYPASS, false),
    devUserEmail: process.env.AUTH_DEV_USER || 'dev@local',
    devUserId   : toInt(process.env.AUTH_DEV_ID, 0),
  },

  // 🔑 JWT per /api/auth (HS256)
  JWT: {
    secret     : process.env.JWT_SECRET || '',
    ttlSeconds : toInt(process.env.JWT_TTL_SECONDS, 60 * 60 * 8), // 8h
    issuer     : process.env.JWT_ISSUER || undefined,             // (facoltativo, non obbligatorio in verify attuale)
    audience   : process.env.JWT_AUDIENCE || undefined,           // (facoltativo)
  },

  // Prenotazioni
  RESV: {
    defaultLunchMinutes : toInt(process.env.RESV_LUNCH_MINUTES, 60),
    defaultDinnerMinutes: toInt(process.env.RESV_DINNER_MINUTES, 90),

    // override vecchi
    allowAcceptOverride : toBool(process.env.RESV_ALLOW_ACCEPT_OVERRIDE, false),

    // 🔁 transizioni
    allowBacktrack      : toBool(process.env.RESV_ALLOW_BACKTRACK, true),
    allowAnyTransition  : toBool(process.env.RESV_ALLOW_ANY_TRANSITION, true),
    forceTransitions    : toBool(process.env.RESV_FORCE_TRANSITIONS, false),

    // 📧 notifiche (mail) sempre su cambio stato
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

  // 🟢 WhatsApp via Twilio
  WA: {
    enabled     : toBool(process.env.WA_ENABLED, false),
    accountSid  : process.env.TWILIO_ACCOUNT_SID || '',
    authToken   : process.env.TWILIO_AUTH_TOKEN || '',
    from        : process.env.WA_FROM || '',           // 'whatsapp:+39....'
    defaultCc   : process.env.WA_DEFAULT_CC || '+39',
    mediaLogo   : process.env.WA_MEDIA_LOGO_URL || '',
    templateSid : process.env.WA_TEMPLATE_STATUS_CHANGE_SID || '',
  },

  // Util per debugging a runtime delle variabili
  _debugMailConfig() {
    const m = env.MAIL;
    return {
      enabled: m.enabled, host: m.host, port: m.port, secure: m.secure,
      user: mask(m.user, 3, 2), from: m.from, replyTo: m.replyTo,
      bizName: m.bizName, resvNotifyAlways: env.RESV.notifyAlways,
    };
  },
  _debugWaConfig() {
    const w = env.WA;
    return {
      enabled: w.enabled,
      accountSid: mask(w.accountSid, 4, 3),
      from: w.from,
      defaultCc: w.defaultCc,
      mediaLogo: w.mediaLogo ? '[set]' : '',
      templateSid: w.templateSid ? mask(w.templateSid, 4, 3) : '',
    };
  }
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
const env = require('../env');      // <<-- path corretta
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
      sub: payload.sub
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

module.exports = requireAuth;
module.exports.requireAuth = requireAuth;
module.exports.issueToken = (user) =>
  require('jsonwebtoken').sign({ sub: user.id, email: user.email }, env.JWT.secret, { expiresIn: env.JWT.ttlSeconds + 's' });
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

if (ensureExists('api/notifications', 'API /api/notifications')) {
  app.use('/api/notifications', require('./api/notifications'));
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
 * Mailer resiliente per cambi stato prenotazioni.
 * - Gmail con App Password OK (465 secure:true OPPURE 587 secure:false)
 * - Log estesi con env (masked) per diagnosi
 */

const nodemailer = require('nodemailer');
const logger = require('../logger');
const env    = require('../env');

let transporter = null;

/* Helpers ------------------------------------------------------------------ */
function safe(v) { return (v === undefined || v === null) ? '' : String(v); }

function statusLabelIT(s) {
  const m = { pending:'in attesa', accepted:'accettata', rejected:'rifiutata', cancelled:'cancellata' };
  return m[String(s || '').toLowerCase()] || String(s || 'aggiornata');
}

function buildSubject(reservation, newStatus) {
  const id = reservation?.id ?? '?';
  const biz = env.MAIL?.bizName || 'Prenotazioni';
  const label = statusLabelIT(newStatus);
  return `${biz} — Prenotazione #${id} ${label}`;
}

function buildStatusHtml({ reservation, newStatus, reason }) {
  const name =
    safe(reservation?.display_name) ||
    [safe(reservation?.customer_first), safe(reservation?.customer_last)].filter(Boolean).join(' ') ||
    'Cliente';

  const dt    = safe(reservation?.start_at);
  const size  = reservation?.party_size ? Number(reservation.party_size) : '';
  const table = reservation?.table_name
    || (reservation?.table_number ? `Tavolo ${reservation.table_number}` : '');
  const statusText = statusLabelIT(newStatus);

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0 0 12px">${env.MAIL?.bizName || 'La Mia Attività'}</h2>
    <p>Ciao <b>${name}</b>,</p>
    <p>Lo stato della tua prenotazione <b>#${safe(reservation?.id)}</b> per il <b>${dt}</b> (persone: <b>${size}</b>${table ? `, ${table}` : ''}) è stato aggiornato a: <b>${statusText}</b>.</p>
    ${reason ? `<p><i>Motivo: ${safe(reason)}</i></p>` : ''}
    <p>Se hai domande rispondi pure a questa email.</p>
    <p>— ${env.MAIL?.bizName || 'Lo Staff'}</p>
  </div>`;
}

function buildRejectHtml({ reservation, reason }) {
  const name =
    safe(reservation?.display_name) ||
    [safe(reservation?.customer_first), safe(reservation?.customer_last)].filter(Boolean).join(' ') ||
    'Cliente';

  const dt    = safe(reservation?.start_at);
  const size  = reservation?.party_size ? Number(reservation.party_size) : '';
  const table = reservation?.table_name
    || (reservation?.table_number ? `Tavolo ${reservation.table_number}` : '');

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0 0 12px">${env.MAIL?.bizName || 'La Mia Attività'}</h2>
    <p>Ciao <b>${name}</b>,</p>
    <p>Ci dispiace, la tua prenotazione <b>#${safe(reservation?.id)}</b> per il <b>${dt}</b> (persone: <b>${size}</b>${table ? `, ${table}` : ''}) è stata <b>rifiutata</b>.</p>
    ${reason ? `<p><i>Motivo: ${safe(reason)}</i></p>` : ''}
    <p>Per qualsiasi esigenza puoi rispondere a questa email.</p>
    <p>— ${env.MAIL?.bizName || 'Lo Staff'}</p>
  </div>`;
}

/* Transporter -------------------------------------------------------------- */
function getTransporter() {
  if (!env.MAIL?.enabled) {
    logger.warn('📧 MAIL DISABLED by env', { service: 'server' });
    return null;
  }
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host  : env.MAIL.host,
    port  : Number(env.MAIL.port || 465),
    secure: !!env.MAIL.secure,
    auth  : { user: env.MAIL.user, pass: env.MAIL.pass }
  });

  return transporter;
}

async function verifySmtp() {
  const t = getTransporter();
  if (!t) return { ok: false, reason: 'disabled' };
  try {
    await t.verify();
    logger.info('📧 SMTP verify OK', { env: env._debugMailConfig?.() });
    return { ok: true };
  } catch (err) {
    logger.error('📧 SMTP verify FAILED', { error: String(err), env: env._debugMailConfig?.() });
    return { ok: false, error: String(err) };
  }
}

/* API ----------------------------------------------------------------------- */
async function sendStatusChangeEmail({ to, reservation, newStatus, reason, replyTo }) {
  if (!env.MAIL?.enabled) {
    logger.warn('📧 MAIL SKIPPED (disabled)', { id: reservation?.id });
    return { sent: false, reason: 'disabled' };
  }

  const dest = safe(to).trim();
  if (!dest) {
    logger.warn('📧 MAIL SKIPPED (no_recipient)', { id: reservation?.id, env_mail: env._debugMailConfig?.() });
    return { sent: false, reason: 'no_recipient' };
  }

  const t = getTransporter();
  if (!t) return { sent: false, reason: 'no_transporter' };

  const subject = buildSubject(reservation || {}, newStatus || reservation?.status || 'updated');
  const html    = buildStatusHtml({ reservation: reservation || {}, newStatus, reason });

  const mail = {
    from   : env.MAIL.from,
    to     : dest,
    subject,
    html,
    replyTo: safe(replyTo) || (env.MAIL.replyTo || undefined),
  };

  logger.debug('📧 MAIL OUT', { id: reservation?.id, to: dest, subject });
  const info = await t.sendMail(mail);
  logger.info('📧 MAIL SENT', { id: reservation?.id, to: dest, messageId: info?.messageId });
  return { sent: true, messageId: info?.messageId };
}

async function sendReservationRejectionEmail({ to, reservation, reason, replyTo }) {
  if (!env.MAIL?.enabled) {
    logger.warn('📧 MAIL SKIPPED (disabled)', { id: reservation?.id });
    return { sent: false, reason: 'disabled' };
  }
  const dest = safe(to).trim();
  if (!dest) {
    logger.warn('📧 MAIL SKIPPED (no_recipient)', { id: reservation?.id });
    return { sent: false, reason: 'no_recipient' };
  }
  const t = getTransporter();
  if (!t) return { sent: false, reason: 'no_transporter' };

  const subject = (env.MAIL?.bizName || 'Prenotazioni') + ` — Prenotazione #${reservation?.id} rifiutata`;
  const html    = buildRejectHtml({ reservation, reason });

  const mail = {
    from: env.MAIL.from,
    to: dest,
    subject,
    html,
    replyTo: safe(replyTo) || (env.MAIL.replyTo || undefined),
  };

  logger.debug('📧 MAIL OUT (reject)', { id: reservation?.id, to: dest, subject });
  const info = await t.sendMail(mail);
  logger.info('📧 MAIL SENT (reject)', { id: reservation?.id, to: dest, messageId: info?.messageId });
  return { sent: true, messageId: info?.messageId };
}

module.exports = {
  getTransporter,
  verifySmtp,
  sendStatusChangeEmail,
  sendReservationRejectionEmail,
};
```

### ./src/services/notify.service.js
```
'use strict';

/**
 * services/notify.service.js
 * -----------------------------------------------------------------------------
 * Orchestratore notifiche per ORDINI:
 * - EMAIL (riusa env.MAIL; usa nodemailer direttamente se il tuo mailer non ha metodi “order”)
 * - WHATSAPP (riusa services/whatsapp.service se presente; fallback Twilio diretto)
 */

const logger = require('../logger');
const env = require('../env');
const nodemailer = require('nodemailer');

let cachedTransport = null;
function getTransport() {
  if (cachedTransport) return cachedTransport;
  const m = env.MAIL;
  if (!m || !m.enabled) return null;
  cachedTransport = nodemailer.createTransport({
    host: m.host, port: m.port, secure: m.secure,
    auth: (m.user && m.pass) ? { user: m.user, pass: m.pass } : undefined
  });
  return cachedTransport;
}

function fmtOrderLines(order) {
  const lines = (order.items || []).map(it =>
    `• ${it.qty}× ${it.name}${it.notes ? ' (' + it.notes + ')' : ''} — € ${(Number(it.price) * Number(it.qty)).toFixed(2)}`
  );
  return lines.join('\n');
}
function subjectNew(order) {
  return `${env.MAIL?.bizName || 'Pizzeria'} — Nuovo ordine #${order.id}`;
}
function subjectStatus(order, status) {
  const lab = String(status).toUpperCase();
  return `${env.MAIL?.bizName || 'Pizzeria'} — Ordine #${order.id} ${lab}`;
}

async function sendEmailNew(order) {
  const t = getTransport();
  if (!t) {
    logger.warn('📧 email disabled, skip new-order', env._debugMailConfig());
    return { ok: false, reason: 'mail_disabled' };
  }
  const adminTo = process.env.MAIL_ADMIN || env.MAIL?.user || '';
  const customerTo = order.email || '';

  const text = [
    `Nuovo ordine #${order.id}`,
    `Cliente: ${order.customer_name || '-'}`,
    `Telefono: ${order.phone || '-'}`,
    `Email: ${order.email || '-'}`,
    `Persone: ${order.people || 1}`,
    `Programmazione: ${order.scheduled_at || '-'}`,
    `Canale: ${order.channel || 'online'}`,
    '',
    `Righe:\n${fmtOrderLines(order)}`,
    '',
    `Totale: € ${Number(order.total).toFixed(2)}`,
    '',
    `Note: ${order.note || '-'}`,
  ].join('\n');

  const opts = {
    from: env.MAIL?.from,
    to: adminTo,
    subject: subjectNew(order),
    text,
    replyTo: env.MAIL?.replyTo || undefined
  };

  const out = { admin: null, customer: null };

  try {
    out.admin = await t.sendMail(opts);
    logger.info('📧 ordine NEW → admin ✅', { id: order.id, messageId: out.admin?.messageId });
  } catch (e) {
    logger.error('📧 ordine NEW → admin ❌', { id: order.id, error: String(e) });
  }

  if (customerTo) {
    try {
      out.customer = await t.sendMail({ ...opts, to: customerTo });
      logger.info('📧 ordine NEW → customer ✅', { id: order.id, messageId: out.customer?.messageId });
    } catch (e) {
      logger.error('📧 ordine NEW → customer ❌', { id: order.id, error: String(e) });
    }
  }
  return { ok: true, out };
}

async function sendEmailStatus(order, status) {
  const t = getTransport();
  if (!t) {
    logger.warn('📧 email disabled, skip status', env._debugMailConfig());
    return { ok: false, reason: 'mail_disabled' };
  }
  const to = order.email || '';
  if (!to) return { ok: false, reason: 'no_customer_email' };

  const text = [
    `Ciao ${order.customer_name || ''},`,
    `il tuo ordine #${order.id} è ora: ${String(status).toUpperCase()}.`,
    '',
    `Righe:\n${fmtOrderLines(order)}`,
    '',
    `Totale: € ${Number(order.total).toFixed(2)}`
  ].join('\n');

  try {
    const r = await t.sendMail({
      from: env.MAIL?.from,
      to,
      subject: subjectStatus(order, status),
      text,
      replyTo: env.MAIL?.replyTo || undefined
    });
    logger.info('📧 ordine STATUS → customer ✅', { id: order.id, status, messageId: r?.messageId });
    return { ok: true, r };
  } catch (e) {
    logger.error('📧 ordine STATUS → customer ❌', { id: order.id, status, error: String(e) });
    return { ok: false, reason: String(e) };
  }
}

async function sendWhatsAppNew(order) {
  // Prova a riusare il tuo services/whatsapp.service (se presente).
  try {
    const wa = require('./whatsapp.service');
    if (typeof wa.sendText === 'function') {
      const body = `Nuovo ordine #${order.id}\n${order.customer_name || ''}\nTotale € ${Number(order.total).toFixed(2)}`;
      return await wa.sendText(order.phone, body);
    }
  } catch (_) {}

  // Fallback Twilio diretto (se WA_ENABLED e credenziali presenti)
  if (!env.WA?.enabled) return { ok: false, reason: 'wa_disabled' };
  const { accountSid, authToken, from } = env.WA;
  if (!accountSid || !authToken || !from) return { ok: false, reason: 'wa_misconfigured' };

  const twilio = require('twilio')(accountSid, authToken);
  const to = (order.phone || '').startsWith('whatsapp:') ? order.phone : `whatsapp:${order.phone}`;
  try {
    const msg = await twilio.messages.create({
      from,
      to,
      body: `Ciao! Abbiamo ricevuto il tuo ordine #${order.id}. Totale € ${Number(order.total).toFixed(2)}. Ti avviseremo sugli aggiornamenti.`
    });
    logger.info('📲 WA NEW ✅', { sid: msg.sid });
    return { ok: true, sid: msg.sid };
  } catch (e) {
    logger.error('📲 WA NEW ❌', { error: String(e) });
    return { ok: false, reason: String(e) };
  }
}

async function sendWhatsAppStatus(order, status) {
  try {
    const wa = require('./whatsapp.service');
    if (typeof wa.sendText === 'function') {
      const body = `Aggiornamento ordine #${order.id}: ${String(status).toUpperCase()}`;
      return await wa.sendText(order.phone, body);
    }
  } catch (_) {}

  if (!env.WA?.enabled) return { ok: false, reason: 'wa_disabled' };
  const { accountSid, authToken, from } = env.WA;
  if (!accountSid || !authToken || !from) return { ok: false, reason: 'wa_misconfigured' };
  const twilio = require('twilio')(accountSid, authToken);
  const to = (order.phone || '').startsWith('whatsapp:') ? order.phone : `whatsapp:${order.phone}`;
  try {
    const msg = await twilio.messages.create({
      from, to,
      body: `Aggiornamento: il tuo ordine #${order.id} è ora ${String(status).toUpperCase()}.`
    });
    logger.info('📲 WA STATUS ✅', { sid: msg.sid, status });
    return { ok: true, sid: msg.sid };
  } catch (e) {
    logger.error('📲 WA STATUS ❌', { error: String(e), status });
    return { ok: false, reason: String(e) };
  }
}

module.exports = {
  async onOrderCreated(order) {
    // Email admin + cliente
    try { await sendEmailNew(order); } catch (e) { logger.error('🔔 email NEW ❌', { error: String(e) }); }
    // WhatsApp cliente (se configurato)
    try { await sendWhatsAppNew(order); } catch (e) { logger.error('🔔 WA NEW ❌', { error: String(e) }); }
  },
  async onOrderStatus(order, status) {
    try { await sendEmailStatus(order, status); } catch (e) { logger.error('🔔 email STATUS ❌', { error: String(e) }); }
    try { await sendWhatsAppStatus(order, status); } catch (e) { logger.error('🔔 WA STATUS ❌', { error: String(e) }); }
  }
};
```

### ./src/services/orders.service.js
```
'use strict';

/**
 * services/orders.service.js
 * -----------------------------------------------------------------------------
 * Query e operazioni transazionali per ORDINI.
 * - Stile: log con emoji, errori espliciti.
 * - Transazioni con pool.getConnection() per header+righe atomiche.
 */

const { pool, query } = require('../db');
const logger = require('../logger');

// Helpers ---------------------------------------------------------------------
function toInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function toMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function nowIso() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

// Service ---------------------------------------------------------------------
const Orders = {
  /**
   * Crea un ordine con le righe in transazione.
   * dto: {
   *  customer_name, phone, email?, people?, scheduled_at?, note?, channel?,
   *  items: [{ product_id?, name, qty, price, notes? }]
   * }
   */
  async create(dto) {
    if (!dto || !Array.isArray(dto.items) || dto.items.length === 0) {
      throw new Error('missing_items');
    }
    const items = dto.items.map(it => ({
      product_id: it.product_id ?? null,
      name: String(it.name || '').trim(),
      qty: toInt(it.qty, 1),
      price: toMoney(it.price),
      notes: (it.notes ?? null) ? String(it.notes).trim() : null,
    })).filter(it => it.name && it.qty > 0);

    if (!items.length) throw new Error('invalid_items');

    const total = items.reduce((acc, it) => acc + (it.qty * it.price), 0);

    const header = {
      customer_name: String(dto.customer_name || '').trim() || null,
      phone: (dto.phone || dto.customer_phone || null),
      email: (dto.email || dto.customer_email || null),
      people: toInt(dto.people, 1),
      scheduled_at: dto.scheduled_at ? String(dto.scheduled_at).slice(0, 19) : null,
      note: dto.note ? String(dto.note).trim() : null,
      channel: (dto.channel || 'online').toString().toLowerCase(),
      status: 'pending',
      total: toMoney(total),
      created_at: nowIso()
    };

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [res] = await conn.query(
        `INSERT INTO orders
         (customer_name, phone, email, people, scheduled_at, note, channel, status, total, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [header.customer_name, header.phone, header.email, header.people, header.scheduled_at,
         header.note, header.channel, header.status, header.total, header.created_at]
      );

      const orderId = Number(res.insertId);

      const values = [];
      const params = [];
      for (const it of items) {
        values.push('(?,?,?,?,?,?,?)');
        params.push(orderId, it.product_id, it.name, it.qty, it.price, it.notes, nowIso());
      }

      await conn.query(
        `INSERT INTO order_items
         (order_id, product_id, name, qty, price, notes, created_at)
         VALUES ${values.join(',')}`,
        params
      );

      await conn.commit();

      logger.info('🆕 ORDINE creato ✅', { id: orderId, items: items.length, total: header.total });
      return { id: orderId, ...header };
    } catch (err) {
      await conn.rollback();
      logger.error('💥 ORDINE create ❌ ROLLBACK', { error: String(err) });
      throw err;
    } finally {
      conn.release();
    }
  },

  async setStatus(id, status) {
    const valid = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!valid.includes(String(status))) throw new Error('invalid_status');

    await query(
      `UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? LIMIT 1`,
      [status, id]
    );
    logger.info('✏️ ORDINE status aggiornato', { id, status });
    return true;
  },

  /** Lista “header” (senza righe) */
  async listHeaders() {
    const rows = await query(
      `SELECT id, customer_name, phone, email, people, scheduled_at, status, total, channel, created_at, updated_at
       FROM orders
       ORDER BY id DESC
       LIMIT 500`
    );
    return rows;
  },

  /** Lista completa con righe (hydrate) */
  async listFull() {
    const headers = await this.listHeaders();
    if (!headers.length) return [];
    const ids = headers.map(h => h.id);
    const items = await query(
      `SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
      ids
    );
    const map = new Map(headers.map(h => [h.id, { ...h, items: [] }]));
    for (const it of items) {
      const h = map.get(it.order_id);
      if (h) h.items.push(it);
    }
    return Array.from(map.values());
  },

  async listByStatus(status) {
    const rows = await query(
      `SELECT id, customer_name, phone, email, people, scheduled_at, status, total, channel, created_at, updated_at
       FROM orders
       WHERE status=?
       ORDER BY id DESC
       LIMIT 500`,
      [status]
    );
    return rows;
  },

  async listLastHours(hours = 24) {
    const h = Math.max(1, Math.min(168, parseInt(hours, 10) || 24)); // 1..168
    const rows = await query(
      `SELECT id, customer_name, phone, email, people, scheduled_at, status, total, channel, created_at, updated_at
       FROM orders
       WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? HOUR)
       ORDER BY id DESC`,
      [h]
    );
    return rows;
  }
};

module.exports = Orders;
```

### ./src/services/orders.sse.js
```
'use strict';

/**
 * services/orders.sse.js
 * -----------------------------------------------------------------------------
 * Semplice broadcaster SSE in-memory.
 * - add(res): registra un client
 * - remove(res): deregistra
 * - broadcast(event, payload): invia a tutti
 */

const logger = require('../logger');

const clients = new Set();

function add(res) {
  clients.add(res);
  logger.info('🧵 SSE client +1', { total: clients.size });
}
function remove(res) {
  clients.delete(res);
  logger.info('🧵 SSE client -1', { total: clients.size });
}
function send(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    // client probabilmente chiuso
    remove(res);
  }
}
function broadcast(event, data) {
  for (const res of Array.from(clients)) {
    send(res, event, data);
  }
}

module.exports = { add, remove, broadcast };
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
// Service “Reservations” — query DB per prenotazioni
// Stile: commenti lunghi, log con emoji, diagnostica chiara.

'use strict';

const { query } = require('../db');
const logger = require('../logger');
const env    = require('../env');

// --- Helpers -----------------------------------------------------------------
function trimOrNull(s) {
  const v = (s ?? '').toString().trim();
  return v ? v : null;
}
function toDayRange(fromYmd, toYmd) {
  const out = { from: null, to: null };
  if (fromYmd) out.from = `${fromYmd} 00:00:00`;
  if (toYmd)   out.to   = `${toYmd} 23:59:59`;
  return out;
}
function isoToMysql(iso) {
  if (!iso) return null;
  return iso.replace('T', ' ').slice(0, 19);
}
function computeEndAtFromStart(startAtIso) {
  const start = new Date(startAtIso);
  const addMin = (start.getHours() < 16
    ? (env.RESV?.defaultLunchMinutes || 90)
    : (env.RESV?.defaultDinnerMinutes || 120)
  );
  const end = new Date(start.getTime() + addMin * 60 * 1000);

  const pad = (n) => String(n).padStart(2, '0');
  const mysql = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

  return { startMysql: mysql(start), endMysql: mysql(end) };
}

// ensureUser: trova/crea utente e ritorna id (unique su email/phone)
async function ensureUser({ first, last, email, phone }) {
  const e = trimOrNull(email);
  const p = trimOrNull(phone);

  if (e) {
    const r = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [e]);
    if (r.length) return r[0].id;
  }
  if (p) {
    const r = await query('SELECT id FROM users WHERE phone = ? LIMIT 1', [p]);
    if (r.length) return r[0].id;
  }

  const res = await query(
    `INSERT INTO users (first_name, last_name, email, phone) VALUES (?, ?, ?, ?)`,
    [trimOrNull(first), trimOrNull(last), e, p]
  );
  return res.insertId;
}

// --- Core queries -------------------------------------------------------------
async function list(filter = {}) {
  const wh = [];
  const pr = [];

  if (filter.status) { wh.push('r.status = ?'); pr.push(String(filter.status)); }

  const { from, to } = toDayRange(filter.from, filter.to);
  if (from) { wh.push('r.start_at >= ?'); pr.push(from); }
  if (to)   { wh.push('r.start_at <= ?'); pr.push(to);   }

  if (filter.q) {
    const q = `%${String(filter.q).trim()}%`;
    wh.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR r.customer_first LIKE ? OR r.customer_last LIKE ? OR r.email LIKE ? OR r.phone LIKE ?)');
    pr.push(q, q, q, q, q, q, q, q);
  }

  const where = wh.length ? ('WHERE ' + wh.join(' AND ')) : '';
  const sql = `
    SELECT
      r.*,
      CONCAT_WS(' ', u.first_name, u.last_name) AS display_name,
      u.email  AS contact_email,
      u.phone  AS contact_phone,
      t.table_number,
      CONCAT('Tavolo ', t.table_number) AS table_name
    FROM reservations r
    LEFT JOIN users  u ON u.id = r.user_id
    LEFT JOIN tables t ON t.id = r.table_id
    ${where}
    ORDER BY r.start_at ASC, r.id ASC
  `;

  const rows = await query(sql, pr);
  return rows;
}

async function getById(id) {
  const sql = `
    SELECT
      r.*,
      CONCAT_WS(' ', u.first_name, u.last_name) AS display_name,
      u.email  AS contact_email,
      u.phone  AS contact_phone,
      t.table_number,
      CONCAT('Tavolo ', t.table_number) AS table_name
    FROM reservations r
    LEFT JOIN users  u ON u.id = r.user_id
    LEFT JOIN tables t ON t.id = r.table_id
    WHERE r.id = ?
    LIMIT 1
  `;
  const rows = await query(sql, [id]);
  return rows[0] || null;
}

async function create(dto, { user } = {}) {
  const userId = await ensureUser({
    first: dto.customer_first,
    last : dto.customer_last,
    email: dto.email,
    phone: dto.phone
  });

  const startIso = dto.start_at;
  const endIso   = dto.end_at || null;
  const { startMysql, endMysql } =
    endIso ? { startMysql: isoToMysql(startIso), endMysql: isoToMysql(endIso) }
           : computeEndAtFromStart(startIso);

  // room_id, created_by presenti (strada B)
  const res = await query(
    `INSERT INTO reservations
      (customer_first, customer_last, phone, email,
       user_id, party_size, start_at, end_at, room_id, table_id,
       notes, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
    [
      trimOrNull(dto.customer_first),
      trimOrNull(dto.customer_last),
      trimOrNull(dto.phone),
      trimOrNull(dto.email),
      userId,
      Number(dto.party_size) || 1,
      startMysql,
      endMysql,
      dto.room_id || null,
      dto.table_id || null,
      trimOrNull(dto.notes),
      trimOrNull(user?.email) || null
    ]
  );

  const created = await getById(res.insertId);
  logger.info('🆕 reservation created', { id: created.id, by: user?.email || null });
  return created;
}

async function update(id, dto, { user } = {}) {
  let userId = null;
  if (dto.customer_first !== undefined || dto.customer_last !== undefined || dto.email !== undefined || dto.phone !== undefined) {
    userId = await ensureUser({
      first: dto.customer_first,
      last : dto.customer_last,
      email: dto.email,
      phone: dto.phone
    });
  }

  let startMysql = null, endMysql = null;
  if (dto.start_at) {
    const endIso = dto.end_at || null;
    const c = endIso ? { startMysql: isoToMysql(dto.start_at), endMysql: isoToMysql(endIso) }
                     : computeEndAtFromStart(dto.start_at);
    startMysql = c.startMysql;
    endMysql   = c.endMysql;
  }

  const fields = [];
  const pr = [];

  if (userId !== null) { fields.push('user_id=?'); pr.push(userId); }
  if (dto.customer_first !== undefined) { fields.push('customer_first=?'); pr.push(trimOrNull(dto.customer_first)); }
  if (dto.customer_last  !== undefined) { fields.push('customer_last=?');  pr.push(trimOrNull(dto.customer_last));  }
  if (dto.phone          !== undefined) { fields.push('phone=?');          pr.push(trimOrNull(dto.phone));          }
  if (dto.email          !== undefined) { fields.push('email=?');          pr.push(trimOrNull(dto.email));          }

  if (dto.party_size !== undefined) { fields.push('party_size=?'); pr.push(Number(dto.party_size)||1); }
  if (startMysql) { fields.push('start_at=?'); pr.push(startMysql); }
  if (endMysql)   { fields.push('end_at=?');   pr.push(endMysql);   }

  if (dto.room_id  !== undefined) { fields.push('room_id=?');  pr.push(dto.room_id || null); }
  if (dto.table_id !== undefined) { fields.push('table_id=?'); pr.push(dto.table_id || null); }
  if (dto.notes    !== undefined) { fields.push('notes=?');    pr.push(trimOrNull(dto.notes)); }

  // updated_by
  fields.push('updated_by=?'); pr.push(trimOrNull(user?.email) || null);

  if (!fields.length) {
    logger.info('✏️ update: nessun campo da aggiornare', { id });
    return await getById(id);
  }

  pr.push(id);
  const sql = `UPDATE reservations SET ${fields.join(', ')} WHERE id=?`;
  await query(sql, pr);

  const updated = await getById(id);
  logger.info('✏️ reservation updated', { id, by: user?.email || null });
  return updated;
}

// --- Hard delete con policy ---------------------------------------------------
async function remove(id, { user, reason } = {}) {
  const existing = await getById(id);
  if (!existing) return false;

  const allowAnyByEnv =
    (env.RESV && env.RESV.allowDeleteAnyStatus === true) ||
    (String(process.env.RESV_ALLOW_DELETE_ANY_STATUS || '').toLowerCase() === 'true');

  const isCancelled = String(existing.status || '').toLowerCase() === 'cancelled';

  if (!allowAnyByEnv && !isCancelled) {
    logger.warn('🛡️ hard-delete NEGATO (stato non cancellato)', { id, status: existing.status });
    return false;
  }

  const res = await query('DELETE FROM reservations WHERE id=? LIMIT 1', [id]);
  const ok  = res.affectedRows > 0;

  if (ok) {
    logger.info('🗑️ reservation hard-deleted', { id, by: user?.email || null, reason: reason || null });
  } else {
    logger.error('💥 reservation delete KO', { id });
  }
  return ok;
}

// --- Supporto UI --------------------------------------------------------------
async function countByStatus({ from, to }) {
  const w = [];
  const p = [];

  const r = toDayRange(from, to);
  if (r.from) { w.push('start_at >= ?'); p.push(r.from); }
  if (r.to)   { w.push('start_at <= ?'); p.push(r.to);   }

  const where = w.length ? ('WHERE ' + w.join(' AND ')) : '';

  const rows = await query(
    `SELECT status, COUNT(*) AS count FROM reservations ${where} GROUP BY status`,
    p
  );

  const out = {};
  for (const r of rows) out[String(r.status)] = Number(r.count);
  return out;
}

// --- Sale / Tavoli (supporto UI) ---------------------------------------------
async function listRooms() {
  const sql = `
    SELECT id, name
    FROM rooms
    WHERE IFNULL(is_active,1)=1
    ORDER BY (sort_order IS NULL), sort_order, name
  `;
  return await query(sql, []);
}

async function listTablesByRoom(roomId) {
  const sql = `
    SELECT
      t.id,
      t.room_id,
      t.table_number,
      t.seats,
      CONCAT('Tavolo ', t.table_number) AS name
    FROM tables t
    WHERE t.room_id = ?
    ORDER BY t.table_number ASC, t.id ASC
  `;
  return await query(sql, [roomId]);
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  countByStatus,
  listRooms,
  listTablesByRoom,
};
```

### ./src/services/reservations-status.service.js
```
// === Servizio azioni stato (accept/reject/cancel) con audit + mail ===========
// Mantiene il tuo stile (commenti/emoji), ma abilita:
// - transizioni standard + override/backtrack (flag .env)
// - invio email su ogni cambio stato (se MAIL_ENABLED)
// - log dettagliati (from→to, utente, reason, config mail)

'use strict';

const db = require('../db');
const logger = require('../logger');
const env = require('../env');
const resvSvc = require('./reservations.service');

// Mailer opzionale: se manca, log warnings ma non blocco
let mailer = null;
try { mailer = require('./mailer.service'); }
catch { logger.warn('📧 mailer.service non disponibile: skip invio email'); }

/* Transazione con fallback: db.tx → pool.getConnection → db.query(callback) */
async function runTx(cb) {
  if (typeof db.tx === 'function') return db.tx(cb);

  if (db.pool && typeof db.pool.getConnection === 'function') {
    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await cb(conn);
      await conn.commit();
      return out;
    } catch (e) {
      try { await conn.rollback(); } catch {}
      throw e;
    } finally {
      conn.release();
    }
  }

  if (typeof db.query === 'function') {
    // opzionale: alcuni wrapper accettano una callback
    return db.query(cb);
  }

  throw new Error('Transazione non disponibile (servono db.tx o pool.getConnection)');
}

/* Mappa base delle transizioni consentite */
const BASE_ALLOWED = {
  pending  : new Set(['accepted', 'rejected', 'cancelled']),
  accepted : new Set(['cancelled', 'rejected']), // posso tornare indietro se abilitato
  rejected : new Set([]),
  cancelled: new Set([]),
};

function toNewStatus(action) {
  switch (action) {
    case 'accept': return 'accepted';
    case 'reject': return 'rejected';
    case 'cancel': return 'cancelled';
    default: return null;
  }
}

/* Flags runtime (env.js li espone già) */
function transitionsConfig() {
  return {
    allowBacktrack     : !!env.RESV?.allowBacktrack,
    allowAnyTransition : !!env.RESV?.allowAnyTransition,
    forceTransitions   : !!env.RESV?.forceTransitions,
    notifyAlways       : !!env.RESV?.notifyAlways,
  };
}

/**
 * Aggiorna lo stato in transazione e (se cambia davvero) invia email al cliente.
 * Input: { reservationId, action, reason?, user?, notify?, email?, replyTo? }
 */
async function updateStatus({ reservationId, action, reason, user, notify, email, replyTo }) {
  const wanted = toNewStatus(action);
  if (!wanted) {
    const e = new Error('Azione non valida. Usa: accept | reject | cancel');
    e.statusCode = 400; throw e;
  }
  const cfg = transitionsConfig();
  const trimmedReason = (typeof reason === 'string' ? reason.trim() : '') || null;

  // 1) Transazione: leggo stato attuale, valido, aggiorno, scrivo audit
  const txResult = await runTx(async (conn) => {
    // Stato attuale (FOR UPDATE)
    const [rows] = await conn.execute(
      'SELECT id, status FROM `reservations` WHERE id = ? FOR UPDATE', [reservationId]
    );
    if (!rows.length) {
      const e = new Error('not_found'); e.statusCode = 404; throw e;
    }
    const current = rows[0];
    let next = null;

    // Transizione standard
    const allowed = BASE_ALLOWED[current.status] || new Set();
    if (allowed.has(wanted)) next = wanted;

    // Override/backtrack/any
    if (!next && (cfg.allowAnyTransition || cfg.allowBacktrack || cfg.forceTransitions)) {
      next = wanted;
      logger.warn('🔁 RESV TRANSITION OVERRIDE', {
        service: 'server', id: reservationId, from: current.status, to: wanted, action
      });
    }

    if (!next) {
      const e = new Error(`Transizione non consentita: ${current.status} → ${wanted}`);
      e.statusCode = 409; throw e;
    }

    if (next === current.status) {
      // Niente da fare: no-op, non aggiorno DB né audit
      logger.info('⏸️ RESV status NO-OP', {
        service: 'server', id: reservationId, state: current.status, action
      });
      return { changed: false, snapshot: current };
    }

    // UPDATE principale
    await conn.execute(
      'UPDATE `reservations` SET status=?, status_note=?, status_changed_at=CURRENT_TIMESTAMP WHERE id=?',
      [next, trimmedReason, reservationId]
    );

    // AUDIT
    const userId = (user && user.id) || null;
    const userEmail = (user && user.email) || null;
    await conn.execute(
      'INSERT INTO `reservation_audit` (reservation_id, old_status, new_status, reason, user_id, user_email) VALUES (?,?,?,?,?,?)',
      [reservationId, current.status, next, trimmedReason, userId, userEmail]
    );

    logger.info('📝 RESV audit', {
      service: 'server',
      id: reservationId,
      from: current.status, to: next,
      by: userEmail || 'unknown',
      reason: trimmedReason || '-'
    });

    return { changed: true, from: current.status, to: next };
  });

  // 2) Snapshot aggiornato (JOIN ricca per avere email/display_name)
  const updated = await resvSvc.getById(reservationId);

  // 3) Notifica email (solo se c'è stato un cambio reale)
  if (txResult.changed && mailer && env.MAIL?.enabled) {
    const mustNotify = notify === true || cfg.notifyAlways;
    const to = (email && String(email).trim()) || (updated?.email || '').trim() || updated?.contact_email || '';
    if (mustNotify && to) {
      try {
        const info = await mailer.sendStatusChangeEmail({
          to,
          reservation: updated,
          action,
          reason: trimmedReason || undefined,
          replyTo
        });
        logger.info('📧 MAIL SENT', {
          service: 'server',
          id: reservationId,
          to,
          action,
          messageId: info?.messageId,
          env_mail: env._debugMailConfig?.()
        });
      } catch (e) {
        logger.error('📧 MAIL ERROR', {
          service: 'server',
          id: reservationId,
          error: String(e),
          env_mail: env._debugMailConfig?.()
        });
      }
    } else {
      logger.warn('📧 MAIL SKIPPED', {
        service: 'server',
        id: reservationId,
        reason: mustNotify ? 'no_recipient' : 'notify_disabled',
        env_mail: env._debugMailConfig?.()
      });
    }
  }

  return updated; // sempre lo snapshot finale
}

/** Restituisce l'audit (ultime N righe, default 50) */
async function getAudit({ reservationId, limit = 50 }) {
  const n = Number(limit) || 50;
  const [rows] = await db.query(
    'SELECT id, reservation_id, old_status, new_status, reason, user_email, created_at ' +
    'FROM `reservation_audit` WHERE reservation_id = ? ORDER BY created_at DESC LIMIT ?',
    [reservationId, n]
  );
  return rows;
}

module.exports = { updateStatus, getAudit };
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

### ./src/services/whatsapp.service.js
```
'use strict';

/**
 * WhatsApp service (Twilio) — invio messaggi di stato prenotazione.
 * - Usa template (se WA_TEMPLATE_STATUS_CHANGE_SID è impostato) oppure messaggio libero entro 24h.
 * - Normalizza numero in E.164 con prefisso di default (IT) se manca '+'.
 * - Log verbosi con emoji come il resto del progetto.
 */

const twilio = require('twilio');
const logger = require('../logger');
const env    = require('../env');

let client = null;
function getClient() {
  if (!env.WA?.enabled) return null;
  if (!client) {
    client = twilio(env.WA.accountSid, env.WA.authToken);
    logger.info('📳 WA client inizializzato', { service: 'server', wa_env: env._debugWaConfig?.() });
  }
  return client;
}

/** Grezza normalizzazione in E.164 (default IT): +39 + numero senza spazi */
function normalizeToE164(phone) {
  if (!phone) return null;
  let p = String(phone).trim();
  p = p.replace(/[^\d+]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return '+' + p.slice(2);
  return (env.WA.defaultCc || '+39') + p.replace(/^0+/, '');
}

/** Corpo testo semplice (IT) */
function buildStatusText({ status, dateYmd, timeHm, partySize, name, tableName }) {
  const S = String(status || '').toUpperCase();
  const n = name ? ` ${name}` : '';
  const when = (dateYmd && timeHm) ? ` per il ${dateYmd} alle ${timeHm}` : '';
  const pax = partySize ? ` (persone: ${partySize})` : '';
  const tbl = tableName ? ` • ${tableName}` : '';
  return `🟢 Aggiornamento prenotazione${n}:\nStato: ${S}${when}${pax}${tbl}\n— ${env.MAIL?.bizName || 'La tua attività'}`;
}

/**
 * Invia la notifica di cambio stato su WhatsApp.
 * options: { to, reservation, status, reason?, mediaLogo? }
 */
async function sendStatusChange({ to, reservation, status, reason, mediaLogo }) {
  if (!env.WA?.enabled) {
    logger.warn('📲 WA SKIPPED (disabled)', { id: reservation?.id });
    return { skipped: true, reason: 'disabled' };
  }

  const client = getClient();
  if (!client) {
    logger.error('📲 WA KO: client non inizializzato');
    throw new Error('WA client not initialized');
  }

  const phone = normalizeToE164(to || reservation?.contact_phone || reservation?.phone);
  if (!phone) {
    logger.warn('📲 WA SKIPPED (no phone)', { id: reservation?.id });
    return { skipped: true, reason: 'no_phone' };
  }

  // Dati testo
  const start = reservation?.start_at ? new Date(reservation.start_at) : null;
  const ymd = start ? `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}` : null;
  const hm  = start ? `${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')}` : null;
  const name = reservation?.display_name || [reservation?.customer_first, reservation?.customer_last].filter(Boolean).join(' ');
  const body = buildStatusText({
    status,
    dateYmd: ymd,
    timeHm : hm,
    partySize: reservation?.party_size,
    name,
    tableName: reservation?.table_name
  });

  // Template (Content API) se disponibile
  if (env.WA.templateSid) {
    const vars = {
      '1': name || 'Cliente',
      '2': String(status || '').toUpperCase(),
      '3': `${ymd || ''} ${hm || ''}`.trim(),
      '4': String(reservation?.party_size || ''),
      '5': reservation?.table_name || '',
      '6': reason || ''
    };

    logger.info('📲 WA template send ▶️', { to: phone, templateSid: env.WA.templateSid, vars });
    const msg = await client.messages.create({
      from: env.WA.from,
      to  : `whatsapp:${phone}`,
      contentSid: env.WA.templateSid,
      contentVariables: JSON.stringify(vars),
    });
    logger.info('📲 WA template OK', { sid: msg.sid, to: phone });
    return { ok: true, sid: msg.sid, template: true };
  }

  // Freeform (entro 24h)
  const payload = { from: env.WA.from, to: `whatsapp:${phone}`, body };
  const media = mediaLogo || env.WA.mediaLogo;
  if (media) payload.mediaUrl = [media];

  logger.info('📲 WA freeform send ▶️', { to: phone, media: !!media });
  const msg = await client.messages.create(payload);
  logger.info('📲 WA freeform OK', { sid: msg.sid, to: phone });
  return { ok: true, sid: msg.sid, template: false };
}

module.exports = {
  sendStatusChange,
  _normalizeToE164: normalizeToE164,
};
```

### ./src/services/whatsapp-twilio.service.js
```
'use strict';

/**
 * WhatsApp service (Twilio) — invio messaggi di stato prenotazione.
 * - Usa template (se WA_TEMPLATE_STATUS_CHANGE_SID è impostato) oppure messaggio libero entro 24h.
 * - Normalizza numero in E.164 con prefisso di default (IT) se manca '+'.
 * - Log verbosi con emoji come il resto del progetto.
 */

const twilio = require('twilio');
const logger = require('../logger');
const env = require('../env');

let client = null;
function getClient() {
  if (!env.WA.enabled) {
    return null;
  }
  if (!client) {
    client = twilio(env.WA.accountSid, env.WA.authToken);
    logger.info('📳 WA client inizializzato', { service: 'server', wa_env: env._debugWaConfig() });
  }
  return client;
}

/** Grezza normalizzazione in E.164 (default IT): +39 + numero senza spazi */
function normalizeToE164(phone) {
  if (!phone) return null;
  let p = String(phone).trim();
  // rimuovo spazi e non cifre (tranne +)
  p = p.replace(/[^\d+]/g, '');
  if (p.startsWith('+')) return p;
  // se inizia con 00, converto in +
  if (p.startsWith('00')) return '+' + p.slice(2);
  // fallback: aggiungo prefisso di default
  return (env.WA.defaultCc || '+39') + p.replace(/^0+/, '');
}

/**
 * buildStatusText: corpo del messaggio in IT
 */
function buildStatusText({ status, dateYmd, timeHm, partySize, name, tableName }) {
  const S = String(status || '').toUpperCase();
  const n = name ? ` ${name}` : '';
  const when = (dateYmd && timeHm) ? ` per il ${dateYmd} alle ${timeHm}` : '';
  const pax = partySize ? ` (persone: ${partySize})` : '';
  const tbl = tableName ? ` • ${tableName}` : '';
  return `🟢 Aggiornamento prenotazione${n}:\nStato: ${S}${when}${pax}${tbl}\n— ${env.MAIL.bizName}`;
}

/**
 * Invia la notifica di cambio stato su WhatsApp.
 * options:
 *  - to (telefono cliente)
 *  - reservation (oggetto prenotazione: per testo)
 *  - status (nuovo stato)
 *  - reason (opzionale)
 *  - mediaLogo (URL immagine da allegare — opzionale; se non passato usa env.WA.mediaLogo)
 */
async function sendStatusChange({ to, reservation, status, reason, mediaLogo }) {
  if (!env.WA.enabled) {
    logger.warn('📲 WA SKIPPED (disabled)', { service: 'server', id: reservation?.id });
    return { skipped: true, reason: 'disabled' };
  }

  const client = getClient();
  if (!client) {
    logger.error('📲 WA KO: client non inizializzato', { service: 'server' });
    throw new Error('WA client not initialized');
  }

  const phone = normalizeToE164(to || reservation?.contact_phone || reservation?.phone);
  if (!phone) {
    logger.warn('📲 WA SKIPPED (no phone)', { service: 'server', id: reservation?.id });
    return { skipped: true, reason: 'no_phone' };
  }

  // Dati testo
  const start = reservation?.start_at ? new Date(reservation.start_at) : null;
  const ymd = start ? `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}` : null;
  const hm  = start ? `${String(start.getHours()).padStart(2,'0')}:${String(start.getMinutes()).padStart(2,'0')}` : null;
  const name = reservation?.display_name || [reservation?.customer_first, reservation?.customer_last].filter(Boolean).join(' ');
  const body = buildStatusText({
    status,
    dateYmd: ymd,
    timeHm: hm,
    partySize: reservation?.party_size,
    name,
    tableName: reservation?.table_name
  });

  // Se ho un template SID uso Content API (consigliato per fuori 24h)
  if (env.WA.templateSid) {
    const vars = {
      // es: nel template puoi usare {{1}}, {{2}}, ... (dipende dal tuo template approvato)
      '1': name || 'Cliente',
      '2': String(status || '').toUpperCase(),
      '3': `${ymd || ''} ${hm || ''}`.trim(),
      '4': String(reservation?.party_size || ''),
      '5': reservation?.table_name || '',
      '6': reason || ''
    };
    logger.info('📲 WA template send ▶️', { service: 'server', to: phone, templateSid: env.WA.templateSid, vars });

    const msg = await client.messages.create({
      from: env.WA.from,                 // 'whatsapp:+1XXXX' (tuo numero approvato)
      to:   `whatsapp:${phone}`,
      contentSid: env.WA.templateSid,    // template approvato su WhatsApp Manager
      contentVariables: JSON.stringify(vars),
    });

    logger.info('📲 WA template OK', { service: 'server', sid: msg.sid, to: phone });
    return { ok: true, sid: msg.sid, template: true };
  }

  // Altrimenti messaggio libero (vale solo entro 24h di sessione)
  const payload = {
    from: env.WA.from,
    to  : `whatsapp:${phone}`,
    body
  };
  const media = mediaLogo || env.WA.mediaLogo;
  if (media) payload.mediaUrl = [media];

  logger.info('📲 WA freeform send ▶️', { service: 'server', to: phone, media: !!media });
  const msg = await client.messages.create(payload);

  logger.info('📲 WA freeform OK', { service: 'server', sid: msg.sid, to: phone });
  return { ok: true, sid: msg.sid, template: false };
}

module.exports = {
  sendStatusChange,
  _normalizeToE164: normalizeToE164,
};
```

### ./src/services/whatsender.service.js
```
'use strict';

// services/whatsender.service.js — adapter stile api2.whatsender.it (stub sicuro)
// Qui non chiamiamo nulla in esterno: forniamo le stesse funzioni di Twilio
// per permettere il wiring BE → se deciderai il vero endpoint, basta
// rimpiazzare l'HTTP client qui dentro.

const logger = require('../logger');

async function sendOrder({ to, order }) {
  logger.info('🟧 [Whatsender] sendOrder (stub)', { to, orderId: order?.id });
  return { ok: true, sid: 'stub-' + order?.id };
}

async function sendOrderStatus({ to, order, status }) {
  logger.info('🟧 [Whatsender] sendOrderStatus (stub)', { to, orderId: order?.id, status });
  return { ok: true, sid: 'stub-status-' + order?.id };
}

module.exports = { sendOrder, sendOrderStatus };
```

### ./src/sockets/index.js
```
// src/sockets/index.js
'use strict';

/**
 * Socket entry — singleton + bootstrap canali
 * -------------------------------------------------------------
 * - Mantiene i tuoi log di connessione/disconnessione
 * - Mantiene il ping/pong ("🏓") per diagnostica rapida
 * - Espone un singleton io() richiamabile dai router/service
 * - Monta il canale ordini (orders.channel) per eventi live
 */

const logger = require('../logger');

let _io = null;

/**
 * Inizializza una sola volta il socket server.
 * @param {import('socket.io').Server} io
 */
function init(io) {
  if (_io) {
    // Già inizializzato: evito doppio wiring degli handler
    logger.warn('🔌 SOCKET init chiamato più volte — uso il singleton esistente');
    return _io;
  }

  _io = io;

  // === HANDLER BASE (il tuo file locale) ====================================
  io.on('connection', (socket) => {
    logger.info('🔌 SOCKET connected', { id: socket.id });

    // Ping/Pong diagnostico
    socket.on('ping', () => {
      logger.info('🏓 ping from', { id: socket.id });
      socket.emit('pong');
    });

    socket.on('disconnect', (reason) => {
      logger.info('🔌 SOCKET disconnected', { id: socket.id, reason });
    });
  });

  // === CANALI MODULARI ======================================================
  // Canale "orders" (emette orders:created / orders:status / ...)
  try {
    require('./orders.channel')(io);
    logger.info('📡 SOCKET channel mounted: orders');
  } catch (err) {
    logger.warn('📡 SOCKET channel orders non disponibile', { error: String(err) });
  }

  logger.info('🔌 SOCKET bootstrap completato ✅');
  return _io;
}

/**
 * Restituisce l'istanza singleton di socket.io
 * (utile nei router/service per emettere eventi).
 */
function io() {
  if (!_io) throw new Error('socket.io non inizializzato');
  return _io;
}

module.exports = (serverOrIo) => init(serverOrIo);
module.exports.io = io;
```

### ./src/sockets/orders.channel.js
```
'use strict';

/**
 * sockets/orders.channel.js
 * -----------------------------------------------------------------------------
 * Canale Socket.IO per “orders”.
 * - Solo ping e join di stanze per futuri filtri (per ora broadcast generale).
 */

const logger = require('../logger');

module.exports = (io) => {
  io.on('connection', (socket) => {
    logger.info('🔌 [SOCKET] orders: connection', { id: socket.id });

    socket.on('orders:ping', () => {
      logger.info('🏓 [SOCKET] orders:ping', { id: socket.id });
      socket.emit('orders:pong', { t: Date.now() });
    });

    socket.on('disconnect', (reason) => {
      logger.info('🔌 [SOCKET] orders: disconnect', { id: socket.id, reason });
    });
  });
};
```

### ./src/sockets/orders.js
```
// // 📡 Socket.IO: gestione ordini (lista/nuovo/update)
// const { query } = require('../db');                         // query wrapper
// const logger = require('../logger');                        // ✅ istanza diretta
// const { printOrder } = require('../utils/print');           // stampa (fallback su file se KO)
// const env = require('../env');                              // config

// module.exports = (io) => {
//   io.on('connection', (socket) => {
//     logger.info('📡 SOCKET connected', { id: socket.id });

//     socket.on('get-orders', async () => {
//       logger.info('📡 get-orders ▶️', { from: socket.id });
//       const rows = await query('SELECT * FROM orders ORDER BY created_at DESC');
//       for (const r of rows) {
//         r.items = await query('SELECT * FROM order_items WHERE order_id=?', [r.id]);
//       }
//       socket.emit('orders-list', rows);
//     });

//     socket.on('new-order', async (order) => {
//       logger.info('📡 new-order ▶️', { body: order });
//       const res = await query(
//         `INSERT INTO orders (total, currency, customer_first, customer_last, phone, email, delivery_address, status)
//          VALUES (?,?,?,?,?,?,?, 'pending')`,
//         [
//           order.total, order.currency,
//           order.customer?.firstName || null,
//           order.customer?.lastName  || null,
//           order.customer?.phone     || null,
//           order.customer?.email     || null,
//           order.customer?.deliveryAddress || null
//         ]
//       );
//       const orderId = res.insertId;

//       for (const it of (order.items || [])) {
//         await query(
//           `INSERT INTO order_items (order_id, product_name, qty, price, notes, ingredients)
//            VALUES (?,?,?,?,?,?)`,
//           [orderId, it.name, it.qty, it.price, it.notes || '', (it.chosenIngredients||[]).join(',')]
//         );
//       }

//       const [o] = await query('SELECT * FROM orders WHERE id=?', [orderId]);
//       o.items = await query('SELECT * FROM order_items WHERE order_id=?', [orderId]);

//       io.emit('order-created', o);
//       logger.info('📡 order-created ✅ broadcast', { orderId });

//       // stampa non bloccante
//       const printerCfg = { enabled: !!env.PRINTER?.ip, ip: env.PRINTER?.ip || '127.0.0.1', port: env.PRINTER?.port || 9100 };
//       printOrder(o, printerCfg).catch(e => logger.error('🖨️ PRINT ❌', { error: String(e), orderId }));
//     });

//     socket.on('update-status', async ({ id, status }) => {
//       logger.info('📡 update-status ▶️', { id, status });
//       await query('UPDATE orders SET status=? WHERE id=?', [status, id]);
//       io.emit('order-updated', { id, status });
//     });

//     socket.on('disconnect', (reason) => {
//       logger.info('📡 SOCKET disconnected', { id: socket.id, reason });
//     });
//   });
// };


'use strict';

// sockets/orders.channel.js — eventi per board live
const logger = require('../logger');

module.exports = (io) => {
  io.of('/').on('connection', (socket) => {
    logger.info('🔌 socket orders ▶️ connected', { id: socket.id });

    socket.on('disconnect', () => {
      logger.info('🔌 socket orders ⏹ disconnected', { id: socket.id });
    });

    // (eventuali) azioni client → server in futuro
    // es: socket.on('orders:subscribe', () => ...)
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
