# 🧩 Project code (file ammessi in .)

_Generato: Thu, Nov  6, 2025  9:00:49 PM_

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
        "google-auth-library": "10.5.0",
        "googleapis": "164.1.0",
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

### ./src/api/google.js
```
// server/src/api/google.js
const express = require('express');
const router = express.Router();
const { exchangeCode, searchContacts, getTokenRow, revokeFor } = require('../services/google-oauth.service');
const auth = require('../middleware/auth'); // tuo JWT middleware: req.user.id

// Tutte le rotte richiedono login app (admin). Mantengo la tua politica.
router.use(auth);

// Stato collegamento
router.get('/status', async (req, res) => {
  const row = await getTokenRow(req.user?.id);
  res.json({ connected: !!row, email: row?.google_email || null });
});

// Exchange code → refresh token (una volta)
router.post('/oauth/exchange', async (req, res, next) => {
  try {
    const code = req.body?.code;
    if (!code) return res.status(400).json({ ok: false, message: 'Missing code' });
    await exchangeCode(req.user?.id, code);
    res.json({ ok: true });
  } catch (err) {
    const msg = err?.code === 'invalid_grant' ? 'Invalid or expired code' : err.message;
    res.status(400).json({ ok: false, message: msg });
  }
});

// Proxy People search (usa refresh token server-side)
router.get('/people/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));
  if (q.length < 2) return res.json({ items: [] });
  try {
    const items = await searchContacts(req.user?.id, q, limit);
    res.json({ items });
  } catch (err) {
    if (err?.code === 'GOOGLE_CONSENT_REQUIRED') {
      return res.status(401).json({ ok: false, reason: 'google_consent_required' });
    }
    res.status(500).json({ ok: false, message: err.message });
  }
});

// Disconnessione manuale
router.post('/logout', async (req, res) => {
  await revokeFor(req.user?.id);
  res.json({ ok: true });
});

module.exports = router;
```

### ./src/api/google/oauth.js
```
// src/api/google/oauth.js
'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../logger');
const { exchangeCode } = require('../../services/google.service');

// POST /api/google/oauth/exchange  { code }
// Scambia il "code" ottenuto dal popup GIS e persiste i token.
router.post('/exchange', async (req, res) => {
  const code = String(req.body?.code || '');
  if (!code) return res.status(400).json({ ok: false, message: 'Missing code' });

  try {
    await exchangeCode(code);
    logger.info('🔄 OAuth exchange OK');
    return res.json({ ok: true });
  } catch (e) {
    logger.error('🔄 OAuth exchange KO', { error: String(e) });
    return res.status(500).json({ ok: false, message: 'oauth_exchange_failed' });
  }
});

// (opzionale) GET /api/google/oauth/callback — per eventuale redirect flow classico
router.get('/callback', (req, res) => {
  res.send('OK: callback non usato con GIS popup. Usa /oauth/exchange con `code`.');
});

module.exports = router;
```

### ./src/api/google/people.js
```
// src/api/google/people.js
// ============================================================================
// Proxy People API.
// - GET /api/google/people/search   → lista contatti (read scope)
// - POST /api/google/people/create  → crea contatto (write scope richiesto)
// Se mancano token → 401 { reason: 'google_consent_required' }.
// Se manca lo scope write → 403 { reason: 'google_scope_write_required' }.
// ============================================================================
'use strict';

const express = require('express');
const router = express.Router();
// ✅ FIX path (sei in /api/google)
const logger = require('../../logger');
const {
  searchContacts,
  createContact,
  ensureAuth
} = require('../../services/google.service');

// GET /api/google/people/search?q=...&limit=12
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '12', 10)));

  if (q.length < 2) return res.json({ ok: true, items: [] });

  try {
    // ensureAuth usato per segnalare 401 in caso di mancanza token
    await ensureAuth();
    const items = await searchContacts(q, limit);
    return res.json({ ok: true, items });
  } catch (e) {
    const code = e?.code || '';
    if (code === 'consent_required') {
      return res.status(401).json({ ok: false, reason: 'google_consent_required' });
    }
    logger.error('🔎❌ [Google] people.search failed', { error: String(e) });
    return res.status(500).json({ ok: false, message: 'search_failed' });
  }
});

// POST /api/google/people/create
// body: { displayName?, givenName?, familyName?, email?, phone? }
router.post('/create', express.json(), async (req, res) => {
  const { displayName, givenName, familyName, email, phone } = req.body || {};

  try {
    const out = await createContact({ displayName, givenName, familyName, email, phone });
    return res.json(out);
  } catch (e) {
    const code = e?.code || '';
    if (code === 'consent_required') {
      return res.status(401).json({ ok: false, reason: 'google_consent_required' });
    }
    if (code === 'write_scope_required') {
      return res.status(403).json({ ok: false, reason: 'google_scope_write_required' });
    }
    logger.error('👤❌ [Google] people.create failed', { error: String(e) });
    return res.status(500).json({ ok: false, message: 'create_failed' });
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

### ./src/api/ingredients.js
```
// server/src/api/ingredients.js
// ============================================================================
// Ritorna tutti gli ingredienti attivi con eventuale price_extra
// Output FE: [{ id, name, price_extra }]
// NOTE: 'db' può essere un pool mysql2 (ritorna [rows, fields])
//       oppure il tuo wrapper (ritorna rows). Usiamo q() per normalizzare.
// ============================================================================

const express = require('express');
const router = express.Router();

// Normalizza il risultato di db.query() (pool mysql2 -> [rows], wrapper -> rows)
async function q(db, sql, params = []) {
  const res = await db.query(sql, params);
  // mysql2/promise -> [rows, fields]
  if (Array.isArray(res) && Array.isArray(res[0])) return res[0];
  // wrapper -> rows
  return res;
}

router.get('/', async (req, res) => {
  const log = req.app.get('logger');
  try {
    const db = req.app.get('db') || require('../db');
    if (!db?.query) {
      log?.error?.('🥦❌ ingredients.list — db pool mancante');
      return res.status(500).json({ error: 'ingredients_db_missing' });
    }

    const rows = await q(db, `
      SELECT id, name, price_extra
      FROM ingredients
      WHERE IFNULL(is_active, 1) = 1
      ORDER BY (sort_order IS NULL), sort_order, name
    `);

    const out = Array.isArray(rows) ? rows : (rows ? [rows] : []);
    log?.info?.('🥦 /ingredients OK', { count: out.length });
    return res.json(out);
  } catch (e) {
    log?.error?.('🥦❌ ingredients.list KO', { error: String(e) });
    return res.status(500).json({ error: 'ingredients_list_failed' });
  }
});

module.exports = router;
```

### ./src/api/notifications.js
```
'use strict';

/**
 * API NOTIFICATIONS
 * -----------------
 * Rotte per invio email e WhatsApp (test/simple), con fallback sicuri.
 * Obiettivo: MAI passare ad Express handler undefined.
 *
 * Stile: log con emoji, requireAuth con fallback DEV, guardie robuste.
 */

const express = require('express');
const router  = express.Router();

const logger = require('../logger');
const env    = require('../env');

// === requireAuth con fallback DEV (stile già usato altrove) ==================
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

// === Carico servizi (con fallback a null) ====================================
let mailer = null;
try {
  // Il tuo progetto ha src/services/mailer.service.js
  mailer = require('../services/mailer.service');
  logger.info('📧 mailer.service caricato');
} catch {
  logger.warn('📧 mailer.service non disponibile');
}

let waSvc = null;
try {
  // Preferisci un "aggregatore" già esistente (whatsapp.service)
  waSvc = require('../services/whatsapp.service');
  logger.info('📲 whatsapp.service caricato');
} catch {
  // In alternativa prova il provider Twilio o Whatsender se esistono
  try {
    waSvc = require('../services/whatsapp-twilio.service.js');
    logger.info('📲 whatsapp-twilio.service caricato');
  } catch {
    try {
      waSvc = require('../services/whatsender.service.js');
      logger.info('📲 whatsender.service caricato');
    } catch {
      logger.warn('📲 Nessun servizio WhatsApp disponibile');
      waSvc = null;
    }
  }
}

// === Helper: wrapper sicuro per route handler ================================
/**
 * safeRoute(handlerName, impl)
 * Ritorna sempre una funzione (req,res) valida per Express.
 * Se impl non è una funzione, risponde 501 e logga chiaramente.
 */
function safeRoute(handlerName, impl) {
  return async (req, res) => {
    if (typeof impl !== 'function') {
      logger.warn(`🧯 Handler mancante: ${handlerName} → 501`);
      return res.status(501).json({ error: 'not_implemented', handler: handlerName });
    }
    try {
      await impl(req, res);
    } catch (err) {
      logger.error(`💥 Handler ${handlerName} errore`, { error: String(err) });
      res.status(500).json({ error: 'internal_error', detail: String(err) });
    }
  };
}

// === Health semplice =========================================================
router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    mailer: !!mailer,
    whatsapp: !!waSvc,
    providerHint: process.env.WA_PROVIDER || process.env.TWILIO_ENABLED || process.env.WHATSENDER_ENABLED || null
  });
});

// === EMAIL ===================================================================

/**
 * POST /api/notifications/email/test
 * body: { to, subject?, text?, html? }
 * Nota: cerchiamo metodi noti nel tuo mailer: sendMail / sendSimple / sendTestEmail
 */
