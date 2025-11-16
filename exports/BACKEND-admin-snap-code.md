# 🧩 Project code (file ammessi in .)

_Generato: Sun, Nov 16, 2025 11:31:39 PM_

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
        "qrcode": "1.5.4",
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

### ./src/api/customers.js
```
// ============================================================================
// CUSTOMERS API — i “clienti” sono righe della tabella `users`
// Rotte:
//   GET  /api/customers               → lista (SEMPR E ARRAY)
//   GET  /api/customers/:id           → dettaglio (OGGETTO)
//   POST /api/customers               → crea
//   PUT  /api/customers/:id           → aggiorna
//   PUT  /api/customers/:id/disable   → is_active=0
//   PUT  /api/customers/:id/enable    → is_active=1
//   GET  /api/customers/:id/orders    → storico ordini
// Stile: commenti 🇮🇹 + log a emoji. Compatibile sia con mysql2 pool che con wrapper { query }.
// ============================================================================

'use strict';
const express = require('express');
const router  = express.Router();

module.exports = (app) => {
  const db  = app?.get('db') || require('../db');
  const log = app?.get('logger') || console;

  // Normalizza il risultato di db.query():
  // - mysql2/promise → [rows, fields]  → ritorna rows
  // - wrapper { query }                → ritorna già rows
  async function q(sql, params = []) {
    const res = await db.query(sql, params);
    return (Array.isArray(res) && Array.isArray(res[0])) ? res[0] : res;
  }

  const like = v => `%${String(v || '').trim().toLowerCase()}%`;
  const normPhone = v => String(v || '').replace(/\s+/g, '').replace(/^\+/, '').replace(/-/g, '');

  // ---- LIST (sempre array) -----------------------------------------------
  router.get('/', async (req, res) => {
    const qRaw   = String(req.query.q || '').trim();
    const qlow   = qRaw.toLowerCase();
    const limit  = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    res.set('x-route', 'customers:list');
    log.info('👥 [Customers] list ▶️', { q: qRaw || '(tutti)', limit, offset });

    let where = '1=1';
    const params = [];

    if (qlow) {
      where = `(
        LOWER(COALESCE(u.full_name, ''))      LIKE ?
        OR LOWER(COALESCE(u.first_name, ''))  LIKE ?
        OR LOWER(COALESCE(u.last_name, ''))   LIKE ?
        OR LOWER(COALESCE(u.email, ''))       LIKE ?
        OR REPLACE(REPLACE(REPLACE(COALESCE(u.phone,''),' ',''),'+',''),'-','') LIKE ?
      )`;
      const qp = like(qlow);
      params.push(qp, qp, qp, qp, normPhone(qlow));
    }

    const sql = `
      SELECT
        u.id, u.full_name, u.first_name, u.last_name, u.email, u.phone,
        u.is_active, u.tags, u.note,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_user_id = u.id) AS orders_count,
        (SELECT IFNULL(SUM(i.qty*i.price),0)
           FROM orders o
           JOIN order_items i ON i.order_id = o.id
          WHERE o.customer_user_id = u.id) AS total_spent,
        (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_user_id = u.id) AS last_order_at
      FROM users u
      WHERE ${where}
      ORDER BY COALESCE(
               (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_user_id = u.id),
               u.id
             ) DESC
      LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    try {
      const rows = await q(sql, params);
      const out = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      log.info(`✅ [Customers] list ← ${out.length} righe`);
      res.json(out); // ← SEMPRE ARRAY
    } catch (e) {
      log.error('❌ /api/customers list', { error: String(e) });
      res.status(500).json([]); // ← SEMPRE ARRAY anche in errore
    }
  });

  // ---- DETAIL (oggetto) ---------------------------------------------------
  router.get('/:id(\\d+)', async (req, res) => {
    const id = Number(req.params.id);
    res.set('x-route', 'customers:detail');
    try {
      const rows = await q(`
        SELECT
          u.id, u.full_name, u.first_name, u.last_name, u.email, u.phone, u.is_active, u.tags, u.note,
          (SELECT COUNT(*) FROM orders o WHERE o.customer_user_id = u.id) AS orders_count,
          (SELECT IFNULL(SUM(i.qty*i.price),0)
             FROM orders o
             JOIN order_items i ON i.order_id = o.id
            WHERE o.customer_user_id = u.id) AS total_spent,
          (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_user_id = u.id) AS last_order_at
        FROM users u WHERE u.id=? LIMIT 1`, [id]);
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) return res.status(404).json({ ok:false, error: 'not_found' });
      log.info('ℹ️ [Customers] detail ←', { id });
      res.json(row);
    } catch {
      res.status(500).json({ ok:false, error: 'customer_detail_error' });
    }
  });

  // ---- CREATE -------------------------------------------------------------
  router.post('/', async (req, res) => {
    const { full_name, first_name, last_name, phone, email, note, tags, is_active } = req.body || {};
    try {
      const r = await q(`
        INSERT INTO users (full_name, first_name, last_name, phone, email, note, tags, is_active)
        VALUES (?,?,?,?,?,?,?,?)`,
        [full_name||null, first_name||null, last_name||null, phone||null, email||null, note||null, tags||null,
         (is_active===0?0:1)]);
      const id = Number(r?.insertId);
      const row = (await q(`SELECT * FROM users WHERE id=?`, [id]))?.[0] || null;
      log.info('🟢 [Customers] create id=', id);
      res.status(201).json(row);
    } catch (e) {
      log.error('❌ [Customers] create', String(e));
      res.status(500).json({ ok:false, error: 'customer_create_error' });
    }
  });

  // ---- UPDATE -------------------------------------------------------------
  router.put('/:id(\\d+)', async (req, res) => {
    const id = Number(req.params.id);
    const { full_name, first_name, last_name, phone, email, note, tags, is_active } = req.body || {};
    try {
      await q(`
        UPDATE users SET
          full_name = COALESCE(?, full_name),
          first_name= COALESCE(?, first_name),
          last_name = COALESCE(?, last_name),
          phone     = COALESCE(?, phone),
          email     = COALESCE(?, email),
          note      = COALESCE(?, note),
          tags      = COALESCE(?, tags),
          is_active = COALESCE(?, is_active)
        WHERE id=?`,
        [full_name, first_name, last_name, phone, email, note, tags,
         ([0,1].includes(is_active)? is_active : null), id]);
      const out = (await q(`SELECT * FROM users WHERE id=?`, [id]))?.[0] || null;
      log.info('✏️  [Customers] update id=', id);
      res.json(out);
    } catch (e) {
      log.error('❌ [Customers] update', String(e));
      res.status(500).json({ ok:false, error: 'customer_update_error' });
    }
  });

  // ---- ENABLE / DISABLE ---------------------------------------------------
  router.put('/:id(\\d+)/disable', async (req, res) => {
    const id = Number(req.params.id);
    await q(`UPDATE users SET is_active=0 WHERE id=?`, [id]);
    log.warn('⛔ [Customers] disable id=', id);
    res.json({ ok:true });
  });

  router.put('/:id(\\d+)/enable', async (req, res) => {
    const id = Number(req.params.id);
    await q(`UPDATE users SET is_active=1 WHERE id=?`, [id]);
    log.info('✅ [Customers] enable id=', id);
    res.json({ ok:true });
  });

  // ---- ORDERS of customer -------------------------------------------------
  router.get('/:id(\\d+)/orders', async (req, res) => {
    const id = Number(req.params.id);
    try {
      const rows = await q(`
        SELECT
          o.id, o.status, o.channel, o.created_at, o.scheduled_at, o.note,
          o.customer_name, o.phone, o.email,
          (SELECT SUM(i.qty*i.price) FROM order_items i WHERE i.order_id = o.id) AS total
        FROM orders o
        WHERE o.customer_user_id = ?
        ORDER BY o.created_at DESC
        LIMIT 500`, [id]);
      const out = (rows || []).map(r => ({ ...r, total: r.total!=null ? Number(r.total) : null }));
      res.json(out);
    } catch {
      res.status(500).json({ ok:false, error: 'customer_orders_error' });
    }
  });

  // 🔧 sanity ping
  router.get('/_debug/ping', (_req, res) => {
    res.set('x-route', 'customers:debug');
    res.json({ ok: true, who: 'customers-router' });
  });

  return router;
};
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