router.post(
  '/email/test',
  requireAuth,
  safeRoute('email.test', async (req, res) => {
    if (!mailer) return res.status(501).json({ error: 'mailer_not_available' });

    const to      = (req.body?.to || '').toString().trim();
    const subject = (req.body?.subject || 'Test notifica').toString();
    const text    = (req.body?.text || `Ciao ${req.user?.email || 'utente'}, questo è un test.`).toString();
    const html    = (req.body?.html || `<p>${text}</p>`).toString();

    if (!to) return res.status(400).json({ error: 'missing_to' });

    // Prova in ordine i metodi più comuni del tuo mailer
    const sendFn =
      mailer.sendMail ||
      mailer.sendSimple ||
      mailer.sendTestEmail ||
      null;

    if (!sendFn) {
      logger.warn('📧 Nessun metodo sendMail disponibile nel mailer');
      return res.status(501).json({ error: 'send_method_not_found' });
    }

    const out = await sendFn({ to, subject, text, html });
    logger.info('📧 Email test inviata ✅', { to, subject, messageId: out?.messageId || null });
    res.json({ ok: true, messageId: out?.messageId || null });
  })
);

// === WHATSAPP ================================================================

/**
 * POST /api/notifications/wa/test
 * body: { to, text? }
 * Cerca metodi comuni: sendText / sendMessage / sendStatusChange
 */
router.post(
  '/wa/test',
  requireAuth,
  safeRoute('wa.test', async (req, res) => {
    if (!waSvc) return res.status(501).json({ error: 'wa_not_available' });

    const to   = (req.body?.to || '').toString().trim();
    const text = (req.body?.text || 'Ciao 👋 questo è un messaggio di test').toString();
    if (!to) return res.status(400).json({ error: 'missing_to' });

    // Trova una funzione invio compatibile nel service
    const sendFn =
      waSvc.sendText ||
      waSvc.sendMessage ||
      null;

    // Alcuni tuoi service hanno invece 'sendStatusChange({to, status, ...})'
    const sendStatusChange = waSvc.sendStatusChange || null;

    let out = null;
    if (sendFn) {
      out = await sendFn({ to, text });
    } else if (sendStatusChange) {
      // fallback: uso un "finto" status-change per test (non cambia stato, solo invia testo)
      out = await sendStatusChange({ to, reservation: { id: 0, customer_name: 'Test' }, status: 'confirmed', reason: text });
    } else {
      return res.status(501).json({ error: 'wa_send_method_not_found' });
    }

    logger.info('📲 WA test inviato ✅', { to, sid: out?.sid || null });
    res.json({ ok: true, sid: out?.sid || null });
  })
);

/**
 * POST /api/notifications/wa/send
 * body: { to, text, mediaUrl? }
 * Canale semplice "text" (opzionale media).
 */
router.post(
  '/wa/send',
  requireAuth,
  safeRoute('wa.send', async (req, res) => {
    if (!waSvc) return res.status(501).json({ error: 'wa_not_available' });

    const to       = (req.body?.to || '').toString().trim();
    const text     = (req.body?.text || '').toString();
    const mediaUrl = (req.body?.mediaUrl || '').toString().trim() || null;

    if (!to || !text) return res.status(400).json({ error: 'missing_params', need: 'to,text' });

    const sendFn =
      waSvc.sendText ||
      waSvc.sendMessage ||
      null;

    if (!sendFn) return res.status(501).json({ error: 'wa_send_method_not_found' });

    const out = await sendFn({ to, text, mediaUrl });
    logger.info('📲 WA inviato ✅', { to, sid: out?.sid || null, hasMedia: !!mediaUrl });
    res.json({ ok: true, sid: out?.sid || null });
  })
);

module.exports = router;
```

### ./src/api/orders.js
```
// src/api/orders.js
// ============================================================================
// ORDERS API (root = /api/orders)
// - GET    /                lista (hours | from/to | status | q)
// - GET    /:id(\d+)        dettaglio full con items
// - POST   /                crea ordine (header + items) → 201 + full
// - PATCH  /:id(\d+)/status cambio stato
// - POST   /:id(\d+)/print  stampa Pizzeria/Cucina (best-effort)
// - GET    /stream          SSE (montato qui)
// Stile: commenti lunghi, log con emoji
// ============================================================================
'use strict';

const express = require('express');
const router  = express.Router();
const logger  = require('../logger');
const { query } = require('../db');
const sse     = require('../sse');
const { printOrderDual } = require('../utils/print-order');

// Monta subito l’endpoint SSE (/api/orders/stream)
sse.mount(router);

// Helpers ---------------------------------------------------------------------
const toNum = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const toDate = (v) => v ? new Date(v) : null;

async function getOrderFullById(id) {
  const [o] = await query(
    `SELECT id, customer_name, phone, email, people, scheduled_at, status,
            total, channel, note, created_at, updated_at
     FROM orders WHERE id=?`, [id]
  );
  if (!o) return null;

  const items = await query(
    `SELECT i.id, i.order_id, i.product_id, i.name, i.qty, i.price, i.notes, i.created_at,
            COALESCE(c.name,'Altro') AS category
     FROM order_items i
     LEFT JOIN products p ON p.id = i.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE i.order_id=?
     ORDER BY i.id ASC`, [id] // <-- fix 'p.category' mancante
  );

  return { ...o, items };
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
    const total = items.reduce((acc, it) => acc + toNum(it.price) * toNum(it.qty, 1), 0);

    const r = await query(
      `INSERT INTO orders (customer_name, phone, email, people, scheduled_at, note, channel, status, total)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        (dto.customer_name || 'Cliente').toString().trim(),
        dto.phone || null,
        dto.email || null,
        dto.people || null,
        scheduled,
        dto.note || null,
        dto.channel || 'admin',
        'pending',
        total
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
    // Notifica SSE best-effort
    try { sse.emitCreated(full); } catch (e) { logger.warn('🧵 SSE created ⚠️', { e: String(e) }); }

    res.status(201).json(full);
  } catch (e) {
    logger.error('🆕 orders create ❌', { reason: String(e) });
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
    // Notifica SSE best-effort
    try { sse.emitStatus({ id, status }); } catch (e) { logger.warn('🧵 SSE status ⚠️', { e: String(e) }); }
    res.json({ ok: true });
  } catch (e) {
    logger.error('✏️ orders status ❌', { error: String(e) });
    res.status(500).json({ ok: false, error: 'orders_status_error' });
  }
});

// Stampa (best-effort, non blocca)
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

### ./src/api/product_ingredients.js
```
// server/src/api/product_ingredients.js
// ============================================================================
// Ingredienti collegati al prodotto (BASE). Servono per la sezione "Ingredienti base".
// Output FE (chips-ready):
// [{ ingredient_id, name, is_default, is_extra:0, price_extra, allergen:0, sort_order }]
// NOTE: 'db' può essere un pool mysql2 o il tuo wrapper. Usiamo q() per normalizzare.
// ============================================================================

const express = require('express');
const router = express.Router();

// Normalizza il risultato di db.query() (pool mysql2 -> [rows], wrapper -> rows)
async function q(db, sql, params = []) {
  const res = await db.query(sql, params);
  if (Array.isArray(res) && Array.isArray(res[0])) return res[0];
  return res;
}

/**
 * GET /api/product-ingredients/by-product/:productId
 * - JOIN con ingredients per avere name + price_extra
 * - is_default normalizzato (COALESCE(...,1))
 * - ritorno SEMPRE array (anche se vuoto)
 */
router.get('/by-product/:productId(\\d+)', async (req, res) => {
  const log = req.app.get('logger');
  const db  = req.app.get('db') || require('../db');

  if (!db?.query) {
    log?.error?.('🧩❌ product-ingredients.by-product — db pool mancante');
    return res.status(500).json({ error: 'product_ingredients_db_missing' });
  }

  const productId = Number(req.params.productId || 0);
  if (!productId) return res.status(400).json({ error: 'invalid_product_id' });

  try {
    const rows = await q(db, `
      SELECT
        pi.ingredient_id,
        i.name,
        COALESCE(pi.is_default, 1)     AS is_default,
        0                               AS is_extra,
        COALESCE(i.price_extra, 0)     AS price_extra,
        0                               AS allergen,
        COALESCE(pi.sort_order, 1000)  AS sort_order
      FROM product_ingredients pi
      JOIN ingredients i ON i.id = pi.ingredient_id
      WHERE pi.product_id = ?
        AND IFNULL(i.is_active, 1) = 1
      ORDER BY (pi.sort_order IS NULL), pi.sort_order, i.name
    `, [productId]);

    const out = Array.isArray(rows) ? rows : (rows ? [rows] : []);
    log?.info?.('🧩 /product-ingredients/by-product OK', { productId, count: out.length });
    return res.json(out);
  } catch (e) {
    log?.error?.('🧩❌ product-ingredients.by-product KO', { productId, error: String(e) });
    return res.status(500).json({ error: 'product_ingredients_failed' });
  }
});

module.exports = router;
```

### ./src/api/products.js
```
'use strict';

const express = require('express');
const router  = express.Router();

const logger  = require('../logger');
const svc     = require('../services/product.service');

// GET /api/products?active=1
router.get('/', async (req, res) => {
  try {
    const activeParam = String(req.query.active ?? '').trim().toLowerCase();
    const onlyActive = activeParam === '1' || activeParam === 'true' || activeParam === 'yes';
    const rows = await svc.getAll({ active: onlyActive });
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/products', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// Alias "menu" → solo attivi
router.get('/menu', async (_req, res) => {
  try {
    const rows = await svc.getAll({ active: true });
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/products/menu', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await svc.getById(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (err) {
    logger.error('❌ [GET] /api/products/:id', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const created = await svc.create(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    logger.error('❌ [POST] /api/products', { error: String(err) });
    res.status(400).json({ error: err.message || 'bad_request' });
  }
});

router.put('/:id(\\d+)', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const updated = await svc.update(id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json(updated);
  } catch (err) {
    logger.error('❌ [PUT] /api/products/:id', { error: String(err) });
    res.status(400).json({ error: err.message || 'bad_request' });
  }
});

router.delete('/:id(\\d+)', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await svc.remove(id);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, id });
  } catch (err) {
    logger.error('❌ [DELETE] /api/products/:id', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
```

### ./src/api/reservations.js
```
'use strict';

/**
 * Router REST per /api/reservations
 * - Mantiene il tuo stile: commenti lunghi, log emoji, diagnostica chiara.
 * - FIX: PUT /:id/status già normalizzato (action|status|next → action canonica)
 * - 🆕 POST /:id/checkin  : salva checkin_at (idempotente) + se pending → accepted
 * - 🆕 POST /:id/checkout : salva checkout_at + dwell_sec (idempotente)
 */

const express = require('express');
const router  = express.Router();

const logger = require('../logger');
const env    = require('../env');

const svc          = require('../services/reservations.service');
const resvActions  = require('../services/reservations-status.service');
const mailer       = require('../services/mailer.service');
const wa           = require('../services/whatsapp.service');
const printerSvc   = require('../services/thermal-printer.service');

// === requireAuth con fallback DEV ============================================
let requireAuth;
try {
  ({ requireAuth } = require('../middleware/auth')); // <-- path reale del tuo repo
  if (typeof requireAuth !== 'function') throw new Error('requireAuth non è una funzione');
  logger.info('🔐 requireAuth caricato da middleware/auth');
} catch {
  logger.warn('⚠️ requireAuth non disponibile. Uso FALLBACK DEV (solo locale).');
  requireAuth = (req, _res, next) => {
    req.user = {
      id: Number(process.env.AUTH_DEV_ID || 0),
      email: process.env.AUTH_DEV_USER || 'dev@local'
    };
    next();
  };
}

// === Helpers =================================================================
function normalizeStr(v) { return (v ?? '').toString().trim(); }
function pickAction(body = {}) {
  const raw = normalizeStr(body.action ?? body.status ?? body.next).toLowerCase();
  if (!raw) return null;
  const map = {
    confirm: 'confirm', confirmed: 'confirm', accept: 'confirm', accepted: 'confirm', approve: 'confirm', approved: 'confirm',
    cancel: 'cancel',  cancelled: 'cancel',
    reject: 'reject',  rejected : 'reject',
    prepare: 'prepare', preparing: 'prepare',
    ready: 'ready',
    complete: 'complete', completed: 'complete'
  };
  return map[raw] || raw;
}

// ------------------------------ LIST -----------------------------------------
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
    return res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations', { error: String(err) });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ------------------------------ SUPPORT --------------------------------------
router.get('/support/count-by-status', async (req, res) => {
  try {
    const from = req.query.from || null;
    const to   = req.query.to   || null;
    const rows = await svc.countByStatus({ from, to });
    return res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations/support/count-by-status', { error: String(err) });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ------------------------------ DETAIL ---------------------------------------
router.get('/:id(\\d+)', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  try {
    const r = await svc.getById(id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    return res.json(r);
  } catch (err) {
    logger.error('❌ [GET] /api/reservations/:id', { id, error: String(err) });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ------------------------------ CREATE ---------------------------------------
router.post('/', requireAuth, async (req, res) => {
  try {
    const created = await svc.create(req.body || {}, { user: req.user });
    return res.status(201).json(created);
  } catch (err) {
    logger.error('❌ [POST] /api/reservations', { error: String(err) });
    return res.status(400).json({ error: err.message || 'bad_request' });
  }
});

// ------------------------------ UPDATE ---------------------------------------
router.put('/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const updated = await svc.update(id, req.body || {}, { user: req.user });
    if (!updated) return res.status(404).json({ error: 'not_found' });
    return res.json(updated);
  } catch (err) {
    logger.error('❌ [PUT] /api/reservations/:id', { id, error: String(err) });
    const status = /invalid|missing|bad/i.test(String(err.message || err)) ? 400 : 500;
    return res.status(status).json({ error: err.message || 'internal_error' });
  }
});

// ----------- CAMBIO STATO + NOTIFICHE ----------------------------------------
router.put('/:id(\\d+)/status', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });

  const action  = pickAction(req.body);
  const reason  = normalizeStr(req.body?.reason) || null;
  const notify  = (req.body?.notify !== undefined) ? !!req.body.notify : undefined;
  const toEmail = normalizeStr(req.body?.email) || null;
  const replyTo = normalizeStr(req.body?.reply_to) || null;

  if (!action) {
    logger.warn('⚠️ /status missing params', { id, raw: req.body });
    return res.status(400).json({ error: 'missing_action' });
  }

  try {
    const updated = await resvActions.updateStatus({
      id,
      action,
      reason,
      user_email: req.user?.email || 'dev@local'
    });

    // email best-effort
    try {
      const mustNotify = (notify === true) || (notify === undefined && !!env.RESV?.notifyAlways);
      if (mustNotify) {
        const dest = toEmail || updated.contact_email || updated.email || null;
        if (dest && mailer?.sendStatusChangeEmail) {
          await mailer.sendStatusChangeEmail({
            to: dest, reservation: updated, newStatus: updated.status, reason, replyTo
          });
          logger.info('📧 status-change mail ✅', { id, to: dest, status: updated.status });
        } else {
          logger.warn('📧 status-change mail SKIP', { id, status: updated.status });
        }
      }
    } catch (e) { logger.error('📧 status-change mail ❌', { id, error: String(e) }); }

    // whatsapp best-effort
    try {
      if (wa?.sendStatusChange) {
        const waRes = await wa.sendStatusChange({
          to: updated.contact_phone || updated.phone || null,
          reservation: updated,
          status: updated.status,
          reason
        });
        if (waRes?.ok) logger.info('📲 status-change WA ✅', { id, sid: waRes.sid });
      }
    } catch (e) { logger.error('📲 status-change WA ❌', { id, error: String(e) }); }

    return res.json({ ok: true, reservation: updated });
  } catch (err) {
    logger.error('❌ [PUT] /api/reservations/:id/status', { id, action, error: String(err) });
    const status = /missing_id_or_action|invalid_action/i.test(String(err)) ? 400 : 500;
    return res.status(status).json({ error: String(err.message || err) });
  }
});

// ------------------------------ 🆕 CHECK-IN ----------------------------------
router.post('/:id(\\d+)/checkin', requireAuth, async (req, res) => {
  try {
    const id  = Number(req.params.id);
    const at  = req.body?.at || null; // opzionale ISO
    const r   = await svc.checkIn(id, at, { user: req.user });

    // realtime (se il server espone io)
    try {
      const io = req.app.get('io');
      io?.to?.('admins')?.emit?.('reservation-checkin', { id: r.id, checkin_at: r.checkin_at });
      logger.info('📡 socket emit: reservation-checkin', { id: r.id });
    } catch {}

    return res.json({ ok: true, reservation: r });
  } catch (err) {
    logger.error('❌ [POST] /api/reservations/:id/checkin', { error: String(err) });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ------------------------------ 🆕 CHECK-OUT ---------------------------------
router.post('/:id(\\d+)/checkout', requireAuth, async (req, res) => {
  try {
    const id  = Number(req.params.id);
    const at  = req.body?.at || null; // opzionale ISO
    const r   = await svc.checkOut(id, at, { user: req.user });

    try {
      const io = req.app.get('io');
      io?.to?.('admins')?.emit?.('reservation-checkout', {
        id: r.id, checkout_at: r.checkout_at, dwell_sec: r.dwell_sec
      });
      logger.info('📡 socket emit: reservation-checkout', { id: r.id, dwell_sec: r.dwell_sec });
    } catch {}

    return res.json({ ok: true, reservation: r });
  } catch (err) {
    logger.error('❌ [POST] /api/reservations/:id/checkout', { error: String(err) });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ------------------------------ DELETE (hard) --------------------------------
router.delete('/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const force  = String(req.query.force || '').toLowerCase() === 'true';
    const allowAnyByEnv =
      (env.RESV && env.RESV.allowDeleteAnyStatus === true) ||
      (String(process.env.RESV_ALLOW_DELETE_ANY_STATUS || '').toLowerCase() === 'true');

    const existing = await svc.getById(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

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
    logger.error('❌ [DELETE] /api/reservations/:id', { error: String(err) });
    return res.status(500).json({ error: err.message || 'internal_error' });
  }
});

// ------------------------------ PRINT (invariato) ----------------------------
router.post('/print/daily', requireAuth, async (req, res) => {
  try {
    const date = normalizeStr(req.body?.date).slice(0,10);
    const status = normalizeStr(req.body?.status || 'all').toLowerCase();
    const rows = await svc.list({ from: date, to: date, status: status === 'all' ? undefined : status });
    const out = await printerSvc.printDailyReservations({
      date, rows, user: req.user, logoText: process.env.BIZ_NAME || 'LA MIA ATTIVITÀ'
    });
    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/daily', { error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

router.post('/print/placecards', requireAuth, async (req, res) => {
  try {
    const date   = normalizeStr(req.body?.date).slice(0,10);
    const status = normalizeStr(req.body?.status || 'accepted').toLowerCase();
    const qrBaseUrl = req.body?.qr_base_url || process.env.QR_BASE_URL || '';
    const rows = await svc.list({ from: date, to: date, status });
    const out = await printerSvc.printPlaceCards({
      date, rows, user: req.user, logoText: process.env.BIZ_NAME || 'LA MIA ATTIVITÀ', qrBaseUrl
    });
    return res.json({ ok: true, job_id: out.jobId, printed_count: out.printedCount });
  } catch (err) {
    logger.error('❌ print/placecards', { error: String(err) });
    return res.status(500).json({ error: err.message || String(err) });
  }
});

router.post('/:id(\\d+)/print/placecard', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const r = await svc.getById(id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    const out = await printerSvc.printSinglePlaceCard({ reservation: r, user: req.user });
    return res.json({ ok: true, job_id: out.jobId });
  } catch (err) {
    logger.error('❌ print/placecard', { error: String(err) });
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

### ./src/api/support/support/db-debug.js
```
const express = require('express');
const router = express.Router();

router.get('/db-check', async (req, res) => {
  const log = req.app.get('logger');
  const db  = req.app.get('db');
  try {
    const [info]    = await db.query('SELECT DATABASE() AS db, @@hostname AS host, @@port AS port');
    const [ings]    = await db.query('SELECT id,name FROM ingredients WHERE IFNULL(is_active,1)=1 ORDER BY id LIMIT 10');
    const [pi2]     = await db.query(`
      SELECT i.name
      FROM product_ingredients pi
      JOIN ingredients i ON i.id = pi.ingredient_id
      WHERE pi.product_id = 2
      ORDER BY COALESCE(pi.sort_order,1000), i.name
    `);
    log?.info?.('🧪 /support/db-check', { db: info[0]?.db, host: info[0]?.host, ing10: ings.length, base2: pi2.length });
    res.json({ db: info[0], ingredients_first10: ings, base_for_product_2: pi2 });
  } catch (e) {
    log?.error?.('🧪❌ /support/db-check KO', { error: String(e) });
    res.status(500).json({ error: 'db_check_failed' });
  }
});

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

### ./src/db/___________009_seed_menu_pizze.sql
```
-- 009_seed_menu_pizze.sql
-- Seed prodotti: Pizze Rosse, Pizze Bianche, Antipasti. Idempotente per 'name'.

-- Cache ID categorie
SET @cat_rosse   := (SELECT id FROM categories WHERE name='PIZZE ROSSE'   LIMIT 1);
SET @cat_bianche := (SELECT id FROM categories WHERE name='PIZZE BIANCHE' LIMIT 1);
SET @cat_antip   := (SELECT id FROM categories WHERE name='ANTIPASTI'     LIMIT 1);

-- ========== PIZZE ROSSE =====================================================
INSERT INTO products (category_id, name, description, price, is_active, sort_order)
SELECT @cat_rosse, 'MARINARA', 'pomodoro, aglio, olio, peperoncino, origano', 7.50, 1, 10
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='MARINARA');

INSERT INTO products SELECT @cat_rosse, 'MARGHERITA', 'pomodoro, mozzarella', 8.00, 1, 20
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='MARGHERITA');

INSERT INTO products SELECT @cat_rosse, 'NAPOLI', 'pomodoro, mozzarella, acciughe, origano', 9.00, 1, 30
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='NAPOLI');

INSERT INTO products SELECT @cat_rosse, 'ROMANA', 'pomodoro, mozzarella, capperi', 9.00, 1, 40
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='ROMANA');

INSERT INTO products SELECT @cat_rosse, 'DIAVOLA', 'pomodoro, mozzarella, salame piccante', 9.00, 1, 50
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='DIAVOLA');

INSERT INTO products SELECT @cat_rosse, 'WURSTEL', 'pomodoro, mozzarella, wurstel', 9.00, 1, 60
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='WURSTEL');

INSERT INTO products SELECT @cat_rosse, 'TONNO', 'pomodoro, mozzarella, tonno', 9.00, 1, 70
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='TONNO');

INSERT INTO products SELECT @cat_rosse, 'VEGETARIANA', 'pomodoro, mozzarella, melanzane, zucchine', 9.50, 1, 80
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='VEGETARIANA');

INSERT INTO products SELECT @cat_rosse, 'EMILY', 'pomodoro, mozzarella, mozzarella di bufala', 9.50, 1, 90
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='EMILY');

INSERT INTO products SELECT @cat_rosse, 'LEONARDO', 'pomodoro, mozzarella, wurstel, patate fritte', 9.50, 1, 100
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='LEONARDO');

INSERT INTO products SELECT @cat_rosse, 'KLEDI', 'pomodoro, mozzarella, salsiccia, wurstel', 9.50, 1, 110
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='KLEDI');

INSERT INTO products SELECT @cat_rosse, 'APPETITOSA', 'pomodoro, mozzarella, melanzane, pancetta, cipolla', 10.00, 1, 120
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='APPETITOSA');

INSERT INTO products SELECT @cat_rosse, 'CALABRESE', 'pomodoro, mozzarella, pancetta, funghi, cipolla, peperoncino', 10.00, 1, 130
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='CALABRESE');

INSERT INTO products SELECT @cat_rosse, 'NORDICA', 'pomodoro, mozzarella, radicchio, speck, mais', 10.00, 1, 140
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='NORDICA');

INSERT INTO products SELECT @cat_rosse, 'FRANCESCANA', 'pomodoro, mozzarella, funghi, prosciutto crudo', 10.00, 1, 150
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='FRANCESCANA');

INSERT INTO products SELECT @cat_rosse, 'QUATTRO STAGIONI', 'pomodoro, mozzarella, funghi, carciofini, prosciutto cotto', 10.00, 1, 160
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='QUATTRO STAGIONI');

INSERT INTO products SELECT @cat_rosse, 'CAPRICCIOSA', 'pomodoro, mozzarella, funghi, carciofini, prosciutto cotto, uovo', 11.00, 1, 170
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='CAPRICCIOSA');