### ./src/api/nfc.js
```
// C:\Users\Endri Azizi\progetti-dev\my_dev\be\src\api\nfc.js
// ============================================================================
// API NFC — bind/resolve/qr/url per tag NFC dei tavoli + gestione sessione
// + 🆕 CART snapshot con optimistic locking e broadcast Socket.IO
// Mantiene stile log con emoji e risposte { ok, ... }.
// ============================================================================

const express = require('express');
const router  = express.Router();
const NFC     = require('../services/nfc.service');
const logger  = require('../logger');

// Helper per ottenere io: preferisci req.app.get('io'), fallback al singleton
function getIO(req) {
  try { return req.app?.get('io') || require('../sockets').io(); }
  catch { return null; }
}

// POST /api/nfc/bind { table_id, forceNew? } → { ok, token, url }
router.post('/bind', async (req, res) => {
  try {
    const { table_id, forceNew } = req.body || {};
    if (!table_id) return res.status(400).json({ ok: false, error: 'table_id mancante' });

    const token = await NFC.bindTable(Number(table_id), { forceNew: !!forceNew });
    const url   = NFC.buildPublicUrl(token, req);
    logger.info(`🔗 [API] bind table_id=${table_id} → ${token}`);
    res.json({ ok: true, token, url });
  } catch (err) {
    logger.error('❌ [API] /nfc/bind', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

// GET /api/nfc/resolve?token=XYZ → { ok, table_id, room_id, table_number, reservation_id?, session_id }
router.get('/resolve', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).json({ ok: false, error: 'token mancante' });

    const info = await NFC.resolveToken(token);
    if (!info)  return res.status(404).json({ ok: false, error: 'not_found_or_revoked' });

    logger.info(`🔎 [API] resolve token=${token} → table_id=${info.table_id} (session_id=${info.session_id})`);
    res.json(info);
  } catch (err) {
    logger.error('❌ [API] /nfc/resolve', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

// GET /api/nfc/url/:tableId → { ok, token, url }
router.get('/url/:tableId', async (req, res) => {
  try {
    const tableId = Number(req.params.tableId);
    if (!tableId) return res.status(400).json({ ok: false, error: 'tableId non valido' });

    const token = await NFC.bindTable(tableId, { forceNew: false });
    const url   = NFC.buildPublicUrl(token, req);
    res.json({ ok: true, token, url });
  } catch (err) {
    logger.error('❌ [API] /nfc/url/:tableId', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

// GET /api/nfc/qr?u=ENCODED_URL → PNG (qrcode)
router.get('/qr', async (req, res) => {
  try {
    const url = String(req.query.u || '').trim();
    if (!url) return res.status(400).json({ ok: false, error: 'u mancante' });

    const QR = require('qrcode');
    res.setHeader('Content-Type', 'image/png');
    QR.toFileStream(res, url, { errorCorrectionLevel: 'M', margin: 1, scale: 6 });
  } catch (err) {
    logger.error('❌ [API] /nfc/qr', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

// GET /api/nfc/qr/token/:token → PNG
router.get('/qr/token/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ ok: false, error: 'token mancante' });

    const url = NFC.buildPublicUrl(token, req);
    const QR  = require('qrcode');
    res.setHeader('Content-Type', 'image/png');
    QR.toFileStream(res, url, { errorCorrectionLevel: 'M', margin: 1, scale: 6 });
  } catch (err) {
    logger.error('❌ [API] /nfc/qr/token/:token', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

// =========================== SESSIONI (stato veloce) =======================
// GET /api/nfc/session/active?table_id=123
// → { ok:true, active:false }  oppure
// → { ok:true, active:true, session_id, started_at, cart_updated_at }
router.get('/session/active', async (req, res) => {
  try {
    const tableId = Number(req.query.table_id || 0) || 0;
    if (!tableId) return res.status(400).json({ ok: false, error: 'table_id mancante' });

    let row = null;
    // Tollerante ai nomi metodo nel service
    if (typeof NFC.getActiveSessionForTable === 'function') {
      row = await NFC.getActiveSessionForTable(tableId);
    } else if (typeof NFC.getActiveSession === 'function') {
      row = await NFC.getActiveSession(tableId);
    } else if (typeof NFC.findActiveSessionForTable === 'function') {
      row = await NFC.findActiveSessionForTable(tableId);
    }

    if (!row) return res.json({ ok: true, active: false });

    const session_id      = Number(row.session_id || row.id || 0) || null;
    const started_at      = row.started_at || row.created_at || null;
    const cart_updated_at = row.cart_updated_at || null;

    res.json({ ok: true, active: true, session_id, started_at, cart_updated_at });
  } catch (err) {
    logger.error('❌ [API] /nfc/session/active', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

// =========================== CART SNAPSHOT ================================
// GET /api/nfc/session/cart?session_id=SID → { ok, session_id, version, cart, updated_at }
router.get('/session/cart', async (req, res) => {
  try {
    const sessionId = Number(req.query.session_id || 0) || 0;
    if (!sessionId) return res.status(400).json({ ok: false, error: 'session_id mancante' });

    const cur = await NFC.getSessionCart(sessionId);
    if (!cur) return res.status(404).json({ ok: false, error: 'session_not_found' });

    let cart = null;
    try { cart = cur.cart_json ? JSON.parse(cur.cart_json) : null; } catch { cart = null; }

    res.json({ ok: true, session_id: sessionId, version: cur.version || 0, cart, updated_at: cur.cart_updated_at || null });
  } catch (err) {
    logger.error('❌ [API] GET /nfc/session/cart', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

// PUT /api/nfc/session/cart  { session_id, version, cart }
router.put('/session/cart', async (req, res) => {
  try {
    const { session_id, version, cart } = req.body || {};
    const sessionId = Number(session_id || 0) || 0;
    if (!sessionId) return res.status(400).json({ ok: false, error: 'session_id mancante' });

    const out = await NFC.saveSessionCart(sessionId, Number(version || 0), cart || null);

    // Broadcast Socket.IO su stanza session:<SID>
    const io = getIO(req);
    if (io && out?.ok) {
      io.to(`session:${sessionId}`).emit('nfc:cart_updated', {
        session_id: sessionId,
        version   : out.version,
        at        : out.updated_at
      });
    }

    res.json({ ok: true, session_id: sessionId, version: out.version, updated_at: out.updated_at });
  } catch (err) {
    if (err?.status === 409) {
      return res.status(409).json({ ok: false, error: 'version_conflict', current: err.current || null });
    }
    logger.error('❌ [API] PUT /nfc/session/cart', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

// 🆕 POST /api/nfc/session/close { table_id, by? } → { ok:true, closed, session_id? }
router.post('/session/close', async (req, res) => {
  try {
    const table_id = Number(req.body?.table_id || 0);
    const by       = (req.body?.by || 'api/nfc').toString();
    if (!table_id) return res.status(400).json({ ok: false, error: 'table_id mancante' });

    const out = await NFC.closeActiveSession(table_id, { by, reason: 'manual' });
    logger.info(`🛑 [API] close session table_id=${table_id} →`, out);

    // Broadcast di chiusura (facoltativo)
    const io = getIO(req);
    if (io && out?.session_id) io.to(`session:${out.session_id}`).emit('nfc:cart_updated', { session_id: out.session_id, closed: true });

    res.json({ ok: true, ...out });
  } catch (err) {
    logger.error('❌ [API] /nfc/session/close', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

module.exports = router;
```