INSERT INTO products SELECT @cat_rosse, 'SICILIANA', 'pomodoro, mozzarella, pomodoro a fette, rucola, mozzarella di bufala', 11.00, 1, 180
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='SICILIANA');

INSERT INTO products SELECT @cat_rosse, 'STELIO', 'pomodoro, mozzarella, funghi, rucola, prosciutto crudo, mozzarella di bufala', 11.00, 1, 190
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='STELIO');

INSERT INTO products SELECT @cat_rosse, 'LA LANTERNA', 'pomodoro, mozzarella, funghi, salsiccia, melanzane, zucchine, prosciutto crudo', 11.00, 1, 200
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='LA LANTERNA');

-- ========== PIZZE BIANCHE ===================================================
INSERT INTO products SELECT @cat_bianche, 'FOCACCIA', 'olio, sale, rosmarino o cipolla', 6.50, 1, 10
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='FOCACCIA');

INSERT INTO products SELECT @cat_bianche, 'ZUCCHINE', 'mozzarella, zucchine', 9.00, 1, 20
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='ZUCCHINE');

INSERT INTO products SELECT @cat_bianche, 'QUATTRO FORMAGGI', 'mozzarella, gorgonzola, emmenthal, grana', 9.50, 1, 30
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='QUATTRO FORMAGGI');

INSERT INTO products SELECT @cat_bianche, 'BOSCAIOLA', 'mozzarella, funghi, prosciutto cotto', 9.50, 1, 40
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='BOSCAIOLA');

INSERT INTO products SELECT @cat_bianche, 'PATATOSA', 'mozzarella, patate fritte, salsiccia', 9.50, 1, 50
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='PATATOSA');

INSERT INTO products SELECT @cat_bianche, 'VERA', 'mozzarella, rucola, funghi freschi, grana a scaglie', 9.50, 1, 60
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='VERA');

INSERT INTO products SELECT @cat_bianche, 'JENNY', 'mozzarella, zucchine, pancetta', 9.50, 1, 70
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='JENNY');

INSERT INTO products SELECT @cat_bianche, 'TARTUFO', 'mozzarella, salsiccia, salsa tartufata', 9.50, 1, 80
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='TARTUFO');

INSERT INTO products SELECT @cat_bianche, 'BIANCANEVE', 'mozzarella, prosciutto crudo', 10.00, 1, 90
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='BIANCANEVE');

INSERT INTO products SELECT @cat_bianche, 'MEDITERRANEA', 'mozzarella, rucola, pomodorini pachino, grana a scaglie', 10.00, 1, 100
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='MEDITERRANEA');

INSERT INTO products SELECT @cat_bianche, 'PARMIGIANA', 'mozzarella, melanzane, salsiccia, pomodoro a fette, grana a scaglie', 10.00, 1, 110
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='PARMIGIANA');

INSERT INTO products SELECT @cat_bianche, 'ENDRI', 'mozzarella, zucchine, salmone', 10.00, 1, 120
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='ENDRI');

INSERT INTO products SELECT @cat_bianche, 'CONTADINA', 'mozzarella, pomodoro a fette, prosciutto crudo', 10.00, 1, 130
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='CONTADINA');

INSERT INTO products SELECT @cat_bianche, 'MONTE BIANCO', 'mozzarella, prosciutto crudo, bocconcino di bufala al centro', 10.00, 1, 140
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='MONTE BIANCO');

INSERT INTO products SELECT @cat_bianche, 'NADIA', 'mozzarella, rucola, bresaola, pomodoro a fette, grana a scaglie', 11.00, 1, 150
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='NADIA');

-- ========== ANTIPASTI =======================================================
INSERT INTO products SELECT @cat_antip, 'Crostino misto', NULL, 6.50, 1, 10
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Crostino misto');

INSERT INTO products SELECT @cat_antip, 'Bresaola rucola e grana', NULL, 9.50, 1, 20
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Bresaola rucola e grana');

INSERT INTO products SELECT @cat_antip, 'Patate fritte', NULL, 5.50, 1, 30
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Patate fritte');

INSERT INTO products SELECT @cat_antip, 'Olive all’ascolana', NULL, 5.50, 1, 40
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Olive all’ascolana');

INSERT INTO products SELECT @cat_antip, 'Crocchette di pollo', NULL, 5.50, 1, 50
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Crocchette di pollo');

INSERT INTO products SELECT @cat_antip, 'Crocchette di patate', NULL, 5.50, 1, 60
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Crocchette di patate');

INSERT INTO products SELECT @cat_antip, 'Anelli di cipolla', NULL, 5.50, 1, 70
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Anelli di cipolla');

INSERT INTO products SELECT @cat_antip, 'Fritto misto', NULL, 12.00, 1, 80
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Fritto misto');
```

### ./src/db/index.js
```
// src/db/index.js
// ============================================================================
// MySQL pool (mysql2/promise) con:
// - multipleStatements: true (migrations/file SQL interi)
// - SET time_zone = '+00:00' (politica UTC a DB)
// - SET NAMES utf8mb4 (emoji safe)
// Stile: commenti lunghi, log con emoji
// ============================================================================
'use strict';

const mysql = require('mysql2/promise');
const logger = require('../logger');

const {
  DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT = 3306,
} = process.env;

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      port: Number(DB_PORT || 3306),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      multipleStatements: true,
      timezone: 'Z', // usa UTC in driver
    });
    logger.info('🗄️  DB Pool created', { host: DB_HOST, db: DB_NAME });
  }
  return pool;
}

async function prime(conn) {
  await conn.query(`SET time_zone = '+00:00'`);
  await conn.query(`SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci`);
}

async function query(sql, params = []) {
  const p = getPool();
  const conn = await p.getConnection();
  try {
    await prime(conn);
    const [rows] = await conn.query(sql, params);
    return rows;
  } finally {
    conn.release();
  }
}

module.exports = { query };
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
// server/src/server.js
'use strict';

const path = require('path');
const fs   = require('fs');
const http = require('http');
const express = require('express');
const cors    = require('cors');

const env    = require('./env');
const logger = require('./logger');
const dbmod  = require('./db');

// === GOOGLE: nuovi router puliti ============================================
const googleOauth  = require('./api/google/oauth');
const googlePeople = require('./api/google/people');

const app = express();
const server = http.createServer(app);

// Metto db e logger sull'app (usati nelle route)
const pool = dbmod?.pool || dbmod;
app.set('db', pool);
app.set('logger', logger);

app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

function ensureExists(relPath, friendlyName) {
  const abs = path.join(__dirname, relPath);
  const ok =
    fs.existsSync(abs) ||
    fs.existsSync(abs + '.js') ||
    fs.existsSync(path.join(abs, 'index.js'));
  if (!ok) logger.error(`❌ Manca il file ${friendlyName}:`, { expected: abs });
  else     logger.info(`✅ Trovato ${friendlyName}`, { file: abs });
  return ok;
}

// Ping rapido
app.get('/api/ping', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, time: new Date().toISOString() });
});

// API core (tue)
if (ensureExists('api/auth', 'API /api/auth')) app.use('/api/auth', require('./api/auth'));
if (ensureExists('api/reservations', 'API /api/reservations')) app.use('/api/reservations', require('./api/reservations'));
if (ensureExists('api/products', 'API /api/products')) app.use('/api/products', require('./api/products'));
if (ensureExists('api/orders', 'API /api/orders')) app.use('/api/orders', require('./api/orders'));
if (ensureExists('api/tables', 'API /api/tables')) app.use('/api/tables', require('./api/tables'));
if (ensureExists('api/rooms', 'API /api/rooms')) app.use('/api/rooms', require('./api/rooms'));
if (ensureExists('api/notifications', 'API /api/notifications')) app.use('/api/notifications', require('./api/notifications'));

// ✅ INGREDIENTI (già presenti)
if (ensureExists('api/ingredients', 'API /api/ingredients')) app.use('/api/ingredients', require('./api/ingredients'));
if (ensureExists('api/product_ingredients', 'API /api/product-ingredients')) app.use('/api/product-ingredients', require('./api/product_ingredients'));

/**
 * 🧹 GOOGLE – MOUNT PULITI
 * - Disabilito il vecchio router /api/google (cercava user_id e ti rompeva).
 * - Lascio solo /api/google/oauth e /api/google/people.
 *
 *  (Prima l’ordine poteva far prendere il router sbagliato → errore user_id)  // ref: tuo snapshot
 */
// ❌ legacy: app.use('/api/google', require('./api/google'));  // DISATTIVATO
app.use('/api/google/oauth', googleOauth);
app.use('/api/google/people', googlePeople);

// Health
if (ensureExists('api/health', 'API /api/health')) app.use('/api/health', require('./api/health'));

// (Eventuali) Socket.IO
const { Server } = require('socket.io');
const io = new Server(server, { path: '/socket.io', cors: { origin: true, credentials: true } });
if (ensureExists('sockets/index', 'Sockets entry')) {
  require('./sockets/index')(io);
} else {
  logger.warn('⚠️ sockets/index non trovato: i socket non saranno gestiti');
  io.on('connection', (s) => logger.info('🔌 socket connected (fallback)', { id: s.id }));
}

// (Facoltativi) Schema check / Migrations
if (ensureExists('db/schema-check', 'Schema checker')) {
  const { runSchemaCheck } = require('./db/schema-check');
  runSchemaCheck().catch(err => logger.error('❌ Schema check failed', { error: String(err) }));
}
if (ensureExists('db/migrator', 'DB migrator')) {
  const { runMigrations } = require('./db/migrator');
  runMigrations()
    .then(() => logger.info('🧰 MIGRATIONS ✅ all applied'))
    .catch((e) => logger.error('❌ Startup failed (migrations)', { error: String(e) }));
}

server.listen(env.PORT, () => logger.info(`🚀 HTTP listening on :${env.PORT}`));
```

### ./src/services/google.service.js
```
// src/services/google.service.js
// ----------------------------------------------------------------------------
// Google OAuth "code flow" per SPA (GIS popup) + People API.
// - Token persistiti in tabella `google_tokens` con chiave `owner` ('default').
// - exchangeCode usa redirect_uri = 'postmessage' (obbligatorio per GIS popup).
// - ensureAuth: se non trova token → lancia { code: 'consent_required' }.
// - peopleClient: helper per usare googleapis People v1.
// ----------------------------------------------------------------------------

'use strict';

const { google } = require('googleapis');
// ✅ FIX path relativi dal folder /services → vai su ../logger e ../db:
const logger = require('../logger');
const { query } = require('../db');

const OWNER = 'default';

// Legge le variabili d'ambiente (già gestite nel tuo env loader)
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  // Se usi il popup GIS, la redirect è sempre 'postmessage'
  GOOGLE_SCOPES = 'https://www.googleapis.com/auth/contacts.readonly'
} = process.env;

// ----------------------------------------------------------------------------
// OAuth2 client (usa redirect 'postmessage' per il popup GIS)
// ----------------------------------------------------------------------------
function getOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
    // niente redirect_url qui: lo passiamo nella getToken come 'postmessage'
  );
  return { oAuth2Client };
}

// ----------------------------------------------------------------------------
// DB helpers – salvataggio e lettura token (owner='default')
// Schema atteso: google_tokens(owner PK, access_token, refresh_token, scope, expiry_date BIGINT)
// ----------------------------------------------------------------------------
async function saveTokens(tokens = {}) {
  const { access_token, refresh_token, scope, expiry_date } = tokens;
  await query(
    `INSERT INTO google_tokens (owner, access_token, refresh_token, scope, expiry_date)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       access_token = VALUES(access_token),
       refresh_token = COALESCE(VALUES(refresh_token), refresh_token),
       scope = VALUES(scope),
       expiry_date = VALUES(expiry_date)`,
    [OWNER, access_token || null, refresh_token || null, scope || null, expiry_date || null]
  );
}

async function loadTokens() {
  const [row] = await query(`SELECT access_token, refresh_token, scope, expiry_date FROM google_tokens WHERE owner=?`, [OWNER]);
  return row || null;
}