### ./src/api/nfc-session.js
```
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
// C:\Users\Endri Azizi\progetti-dev\my_dev\be\src\api\reservations.js
'use strict';

/**
 * Router REST per /api/reservations
 * - Mantiene il tuo stile: commenti lunghi, log emoji, diagnostica chiara.
 * - Usa i tuoi services:
 *   • svc         = ../services/reservations.service        (CRUD + query DB)
 *   • resvActions = ../services/reservations-status.service (state machine + audit)
 *   • mailer, wa, printerSvc                                (notifiche/stampe)
 * - 🆕 Rotte esplicite:
 *   • POST /:id/checkin   → persiste checkin_at (idempotente) + emit socket
 *   • POST /:id/checkout  → persiste checkout_at + dwell_sec (idempotente) + emit socket {table_id, cleaning_until}
 * - ✅ FIX mail: dopo updateStatus ricarico la riga “idratata” via svc.getById(id)
 * - ✅ FIX date: accetta string o oggetto {date:'...'} senza più .slice() su oggetto
 */

const express = require('express');
const router  = express.Router();

const logger = require('../logger');
const env    = require('../env');

const svc          = require('../services/reservations.service');          // ✅
const resvActions  = require('../services/reservations-status.service');   // ✅
const mailer       = require('../services/mailer.service');                // ✅
const wa           = require('../services/whatsapp.service');              // ✅
const printerSvc   = require('../services/thermal-printer.service');       // ✅

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

// helper
const norm = (v) => (v ?? '').toString().trim();
function pickAction(body = {}) {
  const raw = norm(body.action ?? body.status ?? body.next).toLowerCase();
  if (!raw) return null;
  const map = {
    confirm:'confirm', confirmed:'confirm', accept:'confirm', accepted:'confirm', approve:'confirm', approved:'confirm',
    cancel:'cancel', cancelled:'cancel',
    reject:'reject', rejected:'reject',
    prepare:'prepare', preparing:'prepare',
    ready:'ready',
    complete:'complete', completed:'complete'
  };
  return map[raw] || raw;
}
function pickDate10(input) {
  if (!input) return new Date().toISOString().slice(0,10);
  if (typeof input === 'string') return input.slice(0,10);
  const s = input.date || input.day || input.ymd || input.value || '';
  return String(s).slice(0,10);
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
    const rows = await svc.countByStatus({ from: req.query.from || null, to: req.query.to || null });
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
  const reason  = norm(req.body?.reason) || null;
  const notify  = (req.body?.notify !== undefined) ? !!req.body.notify : undefined;
  const toEmail = norm(req.body?.email) || null;
  const replyTo = norm(req.body?.reply_to) || null;

  if (!action) {
    logger.warn('⚠️ /status missing params', { id, raw: req.body });
    return res.status(400).json({ error: 'missing_action' });
  }

  try {
    // (1) state machine + audit (riga “spoglia”)
    await resvActions.updateStatus({
      id,
      action,
      reason,
      user_email: req.user?.email || 'dev@local'
    });

    // (2) ricarico riga “idratata”
    const updated = await svc.getById(id);

    // (3) email best-effort
    try {
      const mustNotify = (notify === true) || (notify === undefined && !!env.RESV?.notifyAlways);
      if (mustNotify) {
        const dest = toEmail || updated?.contact_email || updated?.email || null;
        if (dest && mailer?.sendStatusChangeEmail) {
          await mailer.sendStatusChangeEmail({
            to: dest, reservation: updated, newStatus: updated.status, reason, replyTo
          });
          logger.info('📧 status-change mail ✅', { id, to: dest, status: updated.status });
        } else {
          logger.warn('📧 status-change mail SKIP (no email or mailer)', { id, status: updated?.status || '' });
        }
      }
    } catch (e) { logger.error('📧 status-change mail ❌', { id, error: String(e) }); }

    // (4) whatsapp best-effort
    try {
      if (wa?.sendStatusChange) {
        await wa.sendStatusChange({
          to: updated?.contact_phone || updated?.phone || null,
          reservation: updated,
          status: updated.status,
          reason
        });
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
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  try {
    const at = norm(req.body?.at) || null; // ISO opzionale
    const r = await svc.checkIn(id, { at, user: req.user });
    // socket (se presente)
    try {
      const io = req.app.get('io');
      if (io) {
        io.to('admins').emit('reservation-checkin', { id: r.id, table_id: r.table_id || null });
        logger.info('📡 emit reservation-checkin', { id: r.id, table_id: r.table_id || null });
      }
    } catch {}
    logger.info('✅ RESV check-in', { service:'server', id: r.id, checkin_at: r.checkin_at, status: r.status });
    return res.json({ ok: true, reservation: r });
  } catch (err) {
    logger.error('❌ [POST] /api/reservations/:id/checkin', { id, error: String(err) });
    return res.status(400).json({ error: err.message || 'checkin_failed' });
  }
});

// ----------------------------- 🆕 CHECK-OUT ----------------------------------
router.post('/:id(\\d+)/checkout', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
  try {
    const at = norm(req.body?.at) || null;  // ISO opzionale
    const r  = await svc.checkOut(id, { at, user: req.user });

    // finestra pulizia 5:00 per FE (anche se idempotente)
    const cleaningSecs  = Number(process.env.CLEANING_SECS || 300);
    const cleaningUntil = new Date(Date.now() + cleaningSecs * 1000).toISOString();

    // socket broadcast (SEMPRE) + log
    try {
      const io = req.app.get('io');
      if (io) {
        io.to('admins').emit('reservation-checkout', {
          id: r.id, table_id: r.table_id || null, cleaning_until: cleaningUntil
        });
        logger.info('📡 emit reservation-checkout', { id: r.id, table_id: r.table_id || null, cleaning_until: cleaningUntil });
      }
    } catch {}

    logger.info('✅ RESV checkout', { service:'server', id: r.id, checkout_at: r.checkout_at, dwell_sec: r.dwell_sec });
    return res.json({ ok: true, reservation: r, cleaning_until: cleaningUntil });
  } catch (err) {
    logger.error('❌ [POST] /api/reservations/:id/checkout', { id, error: String(err) });
    return res.status(400).json({ error: err.message || 'checkout_failed' });
  }
});

// Alias "ricco" per eventuali FE
router.post('/:id(\\d+)/checkout-with-meta', requireAuth, async (req, res) => {
  req.url = `/api/reservations/${req.params.id}/checkout`;
  return router.handle(req, res);
});

// ------------------------------ DELETE (hard) --------------------------------
router.delete('/:id(\\d+)', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await svc.getById(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const force  = String(req.query.force || '').toLowerCase() === 'true';
    const allowAny =
      (env.RESV && env.RESV.allowDeleteAnyStatus === true) ||
      (String(process.env.RESV_ALLOW_DELETE_ANY_STATUS || '').toLowerCase() === 'true') ||
      force;

    const statusNorm = String(existing.status || '').toLowerCase();
    const isCancelled = (statusNorm === 'cancelled' || statusNorm === 'canceled');
    if (!allowAny && !isCancelled) {
      return res.status(409).json({
        error: 'delete_not_allowed',
        message: 'Puoi eliminare solo prenotazioni in stato CANCELLED (usa ?force=true o abilita RESV_ALLOW_DELETE_ANY_STATUS).'
      });
    }

    const ok = await svc.remove(id, { user: req.user, reason: 'hard-delete' });
    if (!ok) return res.status(500).json({ error: 'delete_failed' });
    logger.info('🗑️ [DELETE] /api/reservations/:id OK', { id, force, status: existing.status });
    return res.json({ ok: true, id });
  } catch (err) {
    logger.error('❌ [DELETE] /api/reservations/:id', { error: String(err) });
    return res.status(500).json({ error: err.message || 'internal_error' });
  }
});

// ------------------------------ PRINT ----------------------------------------
router.post('/print/daily', requireAuth, async (req, res) => {
  try {
    const date = pickDate10(req.body?.date || req.body);
    const status = norm(req.body?.status || 'all').toLowerCase();
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

router.post('/print/placecards', requireAuth, async (req, res) => {
  try {
    const date   = pickDate10(req.body?.date || req.body);
    const status = norm(req.body?.status || 'accepted').toLowerCase();
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
// C:\Users\Endri Azizi\progetti-dev\my_dev\be\src\server.js
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
 */
// ❌ legacy: app.use('/api/google', require('./api/google'));  // DISATTIVATO
app.use('/api/google/oauth', googleOauth);
app.use('/api/google/people', googlePeople);

// 🆕 NFC API
app.use('/api/nfc', require('./api/nfc'));
// 🆕 NFC Session API (ultimo ordine per sessione)
app.use('/api/nfc/session', require('./api/nfc-session')); // <— AGGIUNTA
if (ensureExists('api/customers', 'API /api/customers')) app.use('/api/customers', require('./api/customers')(app));


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

### ./src/services/nfc.service.js
```
'use strict';