async function revokeForOwner() {
  await query(`DELETE FROM google_tokens WHERE owner=?`, [OWNER]);
  logger.info('🧹 [Google] tokens revoked/removed for owner', { owner: OWNER });
}

// ----------------------------------------------------------------------------
// Exchange 'code' (GIS popup) → tokens
// ----------------------------------------------------------------------------
async function exchangeCode(code) {
  const { oAuth2Client } = getOAuthClient();
  // NB: con GIS popup serve passare redirect_uri='postmessage'
  const { tokens } = await oAuth2Client.getToken({ code, redirect_uri: 'postmessage' });
  // Salvo anche expiry_date (numero ms epoch) se presente
  await saveTokens(tokens);
  logger.info('🔐 [Google] Code exchanged, tokens saved', { has_refresh: !!tokens.refresh_token });
  return tokens;
}

// ----------------------------------------------------------------------------
// ensureAuth(): garantisce un OAuth client con access token valido (refresh se scaduto)
// Se i token non ci sono → errore 'consent_required' (FE deve aprire popup).
// ----------------------------------------------------------------------------
async function ensureAuth() {
  const tokens = await loadTokens();
  if (!tokens?.refresh_token) {
    const err = new Error('Consent required');
    err.code = 'consent_required';
    throw err;
  }

  const { oAuth2Client } = getOAuthClient();
  oAuth2Client.setCredentials({
    access_token: tokens.access_token || undefined,
    refresh_token: tokens.refresh_token || undefined,
    scope: tokens.scope || undefined,
    expiry_date: tokens.expiry_date || undefined
  });

  // se scaduto/assente → refresh
  const needsRefresh = !tokens.access_token || !tokens.expiry_date || (Date.now() >= Number(tokens.expiry_date) - 30_000);
  if (needsRefresh) {
    try {
      const newTokens = (await oAuth2Client.refreshAccessToken())?.credentials || {};
      // persisto i nuovi token
      await saveTokens(newTokens);
      oAuth2Client.setCredentials(newTokens);
      logger.info('🔄 [Google] access token refreshed');
    } catch (e) {
      logger.error('🔄❌ [Google] token refresh failed', { error: String(e) });
      // se fallisce il refresh, meglio richiedere nuovamente consenso
      const err = new Error('Consent required');
      err.code = 'consent_required';
      throw err;
    }
  }

  return oAuth2Client;
}

// ----------------------------------------------------------------------------
// People API client
// ----------------------------------------------------------------------------
function peopleClient(auth) {
  return google.people({ version: 'v1', auth });
}

// ----------------------------------------------------------------------------
// Operazioni People API (read / write)
// ----------------------------------------------------------------------------
async function searchContacts(q, limit = 12) {
  const auth = await ensureAuth();            // può lanciare consent_required
  const people = peopleClient(auth);
  const resp = await people.people.searchContacts({
    query: q,
    pageSize: Math.min(50, Math.max(1, limit)),
    readMask: 'names,emailAddresses,phoneNumbers',
  });

  const items = (resp.data.results || []).map((r) => {
    const p = r.person || {};
    const name  = p.names?.[0];
    const email = p.emailAddresses?.[0];
    const phone = p.phoneNumbers?.[0];

    return {
      displayName: name?.displayName || null,
      givenName:   name?.givenName || null,
      familyName:  name?.familyName || null,
      email:       email?.value || null,
      phone:       phone?.value || null,
    };
  });

  return items;
}

// Crea un contatto (serve scope write: https://www.googleapis.com/auth/contacts)
async function createContact({ givenName, familyName, displayName, email, phone }) {
  const auth = await ensureAuth();            // può lanciare consent_required
  const people = peopleClient(auth);

  try {
    const requestBody = {
      names: [{ givenName: givenName || undefined, familyName: familyName || undefined, displayName: displayName || undefined }],
      emailAddresses: email ? [{ value: email }] : undefined,
      phoneNumbers:   phone ? [{ value: phone }] : undefined,
    };

    const resp = await people.people.createContact({ requestBody });
    const resourceName = resp.data?.resourceName || null;
    logger.info('👤 [Google] contact created', { resourceName });
    return { ok: true, resourceName };
  } catch (e) {
    const msg = String(e?.message || e);
    // se i token non includono scope write → 403 insufficient permissions
    if (msg.includes('insufficient') || msg.includes('permission')) {
      const err = new Error('write_scope_required');
      err.code = 'write_scope_required';
      throw err;
    }
    logger.error('👤❌ [Google] createContact failed', { error: msg });
    throw e;
  }
}

module.exports = {
  exchangeCode,
  ensureAuth,
  peopleClient,
  searchContacts,
  createContact,
  revokeForOwner,
};
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

### ./src/services/order-printer.service.js
```
// src/utils/print-order.js
// ============================================================================
// Stampa termica: 2 copie (PIZZERIA / CUCINA) raggruppate per categoria.
// La categoria arriva già risolta dal service come: COALESCE(c.name,'Altro') AS category
// Se la stampante non è configurata → stampa “preview” su console.
// ENV supportate: PRINTER_IP, PRINTER_PORT (o PRINTER.ip/port in env.js)
// ============================================================================

'use strict';

const net = require('net');
const logger = require('../logger');
const env = require('../env');

function groupBy(list, keyFn) {
  const m = new Map();
  for (const it of list || []) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

function buildText(order, title, items) {
  const ln = (s = '') => s + '\n';
  let out = '';
  out += ln('==============================');
  out += ln(` ${title}`);
  out += ln('==============================');
  out += ln(`Ora: ${order.created_at}   #${order.id}`);
  out += ln(`Cliente: ${order.customer_name || '-'}`);
  if (order.phone) out += ln(`Tel: ${order.phone}`);
  if (order.note)  out += ln(`Note: ${order.note}`);
  out += ln('------------------------------');

  const byCat = groupBy(items, (it) => it.category || 'Altro');
  for (const [cat, rows] of byCat) {
    out += ln(`> ${cat}`);
    for (const r of rows) {
      const q = String(r.qty).padStart(2, ' ');
      const name = r.name;
      const price = Number(r.price || 0).toFixed(2);
      out += ln(` ${q} x ${name}   € ${price}`);
      if (r.notes) out += ln(`    * ${r.notes}`);
    }
    out += ln('------------------------------');
  }
  out += ln(`Totale: € ${(Number(order.total || 0)).toFixed(2)}`);
  out += ln('\n\n');
  return out;
}

async function sendRaw(text, which) {
  const ip = env.PRINTER?.ip || env.PRINTER_IP;
  const port = Number(env.PRINTER?.port || env.PRINTER_PORT || 9100);

  // comando ESC/POS taglio
  const CUT = Buffer.from([0x1D, 0x56, 0x00]);

  if (!ip) {
    logger.warn(`🖨️ [${which}] preview (no PRINTER_IP)`);
    console.log(text);
    return;
  }

  await new Promise((resolve, reject) => {
    const sock = new net.Socket();
    sock.connect(port, ip, () => {
      sock.write(text, 'utf8', () => {
        sock.write(CUT);
        sock.end();
      });
    });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
  logger.info(`🖨️ [${which}] inviato a ${ip}:${port}`, { bytes: Buffer.byteLength(text) });
}

async function printOrderSplitByCategory(orderFull, { PIZZERIA_CATEGORIES = ['PIZZE'], KITCHEN_CATEGORIES = ['BEVANDE'] } = {}) {
  const isIn = (arr, v) => arr.includes(String(v || '').trim());
  const pizze  = orderFull.items.filter(it => isIn(PIZZERIA_CATEGORIES, it.category));
  const cucina = orderFull.items.filter(it => isIn(KITCHEN_CATEGORIES,  it.category));

  const txtP = buildText(orderFull, 'PIZZERIA', pizze);
  const txtC = buildText(orderFull, 'CUCINA',   cucina);

  await sendRaw(txtP, 'PIZZERIA');
  await sendRaw(txtC, 'CUCINA');
}

module.exports = { printOrderSplitByCategory };
```

### ./src/services/orders.service.js
```
// server/src/api/orders.js
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
```

### ./src/services/orders.sse.js
```
// server/src/services/orders.sse.js
// ============================================================================
// SSE (Server-Sent Events) per ORDERS
// - mount(router)    → aggiunge GET /stream (connessione SSE)
// - emitCreated(o)   → invia evento "created" { order }
// - emitStatus(p)    → invia evento "status"  { id, status }
// Stile: commenti lunghi, log con emoji
// ============================================================================

'use strict';

const logger = require('../logger');

// ID progressivo per i client connessi
let nextClientId = 1;
// Registry: id → { res }
const clients = new Map();

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  };
}

function write(res, type, data) {
  try {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // se ha chiuso, verrà ripulito su 'close'
  }
}

/** Attacca la rotta GET /stream al router passato (root: /api/orders) */
function mount(router) {
  router.get('/stream', (req, res) => {
    const id = nextClientId++;
    res.writeHead(200, sseHeaders());
    // comment line (utile in debug)
    res.write(`: connected ${id}\n\n`);

    clients.set(id, { res });
    logger.info('🧵 SSE client connected', { id, total: clients.size });

    req.on('close', () => {
      clients.delete(id);
      logger.info('🧵 SSE client disconnected', { id, total: clients.size });
    });
  });
}

// ---- Broadcasters -----------------------------------------------------------

function emitCreated(order) {
  logger.info('🧵 SSE emit created', { id: order?.id });
  for (const { res } of clients.values()) write(res, 'created', { order });
}

function emitStatus(payload) {
  logger.info('🧵 SSE emit status', { id: payload?.id, status: payload?.status });
  for (const { res } of clients.values()) write(res, 'status', payload);
}

module.exports = { mount, emitCreated, emitStatus };
```

### ./src/services/product.service.js
```
'use strict';

/**
 * Product Service
 * ----------------
 * - Query centralizzate su `products` (+ join categorie)
 * - Restituisce SEMPRE array "puliti" (query wrapper torna already rows)
 * - Log verbosi con emoji, in linea con il tuo stile
 */

const logger = require('../logger');

// ✅ Importa la funzione `query` già "wrapped" dal nostro db/index.js
//    (evita di usare `const db = require('../db')` → poi `db.query(...)`,
//     perché se il require fallisce `db` diventa undefined e scoppia)
const { query } = require('../db');

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
};

// GET all (opz. solo attivi)
async function getAll({ active = false } = {}) {
  logger.debug('🧾 products.getAll', { active });

  const sql = `
    SELECT
      p.id, p.name, p.description, p.price, p.is_active, p.sort_order,
      p.category_id, c.name AS category
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ${active ? 'WHERE p.is_active = 1' : ''}
    ORDER BY c.name, p.sort_order, p.id
  `;
  // il nostro wrapper ritorna direttamente `rows`
  const rows = await query(sql, []);
  return rows || [];
}

// GET by id
async function getById(id) {
  logger.debug('🧾 products.getById', { id });
  const rows = await query(
    `SELECT p.id, p.name, p.description, p.price, p.is_active, p.sort_order,
            p.category_id, c.name AS category
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ?`,
    [id]
  );
  return rows?.[0] || null;
}

// CREATE (campi minimi)
async function create(payload) {
  logger.debug('🧾 products.create', { payload });

  const {
    name,
    description = null,
    price = 0,
    is_active = 1,
    sort_order = 100,
    category_id = null,
  } = payload || {};

  if (!name) throw new Error('name_required');

  const result = await query(
    `INSERT INTO products
       (name, description, price, is_active, sort_order, category_id)
     VALUES (?,?,?,?,?,?)`,
    [name, description, price, is_active ? 1 : 0, sort_order, category_id]
  );

  // mysql2.execute() nel nostro wrapper torna rows, ma per INSERT usiamo affectedRows/insertId
  // il wrapper già restituisce rows, quindi per coerenza facciamo una GET by id
  // (così garantiamo stesso shape della read)
  const rows = await query('SELECT LAST_INSERT_ID() AS id');
  const id = rows?.[0]?.id;
  return getById(id);
}

// UPDATE
async function update(id, payload) {
  logger.debug('🧾 products.update', { id, payload });

  const cur = await getById(id);
  if (!cur) return null;

  const next = {
    name: payload?.name ?? cur.name,
    description: payload?.description ?? cur.description,
    price: payload?.price ?? cur.price,
    is_active: (payload?.is_active ?? cur.is_active) ? 1 : 0,
    sort_order: payload?.sort_order ?? cur.sort_order,
    category_id: payload?.category_id ?? cur.category_id,
  };

  await query(
    `UPDATE products
       SET name=?, description=?, price=?, is_active=?, sort_order=?, category_id=?
     WHERE id=?`,
    [
      next.name, next.description, next.price, next.is_active,
      next.sort_order, next.category_id, id
    ]
  );

  return getById(id);
}

// DELETE
async function remove(id) {
  logger.debug('🧾 products.remove', { id });
  const rows = await query(`DELETE FROM products WHERE id = ?`, [id]);
  // Se il wrapper ritorna oggetto "OkPacket", potremmo non avere affectedRows qui;
  // in ogni caso, una seconda read conferma la rimozione.
  const check = await getById(id);
  return !check;
}
```

### ./src/services/reservations.service.js
```
// src/services/reservations.service.js
// ============================================================================
// Service “Reservations” — query DB per prenotazioni
// Stile: commenti lunghi, log con emoji, diagnostica chiara.
// NOTA: questo è un *service module* (esporta funzioni). La tua API/Router
//       /api/reservations importerà da qui.
// - Rimasto tutto come prima (list/getById/create/update/updateStatus/...)
// - 🆕 Aggiunti:
//      • checkIn(id, when?)   → set checkin_at (idempotente) + se pending -> accepted
//      • checkOut(id, when?)  → set checkout_at (idempotente) + dwell_sec
//      • assignReservationTable(id, table_id) → utility usata dai socket
// - 🧩 Alias per compat con sockets già in uso:
//      • createReservation            = create
//      • listReservations             = list
//      • updateReservationStatus      = updateStatus
//      • checkInReservation           = checkIn
//      • checkOutReservation          = checkOut
// ============================================================================

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

// ============================================================================
// ⚙️ Cambio stato: azioni → stato finale
// - Accettiamo sia verbi (accept/confirm/…) sia stati già finali (accepted/…)
// - Restituisce la prenotazione aggiornata (per eventuali notify a valle).
// ============================================================================
const ALLOWED = new Set([
  'accept','accepted',
  'confirm','confirmed',
  'arrive','arrived',
  'reject','rejected',
  'cancel','canceled','cancelled',
  'prepare','preparing',
  'ready',
  'complete','completed',
  'no_show','noshow'
]);
const MAP = {
  accept     : 'accepted',
  confirm    : 'confirmed',
  arrive     : 'arrived',
  reject     : 'rejected',
  cancel     : 'canceled',
  cancelled  : 'canceled',
  prepare    : 'preparing',
  complete   : 'completed',
  no_show    : 'no_show',
  noshow     : 'no_show'
};
function toStatus(action) {
  const a = String(action || '').trim().toLowerCase();
  if (!ALLOWED.has(a)) throw new Error('invalid_action');
  return MAP[a] || a;
}

/**
 * updateStatus: aggiorna lo stato in DB in modo atomico.
 */