// src/services/nfc.service.js
// ============================================================================
// NFC Service — token/tag per tavoli + "Sessione Tavolo"
// - generateToken / bindTable / revokeToken
// - resolveToken(token): prima verifica su nfc_tags, poi JOIN per meta tavolo
// - sessione tavolo (table_sessions)
// Stile: commenti lunghi + log con emoji
// ============================================================================

const crypto = require('crypto');
const { query } = require('../db');      // wrapper mysql2
const logger   = require('../logger');

const TABLE    = 'nfc_tags';
const TABLE_TS = 'table_sessions';

// ----------------------------- utils ----------------------------------------
function base62(bytes = 9) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const buf = crypto.randomBytes(bytes);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}
function generateToken(len = 12) {
  let token = '';
  while (token.length < len) token += base62(9);
  return token.slice(0, len);
}

// --------------------------- token <-> tavolo --------------------------------
async function getActiveByTable(tableId) {
  const rows = await query(
    `SELECT id, table_id, token, is_revoked, created_at
       FROM ${TABLE}
      WHERE table_id=? AND is_revoked=0
   ORDER BY id DESC
      LIMIT 1`, [tableId]
  );
  return rows[0] || null;
}

async function insertToken(tableId, token) {
  await query(
    `INSERT INTO ${TABLE} (table_id, token, is_revoked) VALUES (?, ?, 0)`,
    [tableId, token]
  );
  return token;
}

async function revokeByTable(tableId) {
  await query(
    `UPDATE ${TABLE}
        SET is_revoked=1, revoked_at=NOW()
      WHERE table_id=? AND is_revoked=0`,
    [tableId]
  );
}

async function bindTable(tableId, opts = {}) {
  if (!tableId) throw new Error('table_id mancante');
  const { forceNew = false } = opts;

  if (!forceNew) {
    const current = await getActiveByTable(tableId);
    if (current) {
      logger.info(`🔗 [NFC] Token esistente per table_id=${tableId} → ${current.token}`);
      return current.token;
    }
  }
  if (forceNew) {
    logger.warn(`♻️ [NFC] Rigenerazione token per table_id=${tableId} (revoca precedenti)`);
    await revokeByTable(tableId);
  }

  let token = generateToken(12);
  for (let i = 0; i < 5; i++) {
    try { await insertToken(tableId, token); return token; }
    catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('ER_DUP_ENTRY')) { token = generateToken(12); continue; }
      throw err;
    }
  }
  throw new Error('Impossibile generare token univoco');
}

async function revokeToken(token) {
  if (!token) throw new Error('token mancante');
  await query(
    `UPDATE ${TABLE}
        SET is_revoked=1, revoked_at=NOW()
      WHERE token=? AND is_revoked=0`,
    [token]
  );
  return { ok: true };
}