async function updateStatus({ id, action, reason = null, user_email = 'system' }) {
  const rid = Number(id);
  if (!rid || !action) throw new Error('missing_id_or_action');

  const newStatus = toStatus(action);
  const SQL_UPDATE = `
    UPDATE reservations
       SET status     = ?,
           reason     = IFNULL(?, reason),
           updated_at = CURRENT_TIMESTAMP,
           updated_by = ?
     WHERE id = ?
     LIMIT 1
  `;
  const res = await query(SQL_UPDATE, [newStatus, reason, user_email, rid]);
  if (!res?.affectedRows) throw new Error('reservation_not_found');

  logger.info('🧾 RESV.status ✅ updated', { id: rid, newStatus });

  const rows = await query('SELECT * FROM reservations WHERE id = ?', [rid]);
  return rows[0] || null;
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

// --- Hard delete --------------------------------------------------------------
async function remove(id, { user, reason } = {}) {
  const existing = await getById(id);
  if (!existing) return false;

  const allowAnyByEnv =
    (env.RESV && env.RESV.allowDeleteAnyStatus === true) ||
    (String(process.env.RESV_ALLOW_DELETE_ANY_STATUS || '').toLowerCase() === 'true');

  const statusNorm = String(existing.status || '').toLowerCase();
  const isCancelled = (statusNorm === 'cancelled' || statusNorm === 'canceled');

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

// --- Sale / Tavoli ------------------------------------------------------------
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

// --- 🆕 Utility: assegna tavolo ----------------------------------------------
async function assignReservationTable(id, table_id) {
  await query(
    `UPDATE reservations
        SET table_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? LIMIT 1`, [table_id || null, id]
  );
  const r = await getById(id);
  logger.info('🔀 reservation table assigned', { id, table_id: r.table_id });
  return r;
}

// --- 🆕 Dwell helpers ---------------------------------------------------------
function _computeDwellSec(checkinAt, checkoutAt) {
  try {
    const ci = new Date(checkinAt).getTime();
    const co = new Date(checkoutAt).getTime();
    if (!isFinite(ci) || !isFinite(co)) return null;
    return Math.max(0, Math.floor((co - ci) / 1000));
  } catch { return null; }
}

// --- 🆕 Check-in / Check-out --------------------------------------------------
async function checkIn(id, when = null, { user } = {}) {
  const nowExpr = when ? `?` : `CURRENT_TIMESTAMP`;
  const params  = when ? [when, id] : [id];

  // set checkin_at solo se NULL → idempotente
  await query(`
    UPDATE reservations
       SET checkin_at = COALESCE(checkin_at, ${nowExpr}),
           updated_at = CURRENT_TIMESTAMP,
           updated_by = ?
     WHERE id = ?
     LIMIT 1
  `, [trimOrNull(user?.email) || 'system', ...params]);

  // se pending → accepted (manteniamo compat FE)
  const after1 = await getById(id);
  if (after1 && String(after1.status).toLowerCase() === 'pending') {
    await updateStatus({ id, action: 'accept', user_email: trimOrNull(user?.email) || 'system' });
  }

  const final = await getById(id);
  logger.info('✅ RESV check-in', { id, checkin_at: final?.checkin_at, status: final?.status });
  return final;
}

async function checkOut(id, when = null, { user } = {}) {
  const nowExpr = when ? `?` : `CURRENT_TIMESTAMP`;
  const params  = when ? [when, id] : [id];

  // set checkout_at solo se NULL → idempotente
  await query(`
    UPDATE reservations
       SET checkout_at = COALESCE(checkout_at, ${nowExpr}),
           updated_at  = CURRENT_TIMESTAMP,
           updated_by  = ?
     WHERE id = ?
     LIMIT 1
  `, [trimOrNull(user?.email) || 'system', ...params]);

  const r = await getById(id);
  if (r?.checkin_at && r?.checkout_at) {
    const dwell = _computeDwellSec(r.checkin_at, r.checkout_at);
    if (dwell != null) {
      await query(`UPDATE reservations SET dwell_sec = ? WHERE id = ? LIMIT 1`, [dwell, id]);
      logger.info('🧮 dwell_sec computed', { id, dwell_sec: dwell });
    }
  }

  const final = await getById(id);
  logger.info('🧹 RESV check-out', { id, checkout_at: final?.checkout_at, dwell_sec: final?.dwell_sec });
  return final;
}

// --- Exports ------------------------------------------------------------------
module.exports = {
  // esistenti
  list,
  getById,
  create,
  update,
  updateStatus,
  remove,
  countByStatus,
  listRooms,
  listTablesByRoom,

  // utility tavolo
  assignReservationTable,

  // nuovi metodi
  checkIn,
  checkOut,

  // alias compat sockets
  createReservation       : create,
  listReservations        : list,
  updateReservationStatus : updateStatus,
  checkInReservation      : checkIn,
  checkOutReservation     : checkOut,
};
```

### ./src/services/reservations-status.service.js
```
// 📡 Socket.IO — Prenotazioni tavolo (realtime) + creazione anche da Admin
// - Mantiene i canali esistenti (reservations-get/new/update-status/assign-table)
// - 🆕 Aggiunge eventi di comodo per check-in / check-out (opzionali dal client)
//   • 'reservation-checkin'  { id, at? }   → svc.checkIn()
//   • 'reservation-checkout' { id, at? }   → svc.checkOut()
const logger = require('../logger'); // ✅ istanza diretta
const {
  createReservation,
  updateReservationStatus,
  assignReservationTable,
  listReservations,
  checkInReservation,   // 🆕 alias nel service
  checkOutReservation   // 🆕 alias nel service
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
      const r = await updateReservationStatus({ id, action: status });
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    socket.on('reservation-assign-table', async ({ id, table_id }) => {
      logger.info('📡 [RES] reservation-assign-table ▶️', { id, table_id });
      const r = await assignReservationTable(id, table_id);
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    // 🆕 CHECK-IN
    socket.on('reservation-checkin', async ({ id, at = null }) => {
      logger.info('📡 [RES] reservation-checkin ▶️', { id, at });
      const r = await checkInReservation(id, at, { user: { email: 'socket@server' } });
      io.to('admins').emit('reservation-checkin', { id: r.id, checkin_at: r.checkin_at });
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    // 🆕 CHECK-OUT
    socket.on('reservation-checkout', async ({ id, at = null }) => {
      logger.info('📡 [RES] reservation-checkout ▶️', { id, at });
      const r = await checkOutReservation(id, at, { user: { email: 'socket@server' } });
      io.to('admins').emit('reservation-checkout', { id: r.id, checkout_at: r.checkout_at, dwell_sec: r.dwell_sec });
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    socket.on('disconnect', (reason) => {
      logger.info('📡 [RES] SOCKET disconnected', { id: socket.id, reason });
    });
  });
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

### ./src/sse.js
```
// src/sse.js
// ============================================================================
// SSE per ORDERS (Server-Sent Events).
// - mount(router) → GET /stream
// - emitCreated(order), emitStatus({id,status})
// ============================================================================
'use strict';
const logger = require('./logger');

let nextClientId = 1;
const clients = new Map(); // id -> { res }

function headers() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };
}

function write(res, type, data) {
  try {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch { /* client chiuso */ }
}

function mount(router) {
  router.get('/stream', (req, res) => {
    const id = nextClientId++;
    res.writeHead(200, headers());
    res.write(`: connected ${id}\n\n`);
    clients.set(id, { res });
    logger.info('🧵 SSE client connected', { id, total: clients.size });

    req.on('close', () => {
      clients.delete(id);
      logger.info('🧵 SSE client disconnected', { id, total: clients.size });
    });
  });
}

function emitCreated(order) {
  logger.info('🧵 SSE emit created', { id: order?.id });
  for (const { res } of clients.values()) write(res, 'created', { order });
}

function emitStatus(payload) {
  logger.info('🧵 SSE emit status', { id: payload?.id, status: payload?.status });
  for (const { res } of clients.values()) write(res, 'status', payload);
}

module.exports = { mount, emitCreated, emitStatus };
```

### ./src/utils/print-order.js
```
// src/utils/print-order.js
// ============================================================================
// Stampa ESC/POS “Pizzeria/Cucina”. NIENTE simbolo € (codepage problemi).
// - legge env PRINTER_* e mapping categorie PIZZERIA_CATEGORIES / KITCHEN_CATEGORIES
// - se PRINTER_ENABLED=false → no-op (non blocca i flussi)
// ============================================================================
'use strict';

const net = require('net');
const logger = require('../logger');

const {
  PRINTER_ENABLED = 'true',
  PRINTER_IP = '127.0.0.1',
  PRINTER_PORT = '9100',
  PRINTER_CUT = 'true',
  PRINTER_HEADER = '',
  PRINTER_FOOTER = '',
  PRINTER_WIDTH_MM = '80',
  // mapping reparti
  PIZZERIA_CATEGORIES = 'PIZZE,PIZZE ROSSE,PIZZE BIANCHE',
  KITCHEN_CATEGORIES = 'ANTIPASTI,FRITTI,BEVANDE',
} = process.env;

function esc(...codes) { return Buffer.from(codes); }
const TXT = s => Buffer.from(String(s) + '\n', 'utf8');

function openSocket() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(
      { host: PRINTER_IP, port: Number(PRINTER_PORT || 9100) },
      () => resolve(socket)
    );
    socket.on('error', reject);
  });
}

function splitByDept(items) {
  const piz = new Set(PIZZERIA_CATEGORIES.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  const kit = new Set(KITCHEN_CATEGORIES.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));

  const pizzeria = [];
  const kitchen  = [];
  for (const it of items) {
    const cat = (it.category || 'Altro').toString().toUpperCase();
    if (piz.has(cat)) pizzeria.push(it);
    else if (kit.has(cat)) kitchen.push(it);
    else pizzeria.push(it); // default
  }
  return { pizzeria, kitchen };
}

async function printSlip(title, order) {
  const sock = await openSocket();

  const write = (buf) => sock.write(buf);
  const cut   = () => { if (PRINTER_CUT === 'true') write(esc(0x1D, 0x56, 0x42, 0x00)); };

  const headerLines = (PRINTER_HEADER || '').split('|').filter(Boolean);
  write(esc(0x1B,0x40));            // init
  write(esc(0x1B,0x21,0x20));       // double height
  write(TXT(title));
  write(esc(0x1B,0x21,0x00));       // normal

  for (const h of headerLines) write(TXT(h));

  write(TXT('------------------------------'));
  write(TXT(`#${order.id}  ${order.customer_name}`));
  if (order.phone) write(TXT(order.phone));
  if (order.people) write(TXT(`Coperti: ${order.people}`));
  if (order.scheduled_at) write(TXT(`Orario: ${order.scheduled_at}`));
  write(TXT('------------------------------'));

  for (const it of order.items) {
    // NO simbolo euro: stampa “prezzo” semplice
    write(TXT(`${it.qty} x ${it.name}  ${Number(it.price).toFixed(2)}`));
    if (it.notes) write(TXT(`  NOTE: ${it.notes}`));
  }

  write(TXT('------------------------------'));
  write(TXT(`Totale: ${Number(order.total || 0).toFixed(2)}`));
  if (PRINTER_FOOTER) {
    write(TXT(''));
    for (const f of (PRINTER_FOOTER || '').split('|')) write(TXT(f));
  }
  write(TXT(''));
  cut();
  sock.end();
}

async function printOrderDual(orderFull) {
  if (PRINTER_ENABLED !== 'true') {
    logger.warn('🖨️  PRINT disabled (PRINTER_ENABLED=false)');
    return;
  }
  const { pizzeria, kitchen } = splitByDept(orderFull.items || []);
  const head = {
    id: orderFull.id,
    customer_name: orderFull.customer_name,
    phone: orderFull.phone,
    people: orderFull.people,
    scheduled_at: orderFull.scheduled_at,
    total: orderFull.total,
  };

  // stampa PIZZERIA
  if (pizzeria.length) {
    await printSlip('PIZZERIA', { ...head, items: pizzeria });
    logger.info('🖨️  PIZZERIA printed', { id: orderFull.id, items: pizzeria.length });
  }
  // stampa CUCINA
  if (kitchen.length) {
    await printSlip('CUCINA', { ...head, items: kitchen });
    logger.info('🖨️  CUCINA printed', { id: orderFull.id, items: kitchen.length });
  }
}

module.exports = { printOrderDual };
```