function buildPublicUrl(token, req) {
  const base = process.env.PUBLIC_BASE_URL
    || `${req?.protocol || 'http'}://${req?.get ? req.get('host') : 'localhost:3000'}`;
  return `${base.replace(/\/+$/, '')}/t/${encodeURIComponent(token)}`;
}

// ---------------------------- sessione tavolo --------------------------------
async function getActiveSession(tableId) {
  const rows = await query(
    `SELECT id, table_id, opened_at, opened_by
       FROM ${TABLE_TS}
      WHERE table_id=? AND closed_at IS NULL
   ORDER BY id DESC
      LIMIT 1`,
    [tableId]
  );
  return rows?.[0] || null;
}
async function openSession(tableId, { by, note } = {}) {
  const res = await query(
    `INSERT INTO ${TABLE_TS} (table_id, opened_by, note) VALUES (?,?,?)`,
    [tableId, by || null, note || null]
  );
  const id = res?.insertId || null;
  logger.info(`🟢 [NFC] Sessione APERTA table_id=${tableId} (session_id=${id})`);
  return id;
}
async function closeActiveSession(tableId, { by, reason } = {}) {
  const act = await getActiveSession(tableId);
  if (!act) return { closed: 0 };
  await query(
    `UPDATE ${TABLE_TS}
        SET closed_at = NOW(), closed_by = ?
      WHERE id = ? AND closed_at IS NULL`,
    [by || reason || null, act.id]
  );
  logger.info(`🔴 [NFC] Sessione CHIUSA table_id=${tableId} (session_id=${act.id})`);
  return { closed: 1, session_id: act.id };
}
async function ensureSession(tableId, { ttlHours = 6, by } = {}) {
  const act = await getActiveSession(tableId);
  if (act) {
    if (!ttlHours) return act.id;
    const ageMs = Date.now() - new Date(act.opened_at).getTime();
    if (ageMs <= ttlHours * 3_600_000) return act.id;
    await closeActiveSession(tableId, { by: 'ensureSession:ttl' });
  }
  return await openSession(tableId, { by });
}

// ------------------------------ resolve --------------------------------------
async function resolveToken(token) {
  if (!token) throw new Error('token mancante');

  // 1) esiste in nfc_tags (non revocato)?
  const tag = (await query(
    `SELECT id, table_id
       FROM ${TABLE}
      WHERE token = ? AND is_revoked = 0
      LIMIT 1`,
    [token]
  ))?.[0];

  logger.info('🔎 [NFC] resolve.check', { token, found: !!tag, table_id: tag?.table_id });

  if (!tag) return null;                      // ← 404 not_found_or_revoked

  // 2) meta tavolo (JOIN) — usa table_number
  const meta = (await query(
    `SELECT t.table_number, t.room_id, r.name AS room_name
       FROM tables t
  LEFT JOIN rooms  r ON r.id = t.room_id
      WHERE t.id = ?
      LIMIT 1`,
    [tag.table_id]
  ))?.[0] || {};

  // 3) prenotazione odierna
  const resv = (await query(
    `SELECT id FROM reservations
      WHERE table_id = ?
        AND status IN ('pending','accepted')
        AND start_at >= UTC_DATE()
        AND start_at <  (UTC_DATE() + INTERVAL 1 DAY)
      ORDER BY start_at ASC
      LIMIT 1`,
    [tag.table_id]
  ))?.[0] || null;

  // 4) assicura sessione
  const session_id = await ensureSession(tag.table_id, { ttlHours: 6, by: 'nfc/resolve' });

  return {
    ok: true,
    table_id: tag.table_id,
    table_number: meta.table_number ?? null,
    room_id: meta.room_id ?? null,
    room_name: meta.room_name ?? null,
    reservation_id: resv?.id ?? null,
    session_id,
  };
}

// ------------------------------ cart snapshot --------------------------------
async function getSessionCart(sessionId) {
  if (!sessionId) throw new Error('session_id mancante');
  const s = (await query(
    `SELECT id, closed_at, cart_json, cart_version, cart_updated_at
       FROM ${TABLE_TS}
      WHERE id=? LIMIT 1`,
    [sessionId]
  ))?.[0];
  if (!s) return null;
  return {
    id: s.id,
    is_open: !s.closed_at,
    version: Number(s.cart_version || 0),
    cart_json: s.cart_json || null,
    cart_updated_at: s.cart_updated_at || null,
  };
}
async function saveSessionCart(sessionId, version, cartObj) {
  if (!sessionId) throw new Error('session_id mancante');
  const cartJson = cartObj ? JSON.stringify(cartObj) : null;
  const res = await query(
    `UPDATE ${TABLE_TS}
        SET cart_json = ?, cart_version = cart_version + 1, cart_updated_at = NOW()
      WHERE id = ? AND closed_at IS NULL AND cart_version = ?`,
    [cartJson, sessionId, Number(version || 0)]
  );
  if (Number(res?.affectedRows || 0) === 1) {
    const cur = await getSessionCart(sessionId);
    return { ok: true, version: cur?.version ?? 0, updated_at: cur?.cart_updated_at ?? null };
  }
  const current = await getSessionCart(sessionId);
  const err = new Error('version_conflict');
  err.status = 409;
  err.current = current;
  throw err;
}

// ------------------------------- exports -------------------------------------
module.exports = {
  // Token
  generateToken,
  getActiveByTable,
  bindTable,
  revokeToken,
  resolveToken,
  buildPublicUrl,
  // Sessione
  getActiveSession,
  openSession,
  closeActiveSession,
  ensureSession,
  // Cart
  getSessionCart,
  saveSessionCart,
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
