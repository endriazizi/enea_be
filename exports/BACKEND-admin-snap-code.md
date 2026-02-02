# 🧩 Project code (file ammessi in .)

_Generato: Mon, Feb  2, 2026  1:27:24 PM_

### ./docs/canvas-backend.md
```
# Canvas — Backend Node.js + Express (La Lanterna / Comodissimo)
Stato, regole e roadmap del backend ordini + prenotazioni + NFC + stampa.

---

## 🧱 Stack & setup

- **Runtime**: Node.js 22.x
- **Framework**: Express
- **Database**: MySQL / MariaDB (mysql2)
- **Migrazioni**: file SQL numerati `001_*.sql`, `002_*.sql`, ecc.
- **Socket**: Socket.IO server (singleton)
- **Logging**: winston + daily rotate, log con emoji dove utile
- **Stampa**: ESC/POS via TCP 9100 (Sunmi/Epson), senza simbolo `€` per ora
- **CORS**: configurato via `.env` (es. `CORS_ORIGIN=http://localhost:8100`)

---

## 📂 Struttura directory (semplificata)

- `server/src/server.js` — bootstrap principale Express + Socket.IO
- `server/src/env.js` — gestione variabili ambiente
- `server/src/logger.js` — logger configurato
- `server/src/db/`
  - `index.js` — pool MySQL (multipleStatements: true)
  - `migrator.js` — applicazione migrations
  - `migrations/001_schema.sql` — ordini base
  - `migrations/002_seed.sql` — prodotti seed
  - `migrations/003_reservations.sql` — tavoli/prenotazioni
  - `migrations/004_add_is_active_to_products.sql` — colonna is_active
  - `migrations/005_rooms.sql`, `006_tables_room_fk.sql` — rooms + FK tables
- `server/src/api/`
  - `orders.js` — gestione ordini
  - `reservations.js` — prenotazioni
  - `tables.js` — tavoli
  - `nfc-session.js` — sessioni NFC
  - (future) `printer.js` — salute e comandi stampante
- `server/src/sockets/`
  - `index.js` — init singleton Socket.IO
  - `orders.js` — canale ordini
  - `reservations.js` — canale prenotazioni
  - `nfc-session.js` — canale NFC (separato o integrato)

---

## 🧾 Modello dati principale

### Tabella `products`
- Prodotti con `is_active` (per nascondere senza cancellare)
- Usata da FE (PWA clienti / Admin) per mostrare menu

### Tabelle `orders` e `order_items`
- `orders`:
  - id, customer_name, phone, email
  - people, scheduled_at
  - status: `pending | preparing | ready | completed | cancelled`
  - total (ricalcolato lato server)
  - channel: `admin | kiosk | pwa | phone` ecc.
  - table_id (FK tables)
  - meta tavolo/sala: join con `tables` e `rooms`
  - created_at, updated_at
- `order_items`:
  - order_id (FK)
  - name
  - qty (può essere **negativo** per correzioni)
  - price_unit
  - total_line (qty * price_unit)
  - meta JSON per ingredienti/base/extra

### Tabelle `rooms`, `tables`
- `rooms`: sale (interno, esterno, ecc.)
- `tables`:
  - id, room_id (FK rooms)
  - table_number
  - seats
  - status: `free | occupied | cleaning | blocked`

### Tabelle `reservations`
- Gestione prenotazioni con:
  - cliente, contatti
  - data/ora inizio + end_at (calcolato)
  - numero persone
  - stato: `pending | confirmed | cancelled | no-show | completed`
  - eventuale table_id assegnato

### NFC / Sessioni (design)
- Tabella dedicata o colonna su ordine/tavolo per session_id (per ora best effort)
- Endpoint per legare session_id ↔ tavolo ↔ ordine

---

## ✔️ Endpoints chiave

### `/api/orders`

- `GET /api/orders`
  - Filtri:
    - `hours`, `from`, `to`, `status`, `q`, `table_id`
  - Se `table_id` presente → restituisce ordini “full” con righe e meta tavolo/sala
- `GET /api/orders/:id`
  - Dettaglio ordine completo
  - Include:
    - ordine
    - items
    - meta tavolo (room/table)
    - meta prenotazione se presente
- `GET /api/orders/:id/batches`
  - Storico mandate T1/T2/T3 (order_batches + snapshot righe)
- `GET /api/orders/active-by-session`
  - Restituisce ordine attivo per `session_id` NFC (best effort + backfill)
- `POST /api/orders`
  - Crea ordine
  - Ricalcola sempre `total` lato server
  - Valorizza `table_id` se fornito
  - Se presente `session_id` → lega alla sessione NFC
- `POST /api/orders/:id/items`
  - Aggiunge righe ad ordine esistente
  - Supporta qty negative per **correzioni**
  - Ricalcola total ordine dopo insert
- `PUT /api/orders/:id/status`
  - Aggiorna stato ordine (es. `pending → preparing → ready → completed`)
  - Triggera evento Socket.IO `order-updated`

---

### `/api/reservations`

- `GET /api/reservations`
  - Filtri: `from`, `to`, `status`, ecc.
- `GET /api/reservations/:id`
  - Dettaglio prenotazione (cliente, orario, persone, note, tavolo)
- `POST /api/reservations`
  - Crea prenotazione (admin o canale esterno)
  - Calcola `end_at` (es. durata default 90min)
  - (Roadmap) controlli overlap
- `PUT /api/reservations/:id/status`
  - Cambia stato (pending/confirmed/cancelled/no-show/completed)
- `PUT /api/reservations/:id/table`
  - Assegna/aggiorna tavolo
- (Futuro) `GET /api/reservations/availability`
  - Calcola disponibilità tavoli per intervallo orario

---

### `/api/tables`

- `GET /api/tables`
  - Lista tavoli con room_name, table_number, status
  - (Opzione) include conteggio ordini attivi
- `POST /api/tables/:id/clear`
  - Pulisce tavolo:
    - marca tavolo come `free`
    - chiude eventuale ordine attivo (o lo marca `completed` se già pagato)
    - chiude sessione NFC collegata (se esiste)

---

### `/api/nfc-session`

- `POST /api/nfc-session`
  - Crea/aggiorna sessione per un tag NFC
- `GET /api/nfc-session/:id/active-order`
  - Restituisce ordine attivo per quella sessione
- `PUT /api/nfc-session/:id/close`
  - Chiude esplicitamente la sessione (usata quando tavolo viene pulito)

---

### `/api/printer` (roadmap)

- `GET /api/printer/health`
  - Verifica raggiungibilità stampante (TCP 9100)
- `POST /api/printer/print-order`
  - Stampa comanda cucina
- `POST /api/printer/print-receipt`
  - Stampa preconto (NO `€` per ora per compatibilità codepage)
- `POST /api/printer/print-placeholders`
  - Stampa segnaposto/tavolo

---

## ✔️ Stato attuale (BE) — cosa consideriamo già fatto

- ✅ Pool MySQL con `multipleStatements: true`
- ✅ Migrazioni 001–006 applicate (orders, reservations, rooms/tables + FKs, products.is_active)
- ✅ `/api/orders` stabilizzato:
  - Fix CONCAT con `CHAR(63)` nei LIKE per evitare conflitti con `?`
  - Ritorno `{ ...order, items }` corretto in GET by id
- ✅ `/api/reservations` base funzionante
- ✅ `/api/health/time` (o similare) per diagnostica fusi orari (da verificare naming finale)
- ✅ Socket.IO:
  - Singleton con log connessione/disconnessione
  - Canali base per orders (e predisposizione per reservations)
- ✅ Integrazione con PWA admin:
  - tables-list + order-builder agganciati alle API

---

## 🔥 To-Do prioritari (BE)

1. **Overlap prenotazioni**
   - Su `POST /api/reservations`:
     - Calcolare `end_at` lato server
     - Rifiutare prenotazioni che si sovrappongono sullo stesso tavolo
   - Opzionale: endpoint `/api/reservations/availability`

2. **Chiusura tavolo+sessione robusta**
   - Garantire che `tables/:id/clear`:
     - chiuda sessione NFC collegata (`nfc-session/:id/close`)
     - aggiorni correttamente stato ordine (se ancora attivo)

3. **Socket reservations**
   - Implementare canale Socket.IO `reservations`:
     - Eventi `reservation-created` e `reservation-updated`
     - Esportare helper per emitirli da `api/reservations.js`

4. **Endpoint /api/printer/health**
   - Ping TCP verso stampante
   - Gestire timeout/ECONNREFUSED con errori puliti (502, messaggi chiari)
   - Log con emoji (es. `🖨️`)

5. **TimeZone policy**
   - DB e API in UTC
   - FE converte in Europe/Rome
   - `/api/health/time` mostra:
     - ora server
     - ora DB
     - time_zone impostata

---

## ⭐️ Backlog BE

- Audit `print_jobs` in DB (storico stampe, retry, stato)
- Endpoint reporting base (incassi, numero coperti, ecc.)
- Integrazione futura con gateway fiscale / RT (AdE)
- Endpoint helper per Twilio WhatsApp (callback/status log)

---

## 📝 Note operative per ChatGPT (in VS Code)

- Prima di cambiare endpoint:
  - Rileggere questo file `docs/canvas-backend.md`
- Quando si chiede una patch:
  - Specificare chiaramente il file:
    - es. `src/api/orders.js`, `src/api/reservations.js`, `src/sockets/index.js`
  - Mantenere:
    - Stile log (emoji)
    - Struttura commenti esistenti
    - Migrazioni numerate incrementalmente (`007_*.sql`, `008_*.sql`, ecc.)
```

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
        "@ngrok/ngrok": "1.7.0",
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
    "overrides": {},
    "description": "Eliminare node_modules (progetto corrente)\r rmdir /s /q node_modules",
    "directories": {
        "doc": "docs"
    },
    "keywords": [],
    "author": "",
    "license": "ISC"
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

### ./src/api/centralino.js
```
// src/api/centralino.js
// ============================================================================
// Centralino → apertura /asporto con prefill caller
// - GET /api/centralino/call?key=...&callerid=...&remark=...
// - Se remark == "tasto1" → redirect a /asporto con query precompilata
// ============================================================================
'use strict';

const express = require('express');
const router = express.Router();

module.exports = (app) => {
  const db = app?.get('db') || require('../db');
  const log = app?.get('logger') || console;
  const env = require('../env');

  async function q(sql, params = []) {
    const res = await db.query(sql, params);
    return (Array.isArray(res) && Array.isArray(res[0])) ? res[0] : res;
  }

  const normDigits = (v) => String(v || '').replace(/\D+/g, '');

  function isTasto1(raw) {
    const s = String(raw || '').trim().toLowerCase();
    return s === 'tasto1' || s === 'tasto 1' || s === 'tasto_1';
  }

  async function lookupCustomerByPhone(phoneRaw) {
    const digits = normDigits(phoneRaw);
    if (!digits) return null;
    const like = `%${digits}`;
    const rows = await q(
      `SELECT id, full_name, first_name, last_name, phone
       FROM users
       WHERE REPLACE(REPLACE(REPLACE(COALESCE(phone,''),' ',''),'+',''),'-','') LIKE ?
       ORDER BY id DESC
       LIMIT 1`,
      [like],
    );
    const r = rows && rows[0] ? rows[0] : null;
    if (!r) return null;
    const full =
      (r.full_name || '').trim() ||
      `${r.first_name || ''} ${r.last_name || ''}`.trim();
    return {
      id: r.id,
      full_name: full || null,
      first_name: r.first_name || null,
      last_name: r.last_name || null,
      phone: r.phone || phoneRaw || null,
    };
  }

  router.get('/call', async (req, res) => {
    const key = String(req.query.key || '');
    if (!env.CENTRALINO_KEY || key !== env.CENTRALINO_KEY) {
      return res.status(403).json({ ok: false, error: 'invalid_key' });
    }

    const callerid = String(req.query.callerid || '');
    const remark = String(req.query.remark || '');
    const remark2 = String(req.query.remark2 || '');
    const remark3 = String(req.query.remark3 || '');
    const calledid = String(req.query.calledid || '');
    const uniqueid = String(req.query.uniqueid || '');

    log.info('📞 [Centralino] call', {
      callerid,
      calledid,
      uniqueid,
      remark,
      remark2,
      remark3,
    });

    if (!isTasto1(remark)) {
      return res.json({ ok: true, action: 'ignore' });
    }

    let customer = null;
    try {
      customer = await lookupCustomerByPhone(callerid);
    } catch (e) {
      log.warn('⚠️ [Centralino] lookup KO', { error: String(e) });
    }

    const base =
      (env.CENTRALINO_REDIRECT_BASE || '').trim() ||
      `${req.protocol}://${req.get('host')}`;

    const params = new URLSearchParams();
    if (callerid) params.set('callerid', callerid);
    if (customer?.full_name) params.set('customer_name', customer.full_name);
    if (customer?.first_name) params.set('customer_first', customer.first_name);
    if (customer?.last_name) params.set('customer_last', customer.last_name);

    const url = `${base}/asporto?${params.toString()}`;
    return res.redirect(302, url);
  });

  // Optional: lookup JSON (per FE)
  router.get('/lookup', async (req, res) => {
    const key = String(req.query.key || '');
    if (!env.CENTRALINO_KEY || key !== env.CENTRALINO_KEY) {
      return res.status(403).json({ ok: false, error: 'invalid_key' });
    }
    const callerid = String(req.query.callerid || '');
    const customer = await lookupCustomerByPhone(callerid);
    res.json({ ok: true, callerid, customer });
  });

  return router;
};
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

  // ---- MARKETING CONSENTS (Gift Vouchers) ---------------------------------
  router.get('/marketing-consents', async (req, res) => {
    try {
      const from = req.query.from ? String(req.query.from) : null; // YYYY-MM-DD
      const to   = req.query.to ? String(req.query.to) : null;
      const status = String(req.query.status || 'all').toLowerCase();

      const conds = [];
      const params = [];
      if (from) { conds.push('DATE(c.created_at) >= DATE(?)'); params.push(from); }
      if (to)   { conds.push('DATE(c.created_at) <= DATE(?)'); params.push(to); }
      if (status === 'opted_in')  conds.push("o.status = 'confirmed'");
      if (status === 'pending')   conds.push("o.status = 'pending'");
      if (status === 'opted_out') conds.push('c.opt_out_at IS NOT NULL');

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await q(
        `SELECT
           c.id AS contact_id,
           c.customer_first,
           c.customer_last,
           c.phone,
           c.email,
           c.city,
           c.birthday,
           c.consent_marketing,
           c.source_tag,
           c.utm_source,
           c.utm_medium,
           c.utm_campaign,
           c.created_at,
           c.opt_out_at,
           c.opt_out_channel,
           v.code AS voucher_code,
           v.value_cents,
           v.valid_until,
           v.status AS voucher_status,
           o.status AS optin_status,
           o.requested_at AS optin_requested_at,
           o.confirmed_at AS optin_confirmed_at
         FROM gift_voucher_contacts c
         LEFT JOIN gift_vouchers v ON v.id = c.voucher_id
         LEFT JOIN gift_voucher_optins o
           ON o.id = (
             SELECT id FROM gift_voucher_optins
             WHERE contact_id = c.id
             ORDER BY requested_at DESC
             LIMIT 1
           )
         ${where}
         ORDER BY c.id DESC
         LIMIT 500`,
        params,
      );

      res.json(rows || []);
    } catch (e) {
      log.error('❌ /api/customers marketing-consents', { error: String(e) });
      res.status(500).json({ ok:false, error: 'marketing_consents_error' });
    }
  });

  // ---- EXPORT CSV ---------------------------------------------------------
  router.get('/marketing-consents/export', async (req, res) => {
    try {
      const from = req.query.from ? String(req.query.from) : null;
      const to   = req.query.to ? String(req.query.to) : null;
      const status = String(req.query.status || 'all').toLowerCase();

      const conds = [];
      const params = [];
      if (from) { conds.push('DATE(c.created_at) >= DATE(?)'); params.push(from); }
      if (to)   { conds.push('DATE(c.created_at) <= DATE(?)'); params.push(to); }
      if (status === 'opted_in')  conds.push("o.status = 'confirmed'");
      if (status === 'pending')   conds.push("o.status = 'pending'");
      if (status === 'opted_out') conds.push('c.opt_out_at IS NOT NULL');

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await q(
        `SELECT
           c.id AS contact_id,
           c.customer_first,
           c.customer_last,
           c.phone,
           c.email,
           c.city,
           c.birthday,
           c.consent_marketing,
           c.source_tag,
           c.utm_source,
           c.utm_medium,
           c.utm_campaign,
           c.created_at,
           c.opt_out_at,
           c.opt_out_channel,
           v.code AS voucher_code,
           v.value_cents,
           v.valid_until,
           v.status AS voucher_status,
           o.status AS optin_status,
           o.requested_at AS optin_requested_at,
           o.confirmed_at AS optin_confirmed_at
         FROM gift_voucher_contacts c
         LEFT JOIN gift_vouchers v ON v.id = c.voucher_id
         LEFT JOIN gift_voucher_optins o
           ON o.id = (
             SELECT id FROM gift_voucher_optins
             WHERE contact_id = c.id
             ORDER BY requested_at DESC
             LIMIT 1
           )
         ${where}
         ORDER BY c.id DESC
         LIMIT 2000`,
        params,
      );

      const esc = (v) => {
        const s = (v == null) ? '' : String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const header = [
        'contact_id','customer_first','customer_last','phone','email','city','birthday',
        'consent_marketing','source_tag','utm_source','utm_medium','utm_campaign','created_at',
        'opt_out_at','opt_out_channel','voucher_code','value_cents','valid_until','voucher_status',
        'optin_status','optin_requested_at','optin_confirmed_at'
      ].join(',');

      const lines = (rows || []).map((r) => ([
        r.contact_id, r.customer_first, r.customer_last, r.phone, r.email, r.city, r.birthday,
        r.consent_marketing, r.source_tag, r.utm_source, r.utm_medium, r.utm_campaign, r.created_at,
        r.opt_out_at, r.opt_out_channel, r.voucher_code, r.value_cents, r.valid_until, r.voucher_status,
        r.optin_status, r.optin_requested_at, r.optin_confirmed_at
      ].map(esc).join(',')));

      const csv = [header, ...lines].join('\n');
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="marketing-consents.csv"');
      res.send(csv);
    } catch (e) {
      log.error('❌ /api/customers marketing-consents export', { error: String(e) });
      res.status(500).json({ ok:false, error: 'marketing_consents_export_error' });
    }
  });

  // 🔧 sanity ping
  router.get('/_debug/ping', (_req, res) => {
    res.set('x-route', 'customers:debug');
    res.json({ ok: true, who: 'customers-router' });
  });

  // -------------------------------------------------------------------------
  // MARKETING CONSENTS (Gift Voucher)
  // GET /api/customers/marketing-consents?from=&to=&status=&q=
  // -------------------------------------------------------------------------
  router.get('/marketing-consents', async (req, res) => {
    try {
      const from = req.query.from ? new Date(String(req.query.from)) : null;
      const to   = req.query.to ? new Date(String(req.query.to)) : null;
      const status = String(req.query.status || 'all').toLowerCase();
      const qRaw = String(req.query.q || '').trim().toLowerCase();

      const conds = [];
      const params = [];

      if (from) { conds.push('c.created_at >= ?'); params.push(from); }
      if (to)   { conds.push('c.created_at <= ?'); params.push(to); }

      if (status === 'pending') {
        conds.push("oi.status = 'pending'");
      } else if (status === 'opted_in') {
        conds.push("oi.status = 'confirmed'");
      } else if (status === 'opted_out') {
        conds.push('c.opt_out_at IS NOT NULL');
      }

      if (qRaw) {
        conds.push(`(
          LOWER(c.customer_first) LIKE ?
          OR LOWER(c.customer_last) LIKE ?
          OR LOWER(c.email) LIKE ?
          OR REPLACE(REPLACE(REPLACE(COALESCE(c.phone,''),' ',''),'+',''),'-','') LIKE ?
        )`);
        const like = `%${qRaw}%`;
        params.push(like, like, like, qRaw.replace(/\s+/g, ''));
      }

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await q(
        `SELECT
           c.id AS contact_id,
           c.customer_first,
           c.customer_last,
           c.phone,
           c.email,
           c.city,
           c.birthday,
           c.consent_marketing,
           c.source_tag,
           c.utm_source,
           c.utm_medium,
           c.utm_campaign,
           c.created_at,
           c.opt_out_at,
           c.opt_out_channel,
           c.voucher_code,
           gv.value_cents,
           gv.valid_until,
           gv.status AS voucher_status,
           oi.status AS optin_status,
           oi.requested_at AS optin_requested_at,
           oi.confirmed_at AS optin_confirmed_at
         FROM gift_voucher_contacts c
         LEFT JOIN gift_vouchers gv ON gv.id = c.voucher_id
         LEFT JOIN (
           SELECT t1.*
           FROM gift_voucher_optins t1
           INNER JOIN (
             SELECT contact_id, MAX(id) AS max_id
             FROM gift_voucher_optins
             GROUP BY contact_id
           ) t2 ON t1.id = t2.max_id
         ) oi ON oi.contact_id = c.id
         ${where}
         ORDER BY c.created_at DESC
         LIMIT 2000`,
        params,
      );

      res.json(rows || []);
    } catch (e) {
      log.error('❌ /api/customers/marketing-consents', { error: String(e) });
      res.status(500).json([]);
    }
  });

  // -------------------------------------------------------------------------
  // MARKETING CONSENTS EXPORT (CSV)
  // GET /api/customers/marketing-consents/export?from=&to=&status=&q=
  // -------------------------------------------------------------------------
  router.get('/marketing-consents/export', async (req, res) => {
    try {
      const from = req.query.from ? new Date(String(req.query.from)) : null;
      const to   = req.query.to ? new Date(String(req.query.to)) : null;
      const status = String(req.query.status || 'all').toLowerCase();
      const qRaw = String(req.query.q || '').trim().toLowerCase();

      const conds = [];
      const params = [];
      if (from) { conds.push('c.created_at >= ?'); params.push(from); }
      if (to)   { conds.push('c.created_at <= ?'); params.push(to); }
      if (status === 'pending') conds.push("oi.status = 'pending'");
      else if (status === 'opted_in') conds.push("oi.status = 'confirmed'");
      else if (status === 'opted_out') conds.push('c.opt_out_at IS NOT NULL');

      if (qRaw) {
        conds.push(`(
          LOWER(c.customer_first) LIKE ?
          OR LOWER(c.customer_last) LIKE ?
          OR LOWER(c.email) LIKE ?
          OR REPLACE(REPLACE(REPLACE(COALESCE(c.phone,''),' ',''),'+',''),'-','') LIKE ?
        )`);
        const like = `%${qRaw}%`;
        params.push(like, like, like, qRaw.replace(/\s+/g, ''));
      }

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await q(
        `SELECT
           c.customer_first,
           c.customer_last,
           c.phone,
           c.email,
           c.city,
           c.birthday,
           c.consent_marketing,
           c.source_tag,
           c.utm_source,
           c.utm_medium,
           c.utm_campaign,
           c.created_at,
           c.opt_out_at,
           c.opt_out_channel,
           c.voucher_code,
           gv.value_cents,
           gv.valid_until,
           gv.status AS voucher_status,
           oi.status AS optin_status,
           oi.requested_at AS optin_requested_at,
           oi.confirmed_at AS optin_confirmed_at
         FROM gift_voucher_contacts c
         LEFT JOIN gift_vouchers gv ON gv.id = c.voucher_id
         LEFT JOIN (
           SELECT t1.*
           FROM gift_voucher_optins t1
           INNER JOIN (
             SELECT contact_id, MAX(id) AS max_id
             FROM gift_voucher_optins
             GROUP BY contact_id
           ) t2 ON t1.id = t2.max_id
         ) oi ON oi.contact_id = c.id
         ${where}
         ORDER BY c.created_at DESC`,
        params,
      );

      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = [
        'customer_first','customer_last','phone','email','city','birthday',
        'consent_marketing','source_tag','utm_source','utm_medium','utm_campaign',
        'created_at','opt_out_at','opt_out_channel',
        'voucher_code','value_cents','valid_until','voucher_status',
        'optin_status','optin_requested_at','optin_confirmed_at'
      ].join(',');
      const lines = (rows || []).map((r) => [
        r.customer_first, r.customer_last, r.phone, r.email, r.city, r.birthday,
        r.consent_marketing, r.source_tag, r.utm_source, r.utm_medium, r.utm_campaign,
        r.created_at, r.opt_out_at, r.opt_out_channel,
        r.voucher_code, r.value_cents, r.valid_until, r.voucher_status,
        r.optin_status, r.optin_requested_at, r.optin_confirmed_at
      ].map(esc).join(','));

      const csv = [header, ...lines].join('\n');
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="marketing-consents.csv"');
      res.send(csv);
    } catch (e) {
      log.error('❌ /api/customers/marketing-consents/export', { error: String(e) });
      res.status(500).send('error');
    }
  });

  return router;
};
```

### ./src/api/gift-vouchers.js
```
// ============================================================================
// /api/gift-vouchers — CRUD + stampa buoni regalo
// - Stile progetto: commenti lunghi 🇮🇹 + log con emoji
// - Update solo se status=active (e non scaduto)
// - Delete soft → status=void
// - Print → ESC/POS + audit (success/fail)
// ============================================================================

'use strict';

const express = require('express');
const router  = express.Router();

const logger = require('../logger');
const { printGiftVoucherSlip, buildQrText } = require('../services/gift-voucher-printer.service');

module.exports = (app) => {
  const db  = app?.get('db') || require('../db');
  const log = app?.get('logger') || logger;

  // Normalizza risultato db.query():
  async function q(sql, params = []) {
    const res = await db.query(sql, params);
    return (Array.isArray(res) && Array.isArray(res[0])) ? res[0] : res;
  }

  const toNum = (v, def = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const toDate = (v) => (v ? new Date(v) : null);

  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function generateCode(len = 8) {
    let out = '';
    for (let i = 0; i < len; i += 1) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
  }

  function mapRow(r) {
    if (!r) return null;
    return {
      id           : r.id,
      code         : r.code,
      value_cents  : Number(r.value_cents || 0),
      event_title  : r.event_title,
      description  : r.description || null,
      valid_from   : r.valid_from,
      valid_until  : r.valid_until,
      status       : r.status,
      status_db    : r.status_db || r.status,
      redeemed_at  : r.redeemed_at || null,
      redeemed_note: r.redeemed_note || null,
      created_at   : r.created_at,
      updated_at   : r.updated_at || null,
      qr_text      : r.qr_text || null,
    };
  }

  // =========================================================================
  // GET /api/gift-vouchers?status=&q=&from=&to=
  // =========================================================================
  router.get('/', async (req, res) => {
    try {
      const { status, q: qRaw, from, to } = req.query || {};
      const qStr = String(qRaw || '').trim();
      const conds = [];
      const params = [];

      if (from) {
        conds.push('gv.created_at >= ?');
        params.push(toDate(from));
      }
      if (to) {
        conds.push('gv.created_at <= ?');
        params.push(toDate(to));
      }

      const statusStr = String(status || '').toLowerCase();
      if (statusStr && statusStr !== 'all') {
        if (statusStr === 'expired') {
          conds.push(`gv.status = 'active' AND gv.valid_until < UTC_TIMESTAMP()`);
        } else if (statusStr === 'active') {
          conds.push(`gv.status = 'active' AND gv.valid_until >= UTC_TIMESTAMP()`);
        } else {
          conds.push('gv.status = ?');
          params.push(statusStr);
        }
      }

      if (qStr) {
        conds.push(`(
          gv.code LIKE ?
          OR gv.event_title LIKE ?
          OR gv.description LIKE ?
        )`);
        const like = `%${qStr}%`;
        params.push(like, like, like);
      }

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await q(
        `SELECT
           gv.*,
           gv.status AS status_db,
           CASE
             WHEN gv.status = 'active' AND gv.valid_until < UTC_TIMESTAMP() THEN 'expired'
             ELSE gv.status
           END AS status
         FROM gift_vouchers gv
         ${where}
         ORDER BY gv.id DESC
         LIMIT 500`,
        params,
      );

      const out = (rows || []).map(mapRow);
      log.info('🎁 [GiftVouchers] list', { count: out.length, status: statusStr || 'all', q: qStr || null });
      res.json(out);
    } catch (e) {
      log.error('🎁 gift-vouchers list ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'gift_vouchers_list_error' });
    }
  });

  // =========================================================================
  // GET /api/gift-vouchers/:id
  // =========================================================================
  router.get('/:id(\\d+)', async (req, res) => {
    try {
      const id = toNum(req.params.id);
      const rows = await q(
        `SELECT
           gv.*,
           gv.status AS status_db,
           CASE
             WHEN gv.status = 'active' AND gv.valid_until < UTC_TIMESTAMP() THEN 'expired'
             ELSE gv.status
           END AS status
         FROM gift_vouchers gv
         WHERE gv.id = ?
         LIMIT 1`,
        [id],
      );
      const row = rows && rows[0] ? rows[0] : null;
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });

      const qrText = buildQrText(row.code);
      res.json(mapRow({ ...row, qr_text: qrText }));
    } catch (e) {
      log.error('🎁 gift-vouchers get ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'gift_vouchers_get_error' });
    }
  });

  // =========================================================================
  // POST /api/gift-vouchers
  // =========================================================================
  router.post('/', async (req, res) => {
    const dto = req.body || {};
    try {
      const valueCents = toNum(dto.value_cents || dto.valueCents);
      if (!valueCents || valueCents <= 0) {
        return res.status(400).json({ ok: false, error: 'value_cents_invalid' });
      }
      const eventTitle = String(dto.event_title || '').trim();
      if (!eventTitle) {
        return res.status(400).json({ ok: false, error: 'event_title_required' });
      }
      const validUntil = dto.valid_until ? toDate(dto.valid_until) : null;
      if (!validUntil || isNaN(validUntil.getTime())) {
        return res.status(400).json({ ok: false, error: 'valid_until_required' });
      }
      const validFrom = dto.valid_from ? toDate(dto.valid_from) : null;

      let insertedId = null;
      let code = null;

      for (let i = 0; i < 5; i += 1) {
        code = generateCode(8);
        try {
          const r = await q(
            `INSERT INTO gift_vouchers (
               code,
               value_cents,
               event_title,
               description,
               valid_from,
               valid_until,
               status,
               created_at,
               updated_at
             ) VALUES (?,?,?,?,IFNULL(?, UTC_TIMESTAMP()),?,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
            [
              code,
              valueCents,
              eventTitle,
              dto.description || null,
              validFrom,
              validUntil,
            ],
          );
          insertedId = r?.insertId;
          break;
        } catch (e) {
          if (String(e?.code || '').toLowerCase() === 'er_dup_entry') {
            log.warn('🎁 [GiftVouchers] code collision, retry', { attempt: i + 1 });
            continue;
          }
          throw e;
        }
      }

      if (!insertedId) {
        return res.status(500).json({ ok: false, error: 'code_generation_failed' });
      }

      const rows = await q(
        `SELECT
           gv.*,
           gv.status AS status_db,
           gv.status AS status
         FROM gift_vouchers gv
         WHERE gv.id = ?
         LIMIT 1`,
        [insertedId],
      );
      log.info('🎁 [GiftVouchers] create OK', { id: insertedId, code });
      res.status(201).json(mapRow(rows[0]));
    } catch (e) {
      log.error('🎁 gift-vouchers create ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'gift_vouchers_create_error' });
    }
  });

  // =========================================================================
  // PUT /api/gift-vouchers/:id  (solo active + non scaduto)
  // =========================================================================
  router.put('/:id(\\d+)', async (req, res) => {
    const id = toNum(req.params.id);
    const dto = req.body || {};
    try {
      const rows = await q(
        `SELECT
           id, status, valid_until
         FROM gift_vouchers
         WHERE id = ?
         LIMIT 1`,
        [id],
      );
      const existing = rows && rows[0] ? rows[0] : null;
      if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });

      const isExpired = existing.status === 'active' && new Date(existing.valid_until) < new Date();
      if (existing.status !== 'active' || isExpired) {
        return res.status(409).json({ ok: false, error: 'voucher_not_editable' });
      }

      const valueCents = dto.value_cents != null || dto.valueCents != null
        ? toNum(dto.value_cents || dto.valueCents)
        : null;
      if (valueCents != null && valueCents <= 0) {
        return res.status(400).json({ ok: false, error: 'value_cents_invalid' });
      }

      const eventTitle = dto.event_title != null ? String(dto.event_title || '').trim() : null;
      if (eventTitle !== null && !eventTitle) {
        return res.status(400).json({ ok: false, error: 'event_title_required' });
      }

      const validUntil = dto.valid_until ? toDate(dto.valid_until) : null;
      if (dto.valid_until && (!validUntil || isNaN(validUntil.getTime()))) {
        return res.status(400).json({ ok: false, error: 'valid_until_required' });
      }

      const validFrom = dto.valid_from ? toDate(dto.valid_from) : null;

      await q(
        `UPDATE gift_vouchers SET
           value_cents = COALESCE(?, value_cents),
           event_title = COALESCE(?, event_title),
           description = COALESCE(?, description),
           valid_from  = COALESCE(?, valid_from),
           valid_until = COALESCE(?, valid_until),
           updated_at  = UTC_TIMESTAMP()
         WHERE id = ?`,
        [
          valueCents,
          eventTitle,
          dto.description != null ? dto.description : null,
          validFrom,
          validUntil,
          id,
        ],
      );

      const outRows = await q(
        `SELECT
           gv.*,
           gv.status AS status_db,
           CASE
             WHEN gv.status = 'active' AND gv.valid_until < UTC_TIMESTAMP() THEN 'expired'
             ELSE gv.status
           END AS status
         FROM gift_vouchers gv
         WHERE gv.id = ?
         LIMIT 1`,
        [id],
      );

      log.info('🎁 [GiftVouchers] update OK', { id });
      res.json(mapRow(outRows[0]));
    } catch (e) {
      log.error('🎁 gift-vouchers update ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'gift_vouchers_update_error' });
    }
  });

  // =========================================================================
  // DELETE /api/gift-vouchers/:id  (soft delete → status=void)
  // =========================================================================
  router.delete('/:id(\\d+)', async (req, res) => {
    const id = toNum(req.params.id);
    try {
      const rows = await q('SELECT id, status FROM gift_vouchers WHERE id = ? LIMIT 1', [id]);
      const row = rows && rows[0] ? rows[0] : null;
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });

      await q(
        `UPDATE gift_vouchers
           SET status = 'void', updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [id],
      );

      log.warn('🎁 [GiftVouchers] void OK', { id });
      res.json({ ok: true });
    } catch (e) {
      log.error('🎁 gift-vouchers void ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'gift_vouchers_void_error' });
    }
  });

  // =========================================================================
  // POST /api/gift-vouchers/:id/print
  // =========================================================================
  router.post('/:id(\\d+)/print', async (req, res) => {
    const id = toNum(req.params.id);
    const userEmail =
      (req.user && (req.user.email || req.user.username || req.user.id)) ||
      (req.body && req.body.user_email) ||
      null;
    let printerIp = null;
    let printerPort = null;
    let qrText = null;

    try {
      const rows = await q('SELECT * FROM gift_vouchers WHERE id = ? LIMIT 1', [id]);
      const voucher = rows && rows[0] ? rows[0] : null;
      if (!voucher) return res.status(404).json({ ok: false, error: 'not_found' });

      qrText = buildQrText(voucher.code);

      try {
        const out = await printGiftVoucherSlip({ voucher, qrText });
        printerIp = out?.printer?.ip || null;
        printerPort = out?.printer?.port || null;

        await q(
          `INSERT INTO gift_voucher_print_jobs
            (voucher_id, status, error, printer_ip, printer_port, qr_text, created_by)
           VALUES (?,?,?,?,?,?,?)`,
          [id, 'success', null, printerIp, printerPort, qrText, userEmail],
        );

        log.info('🧾 [GiftVouchers] print OK', { id });
        return res.json({ ok: true });
      } catch (e) {
        const reason = String((e && e.message) || e);
        await q(
          `INSERT INTO gift_voucher_print_jobs
            (voucher_id, status, error, printer_ip, printer_port, qr_text, created_by)
           VALUES (?,?,?,?,?,?,?)`,
          [id, 'failed', reason, printerIp, printerPort, qrText, userEmail],
        );

        log.warn('🧾 [GiftVouchers] print KO', { id, error: reason });
        return res.status(502).json({ ok: false, error: 'printer_error', reason });
      }
    } catch (e) {
      log.error('🧾 gift-vouchers print ❌', { error: String(e) });
      return res.status(500).json({ ok: false, error: 'gift_vouchers_print_error' });
    }
  });

  // =========================================================================
  // (opzionale) POST /api/gift-vouchers/:id/redeem
  // =========================================================================
  router.post('/:id(\\d+)/redeem', async (req, res) => {
    const id = toNum(req.params.id);
    const note = req.body?.note || null;
    try {
      const rows = await q('SELECT id, status FROM gift_vouchers WHERE id = ? LIMIT 1', [id]);
      const row = rows && rows[0] ? rows[0] : null;
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      if (row.status !== 'active') {
        return res.status(409).json({ ok: false, error: 'voucher_not_redeemable' });
      }

      await q(
        `UPDATE gift_vouchers
           SET status = 'redeemed',
               redeemed_at = UTC_TIMESTAMP(),
               redeemed_note = ?,
               updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [note, id],
      );

      const outRows = await q(
        `SELECT
           gv.*,
           gv.status AS status_db,
           gv.status AS status
         FROM gift_vouchers gv
         WHERE gv.id = ?
         LIMIT 1`,
        [id],
      );
      log.info('🎁 [GiftVouchers] redeem OK', { id });
      res.json(mapRow(outRows[0]));
    } catch (e) {
      log.error('🎁 gift-vouchers redeem ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'gift_vouchers_redeem_error' });
    }
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
// body: { displayName?, givenName?, familyName?, email?, phone?, note? }
router.post('/create', express.json(), async (req, res) => {
  const { displayName, givenName, familyName, email, phone, note } = req.body || {};

  try {
    const out = await createContact({ displayName, givenName, familyName, email, phone, note });
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
const { query } = require('../db');

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

// 🆕 POST /api/nfc/session/open { table_id, by? } → { ok:true, session_id }
router.post('/session/open', async (req, res) => {
  try {
    const table_id = Number(req.body?.table_id || 0);
    const by = (req.body?.by || 'api/nfc/session/open').toString();
    if (!table_id) return res.status(400).json({ ok: false, error: 'table_id mancante' });

    // use ensureSession to respect TTL logic and avoid duplicate open rows
    const session_id = await NFC.ensureSession(table_id, { by, ttlHours: 6 });

    logger.info(`🟢 [API] open session table_id=${table_id} → session_id=${session_id}`);

    // Broadcast new session (best-effort)
    try {
      const io = getIO(req);
      if (io && session_id) io.emit('nfc:session_opened', { table_id, session_id });
    } catch (e) {
      logger.warn('⚠️ [API] nfc session open broadcast KO', { error: String(e) });
    }

    res.json({ ok: true, session_id });
  } catch (err) {
    logger.error('❌ [API] /nfc/session/open', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

module.exports = router;

// -------------------------- Table state endpoints -------------------------
// POST /api/nfc/table/:tableId/disable  -> { ok:true }
// POST /api/nfc/table/:tableId/enable   -> { ok:true }
// GET  /api/nfc/table-states            -> [{ table_id, enabled, updated_at }, ...]

router.post('/table/:tableId/disable', async (req, res) => {
  try {
    const tableId = Number(req.params.tableId || 0) || 0;
    logger.info(`🔔 [API] /nfc/table/${tableId}/disable called`, { service: 'server', tableId });
    if (!tableId) return res.status(400).json({ ok: false, error: 'tableId missing' });

    // upsert into nfc_table_state
    await query(
      `INSERT INTO nfc_table_state (table_id, enabled, updated_at) VALUES (?, 0, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE enabled=0, updated_at=UTC_TIMESTAMP()`,
      [tableId],
    );

    // close active session if any
    try {
      await NFC.closeActiveSession(tableId, { by: 'api:nfc/table/disable' });
    } catch (e) {
      logger.warn('⚠️ [NFC] closeActiveSession during disable failed', { tableId, error: String(e) });
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error('❌ [API] /nfc/table/:id/disable', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

router.post('/table/:tableId/enable', async (req, res) => {
  try {
    const tableId = Number(req.params.tableId || 0) || 0;
    logger.info(`🔔 [API] /nfc/table/${tableId}/enable called`, { service: 'server', tableId });
    if (!tableId) return res.status(400).json({ ok: false, error: 'tableId missing' });

    await query(
      `INSERT INTO nfc_table_state (table_id, enabled, updated_at) VALUES (?, 1, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE enabled=1, updated_at=UTC_TIMESTAMP()`,
      [tableId],
    );

    res.json({ ok: true });
  } catch (err) {
    logger.error('❌ [API] /nfc/table/:id/enable', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

router.get('/table-states', async (req, res) => {
  try {
    const rows = await query('SELECT table_id, enabled, updated_at FROM nfc_table_state');
    res.json(rows || []);
  } catch (err) {
    logger.error('❌ [API] /nfc/table-states', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});
```

### ./src/api/nfc-session.js
```
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
// ---------------------------------------------------------------------------
// GET /api/nfc/session/last-order?session_id=123
// ---------------------------------------------------------------------------
// Ultimo ordine associato alla sessione (se table_sessions.last_order_id è
// valorizzato). Implementazione originale tua, ripresa e aggiustata solo
// togliendo le colonne che NON esistono in "orders" (reservation_id, room_id).
// ---------------------------------------------------------------------------
router.get('/last-order', async (req, res) => {
  const log = req.app.get('logger');
  try {
    const sessionId = Number(req.query.session_id || 0) || 0;
    if (!sessionId) {
      return res
        .status(400)
        .json({ ok: false, error: 'session_id_required' });
    }

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

    // 2) header + total aggregato (SOLO colonne esistenti in "orders")
    const rows2 = await query(
      `
      SELECT
        o.id,
        o.status,
        o.customer_name,
        o.phone,
        o.note,
        o.people,
        o.channel,
        o.table_id,
        o.scheduled_at,
        o.created_at,
        o.updated_at,
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

    return res.json({
      ok      : true,
      hasOrder: true,
      order   : { ...order, items },
    });
  } catch (e) {
    req.app
      .get('logger')
      ?.error?.('💥 [NFC] /session/last-order failed', { error: String(e) });
    return res.status(500).json({ ok: false, error: 'last_order_failed' });
  }
});

module.exports = router;
```

### ./src/api/notifications.js
```
'use strict';

/**
 * api/notifications.js
 * -----------------------------------------------------------------------------
 * Rotte notifiche: Email + WhatsApp (Twilio)
 *
 * ✅ Nota importante WhatsApp:
 * - Free-text (body) è consentito SOLO dentro la finestra 24h (sessione).
 * - Fuori 24h devi usare un TEMPLATE approvato.
 * - Qui aggiungiamo:
 *    1) POST /wa/send                       -> free-text (bloccato fuori 24h se abilitato)
 *    2) POST /wa/template/reservation-confirm -> invio TEMPLATE Quick Reply (apre finestra 24h)
 *    3) POST /wa/inbound                    -> webhook Twilio inbound (tap bottoni / reply)
 *    4) POST /wa/status                     -> status callback Twilio (delivered/failed ecc.)
 *
 * Stile: log emoji + best-effort + non rompiamo le logiche esistenti.
 */

const express = require('express');
const router = express.Router();

const logger = require('../logger');
const env    = require('../env');

const mailer = require('../services/mailer.service');
const wa     = require('../services/whatsapp.service');

// Prenotazioni (per aggiornare stato da tap WhatsApp)
const reservationsSvc     = require('../services/reservations.service');
const reservationsActions = require('../services/reservations-status.service');

// ----------------------------------------------------------------------------
// Auth middleware (fallback DEV se non disponibile)
// ----------------------------------------------------------------------------
let requireAuth = (req, res, next) => next();
try {
  // eslint-disable-next-line global-require
  ({ requireAuth } = require('../middleware/auth'));
  logger.info('🔐 requireAuth caricato da ../middleware/auth', { service: 'server' });
} catch (e) {
  logger.warn('⚠️ requireAuth NON trovato (DEV bypass).', { service: 'server', error: String(e) });
}

// ----------------------------------------------------------------------------
// safeRoute helper (stile tuo)
// ----------------------------------------------------------------------------
function safeRoute(name, fn) {
  return async (req, res) => {
    try {
      const out = await fn(req, res);
      return out;
    } catch (e) {
      logger.error(`❌ notifications.${name} crash`, { service: 'server', error: String(e) });
      return res.status(500).json({ ok: false, error: String(e) });
    }
  };
}

// ----------------------------------------------------------------------------
// HEALTH
// ----------------------------------------------------------------------------
router.get('/health', safeRoute('health', async (req, res) => {
  return res.json({
    ok: true,
    mail: {
      enabled: !!env.MAIL?.enabled,
      host: env.MAIL?.smtpHost ? '[set]' : '',
    },
    wa: wa.health ? wa.health() : { note: 'wa.health() missing' }
  });
}));

// ----------------------------------------------------------------------------
// MAIL TEST (protetta)
// ----------------------------------------------------------------------------
router.post('/mail/test', requireAuth, safeRoute('mail.test', async (req, res) => {
  const to = req.body?.to || env.MAIL?.replyTo || env.MAIL?.from || null;
  if (!to) return res.status(400).json({ ok: false, error: 'missing_to' });

  const out = await mailer.sendTestEmail?.({ to }) // se esiste
    .catch(() => null);

  if (!out) {
    // fallback minimale: invio “status change” finto
    await mailer.sendStatusChangeEmail?.({
      to,
      reservation: { id: 0, start_at: new Date().toISOString(), party_size: 2 },
      status: 'TEST',
      reason: 'Email test'
    });
  }

  return res.json({ ok: true });
}));

// ----------------------------------------------------------------------------
// WA FREE TEXT (protetta) - dentro finestra 24h (se blocco attivo)
// ----------------------------------------------------------------------------
router.post('/wa/send', requireAuth, safeRoute('wa.send', async (req, res) => {
  const to       = req.body?.to || null;
  const text     = req.body?.text || req.body?.body || null;
  const mediaUrl = req.body?.mediaUrl ?? null;

  // Se vuoi forzare invio anche fuori finestra (sconsigliato): allowOutsideWindow=true
  const allowOutsideWindow = !!req.body?.allowOutsideWindow;

  const out = await wa.sendText({
    to,
    text,
    mediaUrl,
    allowOutsideWindow
  });

  return res.json(out);
}));

// ----------------------------------------------------------------------------
// WA TEMPLATE: prenotazione conferma (protetta)
// ----------------------------------------------------------------------------
router.post('/wa/template/reservation-confirm', requireAuth, safeRoute('wa.template.reservationConfirm', async (req, res) => {
  const to           = req.body?.to || null;
  const name         = req.body?.name || null;
  const dateStr      = req.body?.dateStr || req.body?.date || null;   // es "mercoledì 21/01/2026"
  const timeStr      = req.body?.timeStr || req.body?.time || null;   // es "20:30"
  const peopleStr    = req.body?.peopleStr || req.body?.people || req.body?.partySize || null;
  const reservationId = req.body?.reservationId || null;

  const out = await wa.sendReservationConfirmTemplate({
    to,
    name,
    dateStr,
    timeStr,
    peopleStr,
    reservationId
  });

  return res.json(out);
}));

// ----------------------------------------------------------------------------
// WEBHOOK Twilio INBOUND (PUBBLICA)
// ⚠️ Twilio manda x-www-form-urlencoded: usiamo express.urlencoded solo su questa route
// ----------------------------------------------------------------------------
router.post('/wa/inbound',
  express.urlencoded({ extended: false }),
  safeRoute('wa.inbound', async (req, res) => {
    const out = await wa.handleInboundWebhook(req.body || {});

    // ✅ Se riconosciamo un tap su template collegato a reservationId -> aggiorniamo stato
    if (out?.action && out?.reservationId) {
      const id = Number(out.reservationId);
      const action = String(out.action);

      logger.info('🧩 WA tap -> aggiorno prenotazione', { service: 'server', id, action });

      // Mapping azioni:
      // - confirm -> accepted
      // - cancel  -> cancelled
      const mappedAction = (action === 'confirm') ? 'accept' : (action === 'cancel' ? 'cancel' : null);

      if (mappedAction) {
        await reservationsActions.updateStatus({
          id,
          action: mappedAction,
          reason: `WA tap: ${action}`,
          user_email: 'wa:webhook'
        });

        // Ricarico la prenotazione “bella” (per broadcast + notify)
        const reservation = await reservationsSvc.getById(id).catch(() => null);

        if (reservation) {
          // Best-effort notify (email + WA status change)
          try {
            if (reservation.contact_email) {
              await mailer.sendStatusChangeEmail?.({
                to: reservation.contact_email,
                reservation,
                status: reservation.status,
                reason: `Confermato da WhatsApp (${action})`
              });
            }
          } catch (e) {
            logger.warn('⚠️ Email status change fallita (ok)', { service: 'server', error: String(e) });
          }

          try {
            if (reservation.contact_phone) {
              await wa.sendStatusChange({
                to: reservation.contact_phone,
                reservation,
                status: reservation.status,
                reason: `Confermato da WhatsApp (${action})`
              });
            }
          } catch (e) {
            logger.warn('⚠️ WA status change fallito (ok)', { service: 'server', error: String(e) });
          }

          // Broadcast realtime (se io è disponibile)
          try {
            const io = req.app?.get('io');
            if (io) {
              io.to('admins').emit('reservation-updated', reservation);
              logger.info('📡 Socket reservation-updated', { service: 'server', id: reservation.id });
            }
          } catch (e) {
            logger.warn('⚠️ Socket broadcast fallito (ok)', { service: 'server', error: String(e) });
          }
        }
      }
    }

    // ✅ Risposta “safe” per Twilio (va bene anche 200 vuoto, ma così è pulito)
    res.set('Content-Type', 'text/xml');
    return res.status(200).send('<Response></Response>');
  })
);

// ----------------------------------------------------------------------------
// STATUS CALLBACK Twilio (PUBBLICA)
// ----------------------------------------------------------------------------
router.post('/wa/status',
  express.urlencoded({ extended: false }),
  safeRoute('wa.status', async (req, res) => {
    const messageSid    = req.body?.MessageSid || null;
    const messageStatus = req.body?.MessageStatus || null;
    const errorCode     = req.body?.ErrorCode || null;
    const errorMessage  = req.body?.ErrorMessage || null;

    await wa.updateWaMessageStatus?.(messageSid, messageStatus, errorCode, errorMessage, req.body);

    res.set('Content-Type', 'text/xml');
    return res.status(200).send('<Response></Response>');
  })
);

module.exports = router;
```

### ./src/api/orders.js
```
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
 * 🔁 Normalizza la modalità ordine (fulfillment)
 * ---------------------------------------------------------------------------
 * Accetta valori legacy o varianti FE/BE:
 * - fulfillment / order_type / orderType / serviceType
 * - IT/EN: "table/tavolo", "takeaway/asporto", "delivery/domicilio"
 */
function normalizeFulfillment(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'table' || v === 'tavolo') return 'table';
  if (v === 'takeaway' || v === 'asporto' || v === 'take-away') return 'takeaway';
  if (v === 'delivery' || v === 'domicilio') return 'delivery';
  return null;
}

// ============================================================================
// 🆕 Impostazioni pubbliche /asporto (DB)
// ============================================================================

const PUBLIC_ASPORTO_DEFAULTS = {
  enable_public_asporto      : true,
  public_whatsapp_to         : '0737642142',
  asporto_start_time         : '07:00',
  asporto_step_minutes       : 15,
  asporto_end_time           : '23:00',
  asporto_lead_minutes       : 20,
  whatsapp_show_prices       : true,
  public_asporto_allow_takeaway: true,
  public_asporto_allow_delivery: false,
};

function normalizePublicAsportoSettings(raw) {
  const src = raw || {};
  const enable = typeof src.enable_public_asporto === 'boolean'
    ? src.enable_public_asporto
    : !!Number(src.enable_public_asporto ?? PUBLIC_ASPORTO_DEFAULTS.enable_public_asporto);
  const allowTakeaway = typeof src.public_asporto_allow_takeaway === 'boolean'
    ? src.public_asporto_allow_takeaway
    : !!Number(src.public_asporto_allow_takeaway ?? PUBLIC_ASPORTO_DEFAULTS.public_asporto_allow_takeaway);
  const allowDelivery = typeof src.public_asporto_allow_delivery === 'boolean'
    ? src.public_asporto_allow_delivery
    : !!Number(src.public_asporto_allow_delivery ?? PUBLIC_ASPORTO_DEFAULTS.public_asporto_allow_delivery);
  const showPrices = typeof src.whatsapp_show_prices === 'boolean'
    ? src.whatsapp_show_prices
    : !!Number(src.whatsapp_show_prices ?? PUBLIC_ASPORTO_DEFAULTS.whatsapp_show_prices);

  const publicWhatsapp = String(
    src.public_whatsapp_to ?? PUBLIC_ASPORTO_DEFAULTS.public_whatsapp_to,
  ).trim() || PUBLIC_ASPORTO_DEFAULTS.public_whatsapp_to;

  const start = String(
    src.asporto_start_time ?? PUBLIC_ASPORTO_DEFAULTS.asporto_start_time,
  ).trim() || PUBLIC_ASPORTO_DEFAULTS.asporto_start_time;

  const end = String(
    src.asporto_end_time ?? PUBLIC_ASPORTO_DEFAULTS.asporto_end_time,
  ).trim() || PUBLIC_ASPORTO_DEFAULTS.asporto_end_time;

  const stepNum = Number(
    src.asporto_step_minutes ?? PUBLIC_ASPORTO_DEFAULTS.asporto_step_minutes,
  );
  const step = Number.isFinite(stepNum) && stepNum > 0
    ? stepNum
    : PUBLIC_ASPORTO_DEFAULTS.asporto_step_minutes;
  const leadNum = Number(
    src.asporto_lead_minutes ?? PUBLIC_ASPORTO_DEFAULTS.asporto_lead_minutes,
  );
  const lead = Number.isFinite(leadNum) && leadNum >= 0
    ? leadNum
    : PUBLIC_ASPORTO_DEFAULTS.asporto_lead_minutes;

  return {
    enable_public_asporto: enable,
    public_whatsapp_to: publicWhatsapp,
    asporto_start_time: start,
    asporto_step_minutes: step,
    asporto_end_time: end,
    asporto_lead_minutes: lead,
    whatsapp_show_prices: showPrices,
    public_asporto_allow_takeaway: allowTakeaway,
    public_asporto_allow_delivery: allowDelivery,
  };
}

async function getPublicAsportoSettings() {
  try {
    const rows = await query(
      `SELECT
         enable_public_asporto,
         public_whatsapp_to,
         asporto_start_time,
         asporto_step_minutes,
         asporto_end_time,
         asporto_lead_minutes,
         whatsapp_show_prices,
         public_asporto_allow_takeaway,
         public_asporto_allow_delivery
       FROM public_asporto_settings
       ORDER BY id ASC
       LIMIT 1`,
    );
    const raw = rows && rows[0] ? rows[0] : null;
    return normalizePublicAsportoSettings(raw || PUBLIC_ASPORTO_DEFAULTS);
  } catch (e) {
    logger.warn('⚠️ public_asporto_settings load KO', { error: String(e) });
    return normalizePublicAsportoSettings(PUBLIC_ASPORTO_DEFAULTS);
  }
}

async function savePublicAsportoSettings(next) {
  const p = normalizePublicAsportoSettings(next);
  await query(
    `INSERT INTO public_asporto_settings (
       id,
       enable_public_asporto,
       public_whatsapp_to,
       asporto_start_time,
       asporto_step_minutes,
       asporto_end_time,
       asporto_lead_minutes,
       whatsapp_show_prices,
       public_asporto_allow_takeaway,
       public_asporto_allow_delivery
     ) VALUES (
       1, ?, ?, ?, ?, ?, ?, ?, ?, ?
     )
     ON DUPLICATE KEY UPDATE
       enable_public_asporto = VALUES(enable_public_asporto),
       public_whatsapp_to = VALUES(public_whatsapp_to),
       asporto_start_time = VALUES(asporto_start_time),
       asporto_step_minutes = VALUES(asporto_step_minutes),
       asporto_end_time = VALUES(asporto_end_time),
       asporto_lead_minutes = VALUES(asporto_lead_minutes),
       whatsapp_show_prices = VALUES(whatsapp_show_prices),
       public_asporto_allow_takeaway = VALUES(public_asporto_allow_takeaway),
       public_asporto_allow_delivery = VALUES(public_asporto_allow_delivery)`,
    [
      p.enable_public_asporto ? 1 : 0,
      p.public_whatsapp_to,
      p.asporto_start_time,
      p.asporto_step_minutes,
      p.asporto_end_time,
      p.asporto_lead_minutes,
      p.whatsapp_show_prices ? 1 : 0,
      p.public_asporto_allow_takeaway ? 1 : 0,
      p.public_asporto_allow_delivery ? 1 : 0,
    ],
  );
  return p;
}

// ============================================================================
// 🆕 Visibilità categorie per contesto (DB)
// ============================================================================

const CATEGORY_CONTEXTS = ['order_new', 'asporto', 'domicilio'];

function normalizeCategoryList(raw) {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const cleaned = Array.from(
    new Set(
      raw
        .map((x) => String(x || '').trim())
        .filter(Boolean),
    ),
  );
  return cleaned;
}

function normalizeCategoryVisibilityMap(input) {
  const out = {};
  for (const ctx of CATEGORY_CONTEXTS) {
    out[ctx] = null;
  }
  if (!input || typeof input !== 'object') return out;
  for (const ctx of CATEGORY_CONTEXTS) {
    if (Object.prototype.hasOwnProperty.call(input, ctx)) {
      out[ctx] = normalizeCategoryList(input[ctx]);
    }
  }
  return out;
}

async function getCategoryVisibilityMap() {
  try {
    const rows = await query(
      `SELECT context, categories_json
       FROM order_category_visibility`,
    );
    const map = normalizeCategoryVisibilityMap({});
    for (const r of rows || []) {
      const ctx = String(r.context || '').trim();
      if (!CATEGORY_CONTEXTS.includes(ctx)) continue;
      if (r.categories_json == null) {
        map[ctx] = null;
        continue;
      }
      try {
        const parsed = JSON.parse(String(r.categories_json || ''));
        map[ctx] = normalizeCategoryList(parsed);
      } catch {
        map[ctx] = null;
      }
    }
    return map;
  } catch (e) {
    logger.warn('⚠️ category_visibility load KO', { error: String(e) });
    return normalizeCategoryVisibilityMap({});
  }
}

async function saveCategoryVisibilityContext(context, categories) {
  const ctx = String(context || '').trim();
  if (!CATEGORY_CONTEXTS.includes(ctx)) {
    throw new Error('invalid_context');
  }
  const list = normalizeCategoryList(categories);
  const payload = list == null ? null : JSON.stringify(list);
  await query(
    `INSERT INTO order_category_visibility (context, categories_json)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE categories_json = VALUES(categories_json)`,
    [ctx, payload],
  );
  return { context: ctx, categories: list };
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
       o.fulfillment,
       o.table_id,    -- colonna aggiunta da 007_add_table_id_to_orders.sql
       o.delivery_name,
       o.delivery_phone,
       o.delivery_address,
       o.delivery_note,
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
    fulfillment : o.fulfillment || (resolvedTableId ? 'table' : 'takeaway'),
    table_id    : resolvedTableId,
    table_number: meta.table ? meta.table.number : null,
    table_name  : meta.table ? meta.table.label  : null,
    room_id     : meta.room ? meta.room.id       : null,
    room_name   : meta.room ? meta.room.name     : null,
    delivery_name   : o.delivery_name || null,
    delivery_phone  : o.delivery_phone || null,
    delivery_address: o.delivery_address || null,
    delivery_note   : o.delivery_note || null,
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
         o.fulfillment,
         o.table_id,
         o.delivery_name,
         o.delivery_phone,
         o.delivery_address,
         o.delivery_note,
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

    // === fulfillment + delivery_* ==========================================
    const fulfillmentRaw =
      dto.fulfillment ||
      dto.order_type ||
      dto.orderType ||
      dto.serviceType ||
      null;
    let fulfillment = normalizeFulfillment(fulfillmentRaw);

    const deliveryName =
      dto.delivery_name ||
      dto.deliveryName ||
      null;
    const deliveryPhone =
      dto.delivery_phone ||
      dto.deliveryPhone ||
      null;
    const deliveryAddress =
      dto.delivery_address ||
      dto.deliveryAddress ||
      null;
    const deliveryNote =
      dto.delivery_note ||
      dto.deliveryNote ||
      null;

    // fallback compat: se non specificato, inferisco
    if (!fulfillment) {
      fulfillment = tableIdFinal ? 'table' : 'takeaway';
    }

    // Validazioni minime (senza rompere i client legacy)
    if (fulfillment === 'table' && !tableIdFinal) {
      return res.status(400).json({
        ok   : false,
        error: 'table_id_required_for_fulfillment_table',
      });
    }
    if (fulfillment === 'delivery') {
      if (!deliveryAddress) {
        return res.status(400).json({
          ok   : false,
          error: 'delivery_address_required',
        });
      }
      if (!deliveryPhone && !phone) {
        return res.status(400).json({
          ok   : false,
          error: 'delivery_phone_or_phone_required',
        });
      }
    }

    const r = await query(
      `INSERT INTO orders (
         customer_name,
         phone,
         email,
         people,
         scheduled_at,
         fulfillment,
         table_id,
         delivery_name,
         delivery_phone,
         delivery_address,
         delivery_note,
         note,
         channel,
         status,
         total,
         customer_user_id
       )
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        (dto.customer_name || 'Cliente').toString().trim(),
        phone || null,
        email || null,
        dto.people || null,
        scheduled,
        fulfillment,
        tableIdFinal || null,
        deliveryName || null,
        deliveryPhone || phone || null,
        deliveryAddress || null,
        deliveryNote || null,
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
// /public-asporto-settings (GET pubblico, PUT protetto)
// ============================================================================

router.get('/public-asporto-settings', async (_req, res) => {
  try {
    const data = await getPublicAsportoSettings();
    res.set('Cache-Control', 'no-store');
    return res.json(data);
  } catch (e) {
    logger.error('⚠️ public_asporto_settings GET KO', { error: String(e) });
    return res.status(500).json({ ok: false, error: 'public_asporto_settings_get_error' });
  }
});

router.put('/public-asporto-settings', requireAuth, async (req, res) => {
  try {
    const next = await savePublicAsportoSettings(req.body || {});
    res.set('Cache-Control', 'no-store');
    return res.json(next);
  } catch (e) {
    logger.error('⚠️ public_asporto_settings PUT KO', { error: String(e) });
    return res.status(500).json({ ok: false, error: 'public_asporto_settings_put_error' });
  }
});

// ============================================================================
// /category-visibility (GET pubblico, PUT protetto)
// ============================================================================

router.get('/category-visibility', async (_req, res) => {
  try {
    const map = await getCategoryVisibilityMap();
    res.set('Cache-Control', 'no-store');
    return res.json(map);
  } catch (e) {
    logger.error('⚠️ category_visibility GET KO', { error: String(e) });
    return res.status(500).json({ ok: false, error: 'category_visibility_get_error' });
  }
});

router.put('/category-visibility', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const context = body.context;
    const categories = body.categories;
    const saved = await saveCategoryVisibilityContext(context, categories);
    res.set('Cache-Control', 'no-store');
    return res.json(saved);
  } catch (e) {
    const code = String(e && e.message ? e.message : e);
    const status = code === 'invalid_context' ? 400 : 500;
    logger.error('⚠️ category_visibility PUT KO', { error: String(e) });
    return res.status(status).json({ ok: false, error: 'category_visibility_put_error' });
  }
});

// ============================================================================
// EXPORT
// ============================================================================

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

### ./src/api/public-voucher.js
```
// ============================================================================
// /api/public/voucher — attivazione buoni regalo (raccolta contatti marketing)
// - Endpoint: POST /api/public/voucher/activate
// - Stile: commenti 🇮🇹 + log con emoji
// ============================================================================

'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../logger');
const {
  sendActivationEmail,
  sendActivationSms,
  sendMarketingConfirmEmail,
  sendMarketingConfirmSms,
  sendMarketingConfirmWhatsapp,
  sendMarketingOptInEmail,
  sendMarketingOptInSms,
  sendMarketingOptInWhatsapp,
} = require('../services/voucher-notify.service');

module.exports = (app) => {
  const db  = app?.get('db') || require('../db');
  const log = app?.get('logger') || logger;

  async function q(sql, params = []) {
    const res = await db.query(sql, params);
    return (Array.isArray(res) && Array.isArray(res[0])) ? res[0] : res;
  }

  const toStr = (v) => (v == null ? '' : String(v).trim());
  const now = () => new Date();
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function generateCode(len = 8) {
    let out = '';
    for (let i = 0; i < len; i += 1) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Rate limit (best-effort): max 20 richieste / 10 minuti per IP
  // -------------------------------------------------------------------------
  const RATE_LIMIT_MAX = 20;
  const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
  const rateMap = new Map(); // ip -> timestamps[]
  const RATE_LIMIT_OPTOUT_MAX = 10;
  const rateMapOptout = new Map();

  function getIp(req) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
  }

  function checkRateLimit(req) {
    const ip = getIp(req);
    const nowTs = Date.now();
    const list = rateMap.get(ip) || [];
    const filtered = list.filter((t) => nowTs - t < RATE_LIMIT_WINDOW_MS);
    filtered.push(nowTs);
    rateMap.set(ip, filtered);
    return filtered.length <= RATE_LIMIT_MAX;
  }

  function checkRateLimitOptout(req) {
    const ip = getIp(req);
    const nowTs = Date.now();
    const list = rateMapOptout.get(ip) || [];
    const filtered = list.filter((t) => nowTs - t < RATE_LIMIT_WINDOW_MS);
    filtered.push(nowTs);
    rateMapOptout.set(ip, filtered);
    return filtered.length <= RATE_LIMIT_OPTOUT_MAX;
  }
  const toDateOnly = (v) => {
    if (!v) return null;
    const raw = String(v).trim();
    if (!raw) return null;
    // accetto YYYY-MM-DD oppure ISO completo → prendo solo la data
    if (raw.includes('T')) return raw.slice(0, 10);
    return raw.slice(0, 10);
  };

  // -------------------------------------------------------------------------
  // POST /api/public/voucher/activate
  // -------------------------------------------------------------------------
  router.post('/voucher/activate', async (req, res) => {
    const dto = req.body || {};
    try {
      if (!checkRateLimit(req)) {
        return res.status(429).json({ ok: false, error: 'rate_limited' });
      }

      const code = toStr(dto.code).toUpperCase();
      if (!code) return res.status(400).json({ ok: false, error: 'missing_code' });

      const customer_first = toStr(dto.customer_first);
      const customer_last  = toStr(dto.customer_last);
      const phone = toStr(dto.phone);
      const email = toStr(dto.email);
      const city  = toStr(dto.city);
      const notes = toStr(dto.notes);
      const birthday = toDateOnly(dto.birthday);
      const consent_marketing = !!dto.consent_marketing;
      const utm_source = toStr(dto.utm_source);
      const utm_medium = toStr(dto.utm_medium);
      const utm_campaign = toStr(dto.utm_campaign);
      const honeypot = toStr(dto.website || dto.company);
      if (honeypot) {
        log.warn('🧯 [VoucherPublic] honeypot hit', { ip: getIp(req) });
        return res.json({ ok: true, skipped: true });
      }
      const allowedSources = new Set([
        'gift_voucher_manual',
        'gift_voucher_whatsapp_web',
        'gift_voucher_whatsapp_api',
        'gift_voucher_whatsapp_business',
        'gift_voucher_instagram',
        'gift_voucher_facebook',
      ]);
      const source_tag_raw = toStr(dto.source_tag) || 'gift_voucher_manual';
      const source_tag = allowedSources.has(source_tag_raw) ? source_tag_raw : 'gift_voucher_manual';

      if (!customer_first || !customer_last) {
        return res.status(400).json({ ok: false, error: 'name_required' });
      }
      if (!city) {
        return res.status(400).json({ ok: false, error: 'city_required' });
      }
      if (!phone && !email) {
        return res.status(400).json({ ok: false, error: 'contact_required' });
      }

      // (1) Voucher esiste?
      const rows = await q(
        `SELECT id, code, status, valid_until
         FROM gift_vouchers
         WHERE code = ?
         LIMIT 1`,
        [code],
      );
      const v = rows && rows[0] ? rows[0] : null;
      if (!v) return res.status(404).json({ ok: false, error: 'voucher_not_found' });

      // (2) Stato voucher
      if (v.status === 'void') return res.status(409).json({ ok: false, error: 'voucher_void' });
      if (v.status === 'redeemed') return res.status(409).json({ ok: false, error: 'voucher_redeemed' });
      if (v.status === 'active' && new Date(v.valid_until) < new Date()) {
        return res.status(409).json({ ok: false, error: 'voucher_expired' });
      }

      // (3) Contatto già registrato?
      const existing = await q(
        'SELECT id FROM gift_voucher_contacts WHERE voucher_id = ? LIMIT 1',
        [v.id],
      );
      if (existing && existing[0]) {
        return res.status(409).json({ ok: false, error: 'voucher_already_activated' });
      }

      await q(
        `INSERT INTO gift_voucher_contacts (
           voucher_id,
           voucher_code,
           customer_first,
           customer_last,
           phone,
           email,
           city,
           birthday,
           notes,
           consent_marketing,
           source_tag,
           utm_source,
           utm_medium,
           utm_campaign,
           created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [
          v.id,
          v.code,
          customer_first,
          customer_last,
          phone || null,
          email || null,
          city,
          birthday,
          notes || null,
          0, // double opt-in: consenso attivo solo dopo conferma
          source_tag,
          utm_source || null,
          utm_medium || null,
          utm_campaign || null,
        ],
      );

      // Notifiche best-effort (email + SMS)
      try {
        if (email) await sendActivationEmail({ to: email, voucher: v, contact: { customer_first, customer_last } });
      } catch (e) {
        log.warn('📧 [VoucherPublic] email KO', { error: String(e?.message || e) });
      }
      try {
        if (phone) await sendActivationSms({ to: phone, voucher: v });
      } catch (e) {
        log.warn('📱 [VoucherPublic] sms KO', { error: String(e?.message || e) });
      }

      // Double opt-in: richiesta conferma (solo se consentito)
      if (consent_marketing) {
        let contactId = null;
        try {
          const rows = await q(
            'SELECT id FROM gift_voucher_contacts WHERE voucher_id = ? LIMIT 1',
            [v.id],
          );
          contactId = rows && rows[0] ? rows[0].id : null;
        } catch {}

        const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
        await q(
          `INSERT INTO gift_voucher_optins
            (contact_id, email, phone, token, status, requested_at, source_tag, utm_source, utm_medium, utm_campaign)
           VALUES (?,?,?,?, 'pending', UTC_TIMESTAMP(), ?, ?, ?, ?)`,
          [
            contactId,
            email || null,
            phone || null,
            token,
            source_tag,
            utm_source || null,
            utm_medium || null,
            utm_campaign || null,
          ],
        );

        try {
          if (email) await sendMarketingConfirmEmail({ to: email, contact: { customer_first, customer_last }, token });
        } catch (e) {
          log.warn('📧 [VoucherPublic] confirm email KO', { error: String(e?.message || e) });
        }
        try {
          if (phone && !email) await sendMarketingConfirmSms({ to: phone, token });
        } catch (e) {
          log.warn('📱 [VoucherPublic] confirm sms KO', { error: String(e?.message || e) });
        }
        try {
          if (phone && source_tag.startsWith('gift_voucher_whatsapp')) {
            await sendMarketingConfirmWhatsapp({ to: phone, token });
          }
        } catch (e) {
          log.warn('📲 [VoucherPublic] confirm wa KO', { error: String(e?.message || e) });
        }
      }

      log.info('🎁 [VoucherPublic] activation OK', { code, consent_marketing });
      res.json({ ok: true });
    } catch (e) {
      log.error('🎁 [VoucherPublic] activation ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'voucher_activate_error' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/public/promo-voucher
  // body: contatti + consensi + source_tag + utm
  // -------------------------------------------------------------------------
  router.post('/promo-voucher', async (req, res) => {
    const dto = req.body || {};
    try {
      if (!checkRateLimit(req)) {
        return res.status(429).json({ ok: false, error: 'rate_limited' });
      }
      const honeypot = toStr(dto.website || dto.company);
      if (honeypot) {
        log.warn('🧯 [PromoVoucher] honeypot hit', { ip: getIp(req) });
        return res.json({ ok: true, skipped: true });
      }

      const customer_first = toStr(dto.customer_first);
      const customer_last  = toStr(dto.customer_last);
      const phone = toStr(dto.phone);
      const email = toStr(dto.email);
      const city  = toStr(dto.city);
      const notes = toStr(dto.notes);
      const birthday = toDateOnly(dto.birthday);
      const consent_marketing = !!dto.consent_marketing;
      const consent_privacy = !!dto.consent_privacy;
      const utm_source = toStr(dto.utm_source);
      const utm_medium = toStr(dto.utm_medium);
      const utm_campaign = toStr(dto.utm_campaign);

      const allowedSources = new Set([
        'gift_voucher_manual',
        'gift_voucher_whatsapp_web',
        'gift_voucher_whatsapp_api',
        'gift_voucher_whatsapp_business',
        'gift_voucher_instagram',
        'gift_voucher_facebook',
      ]);
      const source_tag_raw = toStr(dto.source_tag) || 'gift_voucher_instagram';
      const source_tag = allowedSources.has(source_tag_raw) ? source_tag_raw : 'gift_voucher_manual';

      if (!customer_first || !customer_last) {
        return res.status(400).json({ ok: false, error: 'name_required' });
      }
      if (!city) {
        return res.status(400).json({ ok: false, error: 'city_required' });
      }
      if (!phone && !email) {
        return res.status(400).json({ ok: false, error: 'contact_required' });
      }
      if (!consent_privacy) {
        return res.status(400).json({ ok: false, error: 'privacy_required' });
      }

      // valori promo (configurabili)
      const PROMO_VALUE_CENTS = Math.max(100, Number(process.env.PROMO_VOUCHER_VALUE_CENTS || 1000));
      const PROMO_VALID_DAYS = Math.max(7, Number(process.env.PROMO_VOUCHER_VALID_DAYS || 30));
      const validUntil = new Date(now().getTime() + (PROMO_VALID_DAYS * 24 * 60 * 60 * 1000));

      let voucherId = null;
      let code = null;
      for (let i = 0; i < 5; i += 1) {
        code = generateCode(8);
        try {
          const r = await q(
            `INSERT INTO gift_vouchers (
               code,
               value_cents,
               event_title,
               description,
               valid_from,
               valid_until,
               status,
               created_at,
               updated_at
             ) VALUES (?,?,?,?,IFNULL(?, UTC_TIMESTAMP()),?,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
            [
              code,
              PROMO_VALUE_CENTS,
              'Promo Social',
              'Voucher promozionale social',
              null,
              validUntil,
            ],
          );
          voucherId = r?.insertId;
          break;
        } catch (e) {
          if (String(e?.code || '').toLowerCase() === 'er_dup_entry') continue;
          throw e;
        }
      }

      if (!voucherId) {
        return res.status(500).json({ ok: false, error: 'voucher_create_failed' });
      }

      await q(
        `INSERT INTO gift_voucher_contacts (
           voucher_id,
           voucher_code,
           customer_first,
           customer_last,
           phone,
           email,
           city,
           birthday,
           notes,
           consent_marketing,
           source_tag,
           utm_source,
           utm_medium,
           utm_campaign,
           created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [
          voucherId,
          code,
          customer_first,
          customer_last,
          phone || null,
          email || null,
          city,
          birthday,
          notes || null,
          0,
          source_tag,
          utm_source || null,
          utm_medium || null,
          utm_campaign || null,
        ],
      );

      // Notifiche best-effort (email + SMS)
      try {
        if (email) await sendActivationEmail({ to: email, voucher: { id: voucherId, value_cents: PROMO_VALUE_CENTS, valid_until: validUntil }, contact: { customer_first, customer_last } });
      } catch (e) {
        log.warn('📧 [PromoVoucher] email KO', { error: String(e?.message || e) });
      }
      try {
        if (phone) await sendActivationSms({ to: phone, voucher: { id: voucherId, value_cents: PROMO_VALUE_CENTS, valid_until: validUntil } });
      } catch (e) {
        log.warn('📱 [PromoVoucher] sms KO', { error: String(e?.message || e) });
      }

      // Double opt-in se richiesto
      if (consent_marketing) {
        let contactId = null;
        try {
          const rows = await q(
            'SELECT id FROM gift_voucher_contacts WHERE voucher_id = ? LIMIT 1',
            [voucherId],
          );
          contactId = rows && rows[0] ? rows[0].id : null;
        } catch {}

        const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
        await q(
          `INSERT INTO gift_voucher_optins
            (contact_id, email, phone, token, status, requested_at, source_tag, utm_source, utm_medium, utm_campaign)
           VALUES (?,?,?,?, 'pending', UTC_TIMESTAMP(), ?, ?, ?, ?)`,
          [
            contactId,
            email || null,
            phone || null,
            token,
            source_tag,
            utm_source || null,
            utm_medium || null,
            utm_campaign || null,
          ],
        );
        try {
          if (email) await sendMarketingConfirmEmail({ to: email, contact: { customer_first, customer_last }, token });
        } catch (e) {
          log.warn('📧 [PromoVoucher] confirm email KO', { error: String(e?.message || e) });
        }
        try {
          if (phone && !email) await sendMarketingConfirmSms({ to: phone, token });
        } catch (e) {
          log.warn('📱 [PromoVoucher] confirm sms KO', { error: String(e?.message || e) });
        }
        try {
          if (phone && source_tag.startsWith('gift_voucher_whatsapp')) {
            await sendMarketingConfirmWhatsapp({ to: phone, token });
          }
        } catch (e) {
          log.warn('📲 [PromoVoucher] confirm wa KO', { error: String(e?.message || e) });
        }
      }

      res.json({
        ok: true,
        voucher: {
          code,
          value_cents: PROMO_VALUE_CENTS,
          valid_until: validUntil,
        },
      });
    } catch (e) {
      log.error('🎁 [PromoVoucher] create ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'promo_voucher_error' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/public/voucher/:code  → summary (valore/scadenza/stato)
  // -------------------------------------------------------------------------
  router.get('/voucher/:code', async (req, res) => {
    try {
      const code = toStr(req.params.code).toUpperCase();
      if (!code) return res.status(400).json({ ok: false, error: 'missing_code' });
      const rows = await q(
        `SELECT
           gv.id,
           gv.code,
           gv.value_cents,
           gv.event_title,
           gv.valid_until,
           gv.status,
           CASE
             WHEN gv.status = 'active' AND gv.valid_until < UTC_TIMESTAMP() THEN 'expired'
             ELSE gv.status
           END AS status_view
         FROM gift_vouchers gv
         WHERE gv.code = ?
         LIMIT 1`,
        [code],
      );
      const v = rows && rows[0] ? rows[0] : null;
      if (!v) return res.status(404).json({ ok: false, error: 'voucher_not_found' });
      res.json({
        ok: true,
        voucher: {
          code: v.code,
          value_cents: Number(v.value_cents || 0),
          event_title: v.event_title,
          valid_until: v.valid_until,
          status: v.status_view || v.status,
        }
      });
    } catch (e) {
      log.error('🎁 [VoucherPublic] summary ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'voucher_summary_error' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/public/marketing/confirm?token=
  // -------------------------------------------------------------------------
  router.get('/marketing/confirm', async (req, res) => {
    try {
      const token = toStr(req.query.token);
      if (!token) return res.status(400).json({ ok: false, error: 'missing_token' });

      const rows = await q(
        `SELECT id, contact_id, email, phone, status
           , requested_at
           FROM gift_voucher_optins
          WHERE token = ?
          LIMIT 1`,
        [token],
      );
      const opt = rows && rows[0] ? rows[0] : null;
      if (!opt) return res.status(404).json({ ok: false, error: 'token_not_found' });
      if (opt.status === 'confirmed') return res.json({ ok: true, already: true });

      // Token scaduto (7 giorni)
      try {
        const requestedAt = opt.requested_at ? new Date(opt.requested_at) : null;
        if (requestedAt && (Date.now() - requestedAt.getTime()) > (7 * 24 * 60 * 60 * 1000)) {
          await q(
            `UPDATE gift_voucher_optins
                SET status = 'expired'
              WHERE id = ?`,
            [opt.id],
          );
          return res.status(410).json({ ok: false, error: 'token_expired' });
        }
      } catch {}

      await q(
        `UPDATE gift_voucher_optins
            SET status = 'confirmed',
                confirmed_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [opt.id],
      );

      if (opt.contact_id) {
        await q(
          `UPDATE gift_voucher_contacts
              SET consent_marketing = 1
            WHERE id = ?`,
          [opt.contact_id],
        );
      }

      // Dopo conferma invio messaggio di esito (best-effort)
      try {
        if (opt.email) await sendMarketingOptInEmail({ to: opt.email, contact: {} });
      } catch (e) {
        log.warn('📧 [VoucherPublic] marketing email KO', { error: String(e?.message || e) });
      }
      try {
        if (opt.phone) await sendMarketingOptInSms({ to: opt.phone });
      } catch (e) {
        log.warn('📱 [VoucherPublic] marketing sms KO', { error: String(e?.message || e) });
      }
      try {
        if (opt.phone) await sendMarketingOptInWhatsapp({ to: opt.phone });
      } catch (e) {
        log.warn('📲 [VoucherPublic] marketing wa KO', { error: String(e?.message || e) });
      }

      res.json({ ok: true });
    } catch (e) {
      log.error('🎁 [VoucherPublic] confirm ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'marketing_confirm_error' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/public/marketing/optout
  // body: { email?, phone?, channel?, reason? }
  // -------------------------------------------------------------------------
  router.post('/marketing/optout', async (req, res) => {
    try {
      if (!checkRateLimitOptout(req)) {
        return res.status(429).json({ ok: false, error: 'rate_limited' });
      }
      const email = toStr(req.body?.email);
      const phone = toStr(req.body?.phone);
      const channel = toStr(req.body?.channel) || 'unknown';
      const reason = toStr(req.body?.reason) || null;
      const honeypot = toStr(req.body?.company || req.body?.website);
      if (honeypot) {
        log.warn('🧯 [VoucherPublic] optout honeypot hit', { ip: getIp(req) });
        return res.json({ ok: true, skipped: true });
      }
      if (!email && !phone) {
        return res.status(400).json({ ok: false, error: 'missing_contact' });
      }

      const conds = [];
      const params = [];
      if (email) { conds.push('email = ?'); params.push(email); }
      if (phone) { conds.push('phone = ?'); params.push(phone); }

      const where = conds.length ? `WHERE ${conds.join(' OR ')}` : '';

      // (1) aggiorno contatto
      await q(
        `UPDATE gift_voucher_contacts
            SET consent_marketing = 0,
                opt_out_at = UTC_TIMESTAMP(),
                opt_out_channel = ?
          ${where}`,
        [channel, ...params],
      );

      // (2) log separato storico revoche
      let contactId = null;
      try {
        const rows = await q(
          `SELECT id FROM gift_voucher_contacts ${where} LIMIT 1`,
          params,
        );
        contactId = rows && rows[0] ? rows[0].id : null;
      } catch {}

      await q(
        `INSERT INTO gift_voucher_optouts
          (contact_id, email, phone, channel, reason, user_agent, ip_addr)
         VALUES (?,?,?,?,?,?,?)`,
        [
          contactId,
          email || null,
          phone || null,
          channel || null,
          reason || null,
          (req.get('user-agent') || null),
          (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null),
        ],
      );

      res.json({ ok: true });
    } catch (e) {
      log.error('🎁 [VoucherPublic] optout ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'marketing_optout_error' });
    }
  });

  return router;
};
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
'use strict';

/**
 * src/db/index.js
 * -----------------------------------------------------------------------------
 * Pool MySQL (mysql2/promise) + helper query.
 *
 * ✅ FIX:
 * - Leggiamo sempre da src/env.js (che ora carica anche il .env)
 * - Normalizziamo host "localhost" → "127.0.0.1" per evitare ::1 su Windows
 * - Logghiamo config “safe” (senza password)
 */

const mysql = require('mysql2/promise');
const env = require('../env');
const logger = require('./logger');

let _pool = null;

function normalizeHost(host) {
  const h = String(host || '').trim();
  if (!h) return '127.0.0.1';
  if (h.toLowerCase() === 'localhost') {
    // Windows spesso risolve localhost su ::1 (IPv6) e MySQL non ascolta lì
    return '127.0.0.1';
  }
  return h;
}

function getPool() {
  if (_pool) return _pool;

  const host = normalizeHost(env.DB.host);
  const port = env.DB.port || 3306;

  // fallback extra per non avere user/db vuoti (ti evitano log “db:'' user:''”)
  const user = (env.DB.user && String(env.DB.user).trim()) ? env.DB.user : 'root';
  const database = (env.DB.database && String(env.DB.database).trim()) ? env.DB.database : 'app';

  _pool = mysql.createPool({
    host,
    port,
    user,
    password: env.DB.password || '',
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true,

    // timeouts “umani”
    connectTimeout: 10_000,
  });

  logger.info('🗄️  DB Pool created', {
    service: 'server',
    host,
    port,
    db: database,
    user: user ? (String(user).slice(0, 2) + '…') : '',
    envFileLoaded: env._envFileLoaded || '(none)',
  });

  return _pool;
}

/**
 * Query helper
 * - Ritorna direttamente rows (come fai già in varie API)
 * - Logga SQL solo in caso di errore
 */
async function query(sql, params = []) {
  const pool = getPool();
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (err) {
    logger.error('🗄️  DB query ❌', {
      service: 'server',
      error: String(err && err.message ? err.message : err),
      sql: String(sql || '').slice(0, 2000),
    });
    throw err;
  }
}

module.exports = {
  getPool,
  query,
};
```

### ./src/db/logger.js
```
'use strict';

/**
 * src/db/logger.js
 * -----------------------------------------------------------------------------
 * Bridge semplice: i file in src/db/ possono continuare a fare:
 *   const logger = require('./logger');
 *
 * e noi reindirizziamo al logger vero in src/logger.js
 */

module.exports = require('../logger');```

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

    // 🆕 STEP 1 — modello clienti
    phone_normalized: { data_type: 'varchar',  nullable: 'YES' },
    phone_verified_at: { data_type: 'datetime', nullable: 'YES' },
    verification_channel: {
      data_type: 'enum',
      nullable: 'YES',
      column_type: "enum('otp_sms','otp_whatsapp','manual_call','other')",
    },
    trust_score: { data_type: 'tinyint', nullable: 'NO' },

    created_at: { data_type: 'timestamp', nullable: 'NO'  },
    updated_at: { data_type: 'timestamp', nullable: 'YES' },
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
 * src/env.js
 * -----------------------------------------------------------------------------
 * Loader centralizzato env + helper.
 *
 * 🔥 FIX IMPORTANTE:
 * - Prima ti funzionava perché caricavi il file .env (dotenv).
 * - Ora DB_USER/DB_NAME risultano vuoti ⇒ il pool prova 127.0.0.1:3306 e fallisce.
 *
 * ✅ Qui rimettiamo un loader robusto:
 * - prova .env, .env.development, .env.local, ecc.
 * - se non trova nulla, prova anche ".env copy" / ".env copy 2" (capita spesso su Windows)
 *
 * NOTE:
 * - Non uso logger qui (evito loop/circular dependency).
 * - Se dotenv non è installato, non crasha: userai solo le env di sistema.
 */

// ----------------------------------------------------------------------------
// 1) Provo a caricare dotenv (se presente) + scelgo un file env “sensato”
// ----------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';

function tryLoadDotEnv() {
  let dotenv;
  try {
    dotenv = require('dotenv');
  } catch (_) {
    // dotenv non installato → nessun crash
    return { loaded: false, file: '' };
  }

  const cwd = process.cwd();

  // ordine: più specifico → più generico
  const candidates = [
    `.env.${NODE_ENV}.local`,
    `.env.${NODE_ENV}`,
    `.env.local`,
    `.env`,
    // fallback “umani” (succede quando ci si salva .env con nome diverso)
    `.env copy`,
    `.env copy 2`,
    `env/.env`,
    `env/.env.${NODE_ENV}`,
  ];

  for (const name of candidates) {
    const full = path.join(cwd, name);
    try {
      if (fs.existsSync(full)) {
        dotenv.config({ path: full });
        return { loaded: true, file: full };
      }
    } catch (_) {}
  }

  return { loaded: false, file: '' };
}

const _dotenvInfo = tryLoadDotEnv();

// ----------------------------------------------------------------------------
// 2) Helpers
// ----------------------------------------------------------------------------
function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(v, def = '') {
  if (v === undefined || v === null) return def;
  return String(v);
}

function mask(value, front = 2, back = 2) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= front + back) return '*'.repeat(s.length);
  return s.slice(0, front) + '*'.repeat(s.length - front - back) + s.slice(-back);
}

// ----------------------------------------------------------------------------
// 3) Config
// ----------------------------------------------------------------------------
const env = {
  NODE_ENV,
  isProd: NODE_ENV === 'production',

  // (debug) quale file env è stato caricato davvero
  _envFileLoaded: _dotenvInfo.file || '',

  // ---------------------------------------------------------------------------
  // SERVER
  // ---------------------------------------------------------------------------
  PORT: num(process.env.PORT, 3000),

  // CORS (separati da virgola)
  CORS_WHITELIST: (str(process.env.CORS_WHITELIST, ''))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // ---------------------------------------------------------------------------
  // DB
  // ---------------------------------------------------------------------------
  DB: {
    // ⚠️ Default “furbi” in dev: evitiamo ::1 e valori vuoti
    host: str(process.env.DB_HOST, '127.0.0.1'),
    port: num(process.env.DB_PORT, 3306),
    user: str(process.env.DB_USER, 'root'),
    password: str(process.env.DB_PASSWORD, ''),
    database: str(process.env.DB_NAME, 'app'),

    // alias di compatibilità (se in qualche file usi env.DB.name)
    get name() { return this.database; }
  },

  // ---------------------------------------------------------------------------
  // LOG (se lo usi nel tuo logger)
  // ---------------------------------------------------------------------------
  LOG: {
    dir: str(process.env.LOG_DIR, './logs'),
    retentionDays: num(process.env.LOG_RETENTION_DAYS, 14),
    level: str(process.env.LOG_LEVEL, 'info'),
  },

  // ---------------------------------------------------------------------------
  // AUTH / JWT
  // ---------------------------------------------------------------------------
  JWT: {
    secret: str(process.env.JWT_SECRET, ''),
    ttlSeconds: num(process.env.JWT_TTL_SECONDS, 60 * 60 * 8),
    issuer: process.env.JWT_ISSUER || undefined,
    audience: process.env.JWT_AUDIENCE || undefined,
  },

  AUTH: {
    devBypass: bool(process.env.AUTH_DEV_BYPASS, false),
    devUser: str(process.env.AUTH_DEV_USER, 'dev@local'),
    devId: num(process.env.AUTH_DEV_ID, 0),
  },

  // ---------------------------------------------------------------------------
  // CENTRALINO (PBX → /asporto)
  // ---------------------------------------------------------------------------
  CENTRALINO_KEY: str(process.env.CENTRALINO_KEY, ''),
  CENTRALINO_REDIRECT_BASE: str(process.env.CENTRALINO_REDIRECT_BASE, ''),

  // ---------------------------------------------------------------------------
  // MAIL
  // ---------------------------------------------------------------------------
  MAIL: {
    enabled: bool(process.env.MAIL_ENABLED, true),
    host: str(process.env.SMTP_HOST, 'smtp.gmail.com'),
    port: num(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: str(process.env.SMTP_USER, ''),
    pass: str(process.env.SMTP_PASS, ''),
    from: str(process.env.MAIL_FROM, 'Prenotazioni <no-reply@example.com>'),
    replyTo: str(process.env.MAIL_REPLY_TO, ''),
    bizName: str(process.env.BIZ_NAME, str(process.env.BRAND_NAME, 'La tua attività')),
  },

  // ---------------------------------------------------------------------------
  // WHATSAPP (TWILIO)
  // ---------------------------------------------------------------------------
  WA: {
    enabled: bool(process.env.WA_ENABLED, false),
    notifyAlways: bool(process.env.WA_NOTIFY_ALWAYS, false),

    accountSid: str(process.env.TWILIO_ACCOUNT_SID, ''),
    authToken: str(process.env.TWILIO_AUTH_TOKEN, ''),

    from: str(process.env.WA_FROM, ''),
    defaultCc: str(process.env.WA_DEFAULT_CC, '+39'),
    defaultCountry: str(process.env.WA_DEFAULT_COUNTRY, 'IT'),

    mediaLogo: str(process.env.WA_MEDIA_LOGO_URL, ''),

    // template “status change”
    templateSid: str(process.env.WA_TEMPLATE_STATUS_CHANGE_SID, ''),

    // template “prenotazione conferma” (Quick Reply)
    templateReservationConfirmSid: str(process.env.WA_TEMPLATE_RESERVATION_CONFIRM_SID, ''),

    // blocco free-text fuori 24h
    blockFreeTextOutside24h: bool(process.env.WA_BLOCK_FREE_TEXT_OUTSIDE_24H, false),

    // webhook base url (backend pubblico)
    webhookBaseUrl: str(process.env.WA_WEBHOOK_BASE_URL, ''),

    // apply actions auto (confirm/cancel) dal webhook
    autoApplyActions: bool(process.env.WA_AUTO_APPLY_ACTIONS, false),

    // log contenuto messaggi (di solito NO)
    logContent: bool(process.env.WA_LOG_CONTENT, false),
  },

  // ---------------------------------------------------------------------------
  // Debug helpers (safe: non stampare segreti)
  // ---------------------------------------------------------------------------
  _debugDbConfig() {
    const d = env.DB;
    return {
      host: d.host,
      port: d.port,
      database: d.database,
      user: mask(d.user, 2, 1),
      password: d.password ? '[set]' : '',
      envFileLoaded: env._envFileLoaded || '(none)',
    };
  },

  _debugWaConfig() {
    const w = env.WA;
    return {
      enabled: !!w.enabled,
      accountSid: w.accountSid ? mask(w.accountSid, 6, 3) : '',
      authToken: w.authToken ? '[set]' : '',
      from: w.from || '',
      templateSid: w.templateSid ? '[set]' : '',
      templateReservationConfirmSid: w.templateReservationConfirmSid ? '[set]' : '',
      webhookBaseUrl: w.webhookBaseUrl || '',
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
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');

const env = require('./env');
const logger = require('./logger');
const dbmod = require('./db');

// === GOOGLE: nuovi router puliti ============================================
const googleOauth = require('./api/google/oauth');
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
  else logger.info(`✅ Trovato ${friendlyName}`, { file: abs });
  return ok;
}

// Ping rapido
app.get('/api/ping', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, time: new Date().toISOString() });
});

// API core (tue)
if (ensureExists('api/auth', 'API /api/auth'))
  app.use('/api/auth', require('./api/auth'));
if (ensureExists('api/reservations', 'API /api/reservations'))
  app.use('/api/reservations', require('./api/reservations'));
if (ensureExists('api/products', 'API /api/products'))
  app.use('/api/products', require('./api/products'));
if (ensureExists('api/orders', 'API /api/orders'))
  app.use('/api/orders', require('./api/orders'));
if (ensureExists('api/tables', 'API /api/tables'))
  app.use('/api/tables', require('./api/tables'));
if (ensureExists('api/rooms', 'API /api/rooms'))
  app.use('/api/rooms', require('./api/rooms'));
if (ensureExists('api/notifications', 'API /api/notifications'))
  app.use('/api/notifications', require('./api/notifications'));

// ✅ INGREDIENTI (già presenti)
if (ensureExists('api/ingredients', 'API /api/ingredients'))
  app.use('/api/ingredients', require('./api/ingredients'));
if (ensureExists('api/product_ingredients', 'API /api/product-ingredients'))
  app.use(
    '/api/product-ingredients',
    require('./api/product_ingredients'),
  );

/**
 * 🧹 GOOGLE – MOUNT PULITI
 * - Disabilito il vecchio router /api/google (cercava user_id e ti rompeva).
 * - Lascio solo /api/google/oauth e /api/google/people.
 */
// ❌ legacy: app.use('/api/google', require('./api/google'));  // DISATTIVATO
app.use('/api/google/oauth', googleOauth);
app.use('/api/google/people', googlePeople);

// 🆕 NFC API
if (ensureExists('api/nfc', 'API /api/nfc'))
  app.use('/api/nfc', require('./api/nfc'));

// 🆕 NFC Session API (ultimo ordine per sessione + chiusura by id)
if (ensureExists('api/nfc-session', 'API /api/nfc-session')) {
  // NB: path REST: /api/nfc/session/...
  app.use('/api/nfc/session', require('./api/nfc-session'));
}

if (ensureExists('api/customers', 'API /api/customers'))
  app.use('/api/customers', require('./api/customers')(app));

// 🆕 Centralino (PBX → /asporto prefill)
if (ensureExists('api/centralino', 'API /api/centralino'))
  app.use('/api/centralino', require('./api/centralino')(app));

// 🆕 Gift Vouchers (Buoni Regalo)
if (ensureExists('api/gift-vouchers', 'API /api/gift-vouchers'))
  app.use('/api/gift-vouchers', require('./api/gift-vouchers')(app));

// 🆕 Public voucher activation (no-auth)
if (ensureExists('api/public-voucher', 'API /api/public/voucher'))
  app.use('/api/public', require('./api/public-voucher')(app));

// Health
if (ensureExists('api/health', 'API /api/health'))
  app.use('/api/health', require('./api/health'));

// (Eventuali) Socket.IO
const { Server } = require('socket.io');
const io = new Server(server, {
  path: '/socket.io',
  cors: { origin: true, credentials: true },
});
if (ensureExists('sockets/index', 'Sockets entry')) {
  require('./sockets/index')(io);
} else {
  logger.warn(
    '⚠️ sockets/index non trovato: i socket non saranno gestiti',
  );
  io.on('connection', (s) =>
    logger.info('🔌 socket connected (fallback)', { id: s.id }),
  );
}

// (Facoltativi) Schema check / Migrations
if (ensureExists('db/schema-check', 'Schema checker')) {
  const { runSchemaCheck } = require('./db/schema-check');
  runSchemaCheck().catch((err) =>
    logger.error('❌ Schema check failed', { error: String(err) }),
  );
}
if (ensureExists('db/migrator', 'DB migrator')) {
  const { runMigrations } = require('./db/migrator');
  runMigrations()
    .then(() => logger.info('🧰 MIGRATIONS ✅ all applied'))
    .catch((e) =>
      logger.error('❌ Startup failed (migrations)', {
        error: String(e),
      }),
    );
}

server.listen(env.PORT, () =>
  logger.info(`🚀 HTTP listening on :${env.PORT}`),
);
```

### ./src/services/gift-voucher-printer.service.js
```
// src/services/gift-voucher-printer.service.js
// ============================================================================
// Stampa termica "Buono Regalo" (ESC/POS su TCP 9100)
// - Reuse pattern print (orders/print & thermal-printer)
// - Header/Footer da ENV, logo PNG opzionale
// - QR opzionale: usa QR_BASE_URL se presente, altrimenti stampa solo codice
// - Niente simbolo “€” (compat codepage) → uso "EUR"
// ============================================================================
// Stile: commenti lunghi in italiano + log con emoji.
// ============================================================================

'use strict';

const net    = require('net');
const fs     = require('fs');
const path   = require('path');
const logger = require('../logger');
const env    = require('../env');

let PNGjs;
try { ({ PNG: PNGjs } = require('pngjs')); } catch { PNGjs = null; }
let QRLib;
try { QRLib = require('qrcode'); } catch { QRLib = null; }

const ESC = 0x1b, GS = 0x1d;
const WIDTH_MM = Number(process.env.PRINTER_WIDTH_MM || 80);
const COLS = Number(process.env.PRINTER_COLS || (WIDTH_MM >= 70 ? 48 : 42));

const QR_BASE_URL = (process.env.QR_BASE_URL || '').trim();
const QR_SIZE_ENV = Number(process.env.PRINTER_QR_SIZE || 5);
const QR_ECC_ENV  = String(process.env.PRINTER_QR_ECC || 'H').toUpperCase();
const QR_MODE     = String(process.env.PRINTER_QR_MODE || 'raster').toLowerCase(); // auto|escpos|raster
const QR_SCALE    = Math.max(1, Math.min(12, Number(process.env.PRINTER_QR_SCALE || 4)));

const PRINT_TIMEOUT_MS = Math.max(1500, Number(process.env.PRINTER_TIMEOUT_MS || 6000));

function cmdInit()     { return Buffer.from([ESC, 0x40]); }
function cmdAlign(n=0) { return Buffer.from([ESC, 0x61, n]); }
function cmdMode(n=0)  { return Buffer.from([ESC, 0x21, n]); }
function cmdLF(n=1)    { return Buffer.from(Array(n).fill(0x0a)); }
function cmdCut()      { return Buffer.from([GS, 0x56, 0x00]); }
function cmdSize(w=1, h=1) {
  const W = Math.max(1, Math.min(8, w));
  const H = Math.max(1, Math.min(8, h));
  const v = ((W - 1) << 4) | (H - 1);
  return Buffer.from([GS, 0x21, v]);
}

function sanitizeForEscpos(s) {
  return String(s || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/€+/g, 'EUR')
    .replace(/\s+/g, ' ')
    .trim();
}

function line(s='') {
  return Buffer.concat([Buffer.from(sanitizeForEscpos(s), 'latin1'), Buffer.from([0x0a])]);
}

function wrapText(s, maxCols = COLS) {
  const text = sanitizeForEscpos(s);
  if (!text) return [];
  const words = text.split(' ');
  const out = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length <= maxCols) cur = cand;
    else { if (cur) out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

function formatDateIt(isoLike) {
  try {
    const d = isoLike ? new Date(isoLike) : new Date();
    if (Number.isNaN(d.getTime())) return String(isoLike || '');
    return new Intl.DateTimeFormat('it-IT', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return String(isoLike || '');
  }
}

function readHeaderLines() {
  const raw = env.PRINTER?.header ?? process.env.PRINTER_HEADER ?? '';
  return String(raw).split('|').filter(Boolean);
}
function readFooterLines() {
  const raw = env.PRINTER?.footer ?? process.env.PRINTER_FOOTER ?? '';
  return String(raw).split('|').filter(Boolean);
}

// ─────────────────────────── LOGO PNG (opzionale) ───────────────────────────
const MAX_DOTS = WIDTH_MM >= 70 ? 576 : 384;
function buildRasterFromPNG(png, maxWidthDots = MAX_DOTS, threshold = 200) {
  const targetW = Math.min(maxWidthDots, png.width);
  const ratio   = targetW / png.width;
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
      if (gray < threshold) bmp[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
    }
  }
  const m  = 0;
  const xL = bytesPerRow & 0xff, xH = (bytesPerRow >> 8) & 0xff;
  const yL = targetH & 0xff,      yH = (targetH >> 8) & 0xff;
  return Buffer.concat([Buffer.from([GS, 0x76, 0x30, m, xL, xH, yL, yH]), bmp, Buffer.from([0x0a])]);
}

let LOGO_RASTER = null;
(function preloadLogo() {
  try {
    const logoPath = process.env.PRINTER_LOGO_PATH || 'assets/logo.png';
    const abs = path.resolve(process.cwd(), logoPath);
    if (PNGjs && fs.existsSync(abs)) {
      const buf = fs.readFileSync(abs);
      const png = PNGjs.sync.read(buf);
      const raster = buildRasterFromPNG(png, Math.floor(MAX_DOTS * 0.85), 190);
      LOGO_RASTER = Buffer.concat([cmdAlign(1), raster, cmdLF(1)]);
      logger.info(`🖼️ [GiftVoucher] Logo caricato: ${abs}`);
    }
  } catch (e) {
    logger.warn('🖼️ [GiftVoucher] Logo PNG non caricabile', { msg: String(e?.message || e) });
  }
})();

// ────────────────────────────── QR ESC/POS ─────────────────────────────────
function qrSelectModel2() { return Buffer.from([GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]); }
function qrStoreData(data) {
  const payload = Buffer.from(String(data || ''), 'ascii');
  const len = payload.length + 3;
  const pL = len & 0xff, pH = (len >> 8) & 0xff;
  return Buffer.from([GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30, ...payload]);
}
function qrSetModuleSize(size = 6) {
  const s = Math.max(1, Math.min(16, size));
  return Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, s]);
}
function qrSetECCFromEnv() {
  const map = { L: 48, M: 49, Q: 50, H: 51 };
  const lv = map[QR_ECC_ENV] ?? 51;
  return Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, lv]);
}
function qrPrint() { return Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]); }

async function tryPrintQrAsRaster(sock, url) {
  if (!QRLib || !PNGjs) return false;
  try {
    const eccMap = { L:'L', M:'M', Q:'Q', H:'H' };
    const ecc = eccMap[QR_ECC_ENV] || 'H';
    const pngBuf = await QRLib.toBuffer(url, {
      errorCorrectionLevel: ecc,
      margin: 0,
      scale: QR_SCALE,
      type: 'png',
    });
    const png = PNGjs.sync.read(pngBuf);
    const raster = buildRasterFromPNG(png, Math.floor(MAX_DOTS * 0.7), 160);
    sock.write(cmdAlign(1));
    sock.write(raster);
    sock.write(cmdAlign(0));
    return true;
  } catch (e) {
    logger.warn('🔳 [GiftVoucher] QR raster failed', { msg: String(e?.message || e) });
    return false;
  }
}

function buildQrText(code) {
  const base = (QR_BASE_URL || '').replace(/\/+$/,'');
  if (!base) return String(code || '').trim();
  const q = new URLSearchParams({
    code: String(code || '').trim(),
    utm_source: 'gift_voucher_qr',
    utm_medium: 'qr',
    utm_campaign: 'gift_voucher',
  });
  return `${base}/voucher?${q.toString()}`;
}

function openSocket() {
  const ip   = env.PRINTER?.ip || process.env.PRINTER_IP;
  const port = Number(env.PRINTER?.port || process.env.PRINTER_PORT || 9100);
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    const timer = setTimeout(() => {
      try { sock.destroy(); } catch {}
      reject(new Error('printer_timeout'));
    }, PRINT_TIMEOUT_MS);
    sock.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    sock.connect(port, ip, () => {
      clearTimeout(timer);
      resolve({ sock, ip, port });
    });
  });
}

async function withPrinter(fn) {
  if (!env.PRINTER?.enabled && String(process.env.PRINTER_ENABLED).toLowerCase() !== 'true') {
    logger.warn('🖨️ [GiftVoucher] PRINTER disabled (no-op)');
    return { jobId: `noop-${Date.now()}`, printedCount: 0, printer: null };
  }
  const { sock, ip, port } = await openSocket();
  try {
    sock.write(cmdInit());

    const headerLines = readHeaderLines();
    if (headerLines.length) {
      sock.write(cmdAlign(1));
      for (const h of headerLines) sock.write(line(h));
      sock.write(cmdLF(1));
      sock.write(cmdAlign(0));
    }

    const out = await fn(sock);

    const footerLines = readFooterLines();
    if (footerLines.length) {
      sock.write(cmdLF(1));
      sock.write(cmdAlign(1));
      for (const f of footerLines) sock.write(line(f));
      sock.write(cmdAlign(0));
    }

    sock.write(cmdLF(2));
    sock.write(cmdCut());
    sock.end();
    return { ...(out || {}), printer: { ip, port } };
  } catch (e) {
    try { sock.end(); } catch {}
    throw e;
  }
}

async function printGiftVoucherSlip({ voucher, qrText }) {
  const v = voucher || {};
  const code = String(v.code || '').trim();
  const valueEUR = (Number(v.value_cents || 0) / 100).toFixed(2);
  const eventTitle = v.event_title || '—';
  const desc = v.description || '';
  const validUntil = v.valid_until ? formatDateIt(v.valid_until) : '';

  return await withPrinter(async (sock) => {
    // Logo (opzionale) centrato
    if (LOGO_RASTER) sock.write(LOGO_RASTER);

    // Titolo (leggermente più grande)
    sock.write(cmdAlign(1));
    sock.write(cmdMode(0x08));
    sock.write(cmdSize(2, 3));
    sock.write(line('BUONO REGALO'));
    sock.write(cmdSize(1, 1));
    sock.write(cmdMode(0x00));
    sock.write(cmdAlign(0));

    sock.write(line('-'.repeat(COLS)));
    sock.write(line(`Valore: ${valueEUR} EUR`));
    sock.write(line(`Evento: ${eventTitle}`));
    sock.write(line(''));

    if (desc) {
      const wrapped = wrapText(`Descrizione: ${desc}`, COLS);
      for (const ln of wrapped) sock.write(line(ln));
    }

    sock.write(line(`Codice: ${code || '-'}`));
    if (validUntil) sock.write(line(`Valido fino al: ${validUntil}`));
    sock.write(line('-'.repeat(COLS)));

    // QR (best-effort) → se fallisce, stampo il codice grande
    if (qrText) {
      // Un po' di spazio prima del QR per evitare tagli
      sock.write(cmdLF(1));
      let printedQr = false;
      const wantRaster = (QR_MODE === 'raster') || (QR_MODE === 'auto' && QRLib && PNGjs);
      if (wantRaster) printedQr = await tryPrintQrAsRaster(sock, qrText);

      if (!printedQr && QR_MODE !== 'raster') {
        try {
          const seq = [
            cmdAlign(1),
            qrSelectModel2(),
            qrSetModuleSize(QR_SIZE_ENV),
            qrSetECCFromEnv(),
            qrStoreData(qrText),
            qrPrint(),
            cmdAlign(0),
            cmdLF(1),
          ];
          for (const part of seq) sock.write(part);
          printedQr = true;
        } catch {
          printedQr = false;
        }
      }

      if (!printedQr) {
        sock.write(cmdAlign(1));
        sock.write(cmdMode(0x08));
        sock.write(cmdSize(2, 2));
        sock.write(line(code || '-'));
        sock.write(cmdSize(1, 1));
        sock.write(cmdMode(0x00));
        sock.write(cmdAlign(0));
      }
      // Un po' di spazio dopo il QR
      sock.write(cmdLF(1));
    }

    // Footer statico brand (come da richiesta)
    sock.write(cmdAlign(1));
    sock.write(line('Largo della Liberta 4'));
    sock.write(line('62022, Castelraimondo (MC)'));
    sock.write(line('Tel. 0737642142'));
    sock.write(cmdAlign(0));
    return { jobId: `gift-${v.id || 'na'}-${Date.now()}`, printedCount: 1 };
  });
}

module.exports = {
  printGiftVoucherSlip,
  buildQrText,
};
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
    readMask: 'names,emailAddresses,phoneNumbers,biographies',
  });

  const items = (resp.data.results || []).map((r) => {
    const p = r.person || {};
    const name  = p.names?.[0];
    const email = p.emailAddresses?.[0];
    const phone = p.phoneNumbers?.[0];
    const bio   = p.biographies?.[0];

    return {
      resourceName: p.resourceName || r.person?.resourceName || null,
      etag:         p.etag || r.person?.etag || null,
      displayName: name?.displayName || null,
      givenName:   name?.givenName || null,
      familyName:  name?.familyName || null,
      email:       email?.value || null,
      phone:       phone?.value || null,
      note:        bio?.value || null,
    };
  });

  return items;
}

// Crea un contatto (serve scope write: https://www.googleapis.com/auth/contacts)
async function createContact({ givenName, familyName, displayName, email, phone, note }) {
  const auth = await ensureAuth();            // può lanciare consent_required
  const people = peopleClient(auth);

  try {
    const requestBody = {
      names: [{ givenName: givenName || undefined, familyName: familyName || undefined, displayName: displayName || undefined }],
      emailAddresses: email ? [{ value: email }] : undefined,
      phoneNumbers:   phone ? [{ value: phone }] : undefined,
      biographies:    note ? [{ value: note, contentType: 'TEXT_PLAIN' }] : undefined,
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

// Aggiorna un contatto esistente (best-effort)
async function updateContact({ resourceName, etag, givenName, familyName, displayName, email, phone, note }) {
  if (!resourceName) {
    const err = new Error('resourceName_required');
    err.code = 'resource_name_required';
    throw err;
  }
  const auth = await ensureAuth();
  const people = peopleClient(auth);

  let contactEtag = etag;
  if (!contactEtag) {
    const got = await people.people.get({
      resourceName,
      personFields: 'names,emailAddresses,phoneNumbers,biographies',
    });
    contactEtag = got?.data?.etag || null;
  }

  const nameValue = (displayName || `${givenName || ''} ${familyName || ''}`.trim() || null);
  const requestBody = {
    resourceName,
    etag: contactEtag || undefined,
    names: nameValue ? [{ displayName: nameValue, givenName: givenName || undefined, familyName: familyName || undefined }] : undefined,
    emailAddresses: email ? [{ value: email }] : undefined,
    phoneNumbers:   phone ? [{ value: phone }] : undefined,
    biographies:    note ? [{ value: note, contentType: 'TEXT_PLAIN' }] : undefined,
  };

  const updateFields = [];
  if (requestBody.names) updateFields.push('names');
  if (requestBody.emailAddresses) updateFields.push('emailAddresses');
  if (requestBody.phoneNumbers) updateFields.push('phoneNumbers');
  if (requestBody.biographies) updateFields.push('biographies');

  if (!updateFields.length) {
    return { ok: false, reason: 'no_fields' };
  }

  const resp = await people.people.updateContact({
    resourceName,
    updatePersonFields: updateFields.join(','),
    requestBody,
  });

  const updated = resp?.data || {};
  logger.info('👤 [Google] contact updated', { resourceName, fields: updateFields });
  return { ok: true, resourceName: updated.resourceName || resourceName };
}

module.exports = {
  exchangeCode,
  ensureAuth,
  peopleClient,
  searchContacts,
  createContact,
  updateContact,
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
// - 🧲 closeSessionById: chiusura sessione per id (API /api/nfc/session/:id/close)
// Stile: commenti lunghi + log con emoji
// ============================================================================

const crypto = require('crypto');
const { query } = require('../db'); // wrapper mysql2
const logger = require('../logger');

const TABLE = 'nfc_tags';
const TABLE_TS = 'table_sessions';

// ----------------------------- utils ----------------------------------------
function base62(bytes = 9) {
  const alphabet =
    '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
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
      LIMIT 1`,
    [tableId],
  );
  return rows[0] || null;
}

async function insertToken(tableId, token) {
  await query(
    `INSERT INTO ${TABLE} (table_id, token, is_revoked) VALUES (?, ?, 0)`,
    [tableId, token],
  );
  return token;
}

async function revokeByTable(tableId) {
  await query(
    `UPDATE ${TABLE}
        SET is_revoked=1, revoked_at=NOW()
      WHERE table_id=? AND is_revoked=0`,
    [tableId],
  );
}

async function bindTable(tableId, opts = {}) {
  if (!tableId) throw new Error('table_id mancante');
  const { forceNew = false } = opts;

  if (!forceNew) {
    const current = await getActiveByTable(tableId);
    if (current) {
      logger.info(
        `🔗 [NFC] Token esistente per table_id=${tableId} → ${current.token}`,
      );
      return current.token;
    }
  }
  if (forceNew) {
    logger.warn(
      `♻️ [NFC] Rigenerazione token per table_id=${tableId} (revoca precedenti)`,
    );
    await revokeByTable(tableId);
  }

  let token = generateToken(12);
  for (let i = 0; i < 5; i++) {
    try {
      await insertToken(tableId, token);
      return token;
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('ER_DUP_ENTRY')) {
        token = generateToken(12);
        continue;
      }
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
    [token],
  );
  return { ok: true };
}

function buildPublicUrl(token, req) {
  const base =
    process.env.PUBLIC_BASE_URL ||
    `${req?.protocol || 'http'}://${
      req?.get ? req.get('host') : 'localhost:3000'
    }`;
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
    [tableId],
  );
  return rows?.[0] || null;
}
async function openSession(tableId, { by, note } = {}) {
  const res = await query(
    `INSERT INTO ${TABLE_TS} (table_id, opened_by, note) VALUES (?,?,?)`,
    [tableId, by || null, note || null],
  );
  const id = res?.insertId || null;
  logger.info(
    `🟢 [NFC] Sessione APERTA table_id=${tableId} (session_id=${id})`,
  );
  return id;
}
async function closeActiveSession(tableId, { by, reason } = {}) {
  const act = await getActiveSession(tableId);
  if (!act) return { closed: 0 };
  await query(
    `UPDATE ${TABLE_TS}
        SET closed_at = NOW(), closed_by = ?
      WHERE id = ? AND closed_at IS NULL`,
    [by || reason || null, act.id],
  );
  logger.info(
    `🔴 [NFC] Sessione CHIUSA table_id=${tableId} (session_id=${act.id})`,
  );
  return { closed: 1, session_id: act.id };
}

/**
 * 🧲 closeSessionById
 * ----------------------------------------------------------------------------
 * Chiusura sessione per ID (usato da API tipo: PUT /api/nfc/session/:id/close).
 * - Non richiede il table_id a chiamata
 * - È best-effort: se la sessione è già chiusa, non lancia errore.
 */
async function closeSessionById(sessionId, { by, reason } = {}) {
  if (!sessionId) throw new Error('session_id mancante');

  const rows = await query(
    `SELECT id, table_id, opened_at, closed_at
       FROM ${TABLE_TS}
      WHERE id = ?
      LIMIT 1`,
    [sessionId],
  );
  const s = rows?.[0];
  if (!s) {
    logger.warn('🧲 [NFC] closeSessionById: sessione non trovata', {
      session_id: sessionId,
    });
    return { closed: 0 };
  }

  if (s.closed_at) {
    logger.info('🧲 [NFC] closeSessionById: sessione già chiusa', {
      session_id: sessionId,
      table_id: s.table_id,
    });
    return { closed: 0, session_id: s.id, already_closed: true };
  }

  await query(
    `UPDATE ${TABLE_TS}
        SET closed_at = NOW(), closed_by = ?
      WHERE id = ? AND closed_at IS NULL`,
    [by || reason || null, sessionId],
  );

  logger.info('🔴 [NFC] Sessione CHIUSA (by id)', {
    session_id: sessionId,
    table_id: s.table_id,
  });

  return { closed: 1, session_id: sessionId, table_id: s.table_id };
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
  const tag = (
    await query(
      `SELECT id, table_id
       FROM ${TABLE}
      WHERE token = ? AND is_revoked = 0
      LIMIT 1`,
      [token],
    )
  )?.[0];

  logger.info('🔎 [NFC] resolve.check', {
    token,
    found: !!tag,
    table_id: tag?.table_id,
  });

  if (!tag) return null; // ← 404 not_found_or_revoked

  // 2) meta tavolo (JOIN) — usa table_number
  const meta =
    (
      await query(
        `SELECT t.table_number, t.room_id, r.name AS room_name
       FROM tables t
  LEFT JOIN rooms  r ON r.id = t.room_id
      WHERE t.id = ?
      LIMIT 1`,
        [tag.table_id],
      )
    )?.[0] || {};

  // 3) prenotazione odierna
  const resv =
    (
      await query(
        `SELECT id FROM reservations
      WHERE table_id = ?
        AND status IN ('pending','accepted')
        AND start_at >= UTC_DATE()
        AND start_at <  (UTC_DATE() + INTERVAL 1 DAY)
      ORDER BY start_at ASC
      LIMIT 1`,
        [tag.table_id],
      )
    )?.[0] || null;

  // 4) assicura sessione
  // check whether this table is enabled for sessions
  const stateRow = (
    await query(
      `SELECT enabled FROM nfc_table_state WHERE table_id = ? LIMIT 1`,
      [tag.table_id],
    )
  )?.[0];
  const enabled = stateRow ? Number(stateRow.enabled || 0) === 1 : true;

  if (!enabled) {
    logger.info('🔒 [NFC] token resolved but table disabled', { token, table_id: tag.table_id });
    return {
      ok: false,
      disabled: true,
      table_id: tag.table_id,
      table_number: meta.table_number ?? null,
      room_id: meta.room_id ?? null,
      room_name: meta.room_name ?? null,
    };
  }

  const session_id = await ensureSession(tag.table_id, {
    ttlHours: 6,
    by: 'nfc/resolve',
  });

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
  const s =
    (
      await query(
        `SELECT id, closed_at, cart_json, cart_version, cart_updated_at
       FROM ${TABLE_TS}
      WHERE id=? LIMIT 1`,
        [sessionId],
      )
    )?.[0];
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
    [cartJson, sessionId, Number(version || 0)],
  );
  if (Number(res?.affectedRows || 0) === 1) {
    const cur = await getSessionCart(sessionId);
    return {
      ok: true,
      version: cur?.version ?? 0,
      updated_at: cur?.cart_updated_at ?? null,
    };
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
  closeSessionById,
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
 * - WHATSAPP (riusa services/whatsapp.service come UNICO punto di verità)
 *
 * ✅ PULIZIA:
 * - tolto fallback Twilio diretto → niente duplicazione logica / configurazioni
 * - se WA è disabilitato o misconfigurato → whatsapp.service ritorna {skipped:true,...}
 */

const logger = require('../logger');
const env = require('../env');
const nodemailer = require('nodemailer');

// ✅ unico service WhatsApp
const wa = require('./whatsapp.service');

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
  const body = `Nuovo ordine #${order.id}\n${order.customer_name || ''}\nTotale € ${Number(order.total).toFixed(2)}`;
  const out = await wa.sendText(order.phone, body);

  // log extra “di progetto”
  if (out?.skipped) {
    logger.warn('📲 WA NEW SKIP', { id: order.id, reason: out.reason || 'unknown' });
  }
  return out;
}

async function sendWhatsAppStatus(order, status) {
  const body = `Aggiornamento ordine #${order.id}: ${String(status).toUpperCase()}`;
  const out = await wa.sendText(order.phone, body);

  if (out?.skipped) {
    logger.warn('📲 WA STATUS SKIP', { id: order.id, status, reason: out.reason || 'unknown' });
  }
  return out;
}

module.exports = {
  async onOrderCreated(order) {
    try { await sendEmailNew(order); } catch (e) { logger.error('🔔 email NEW ❌', { error: String(e) }); }
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
// ============================================================================
// ORDERS API (REST + SSE) — stile Endri: commenti lunghi, log con emoji
// Rotte:
//   GET    /api/orders                         → lista (filtri: status|hours|from|to|q)
//   GET    /api/orders/:id                     → dettaglio (header + items + categoria)
//   POST   /api/orders                         → crea ordine + items
//   POST   /api/orders/:id/items               → aggiunge righe ad un ordine esistente
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

const pool = require('../db');
const log  = require('../logger') || console;
const { format } = require('date-fns');
const { it } = require('date-fns/locale');

// === INIZIO MODIFICA: risoluzione cliente da email/phone ====================
const resolveCustomerUserId = require('../utils/customers.resolve');
// === FINE MODIFICA ==========================================================

// --- Event Bus per SSE -------------------------------------------------------
const bus = new EventEmitter();
bus.setMaxListeners(200);

// UTIL -----------------------------------------------------------------------

function resolveRange(query) {
  const now = new Date();
  if (query.from && query.to) return { from: query.from, to: query.to };
  const h = Number(query.hours ?? 6);
  const from = new Date(now.getTime() - Math.max(1, h) * 3600 * 1000);
  return {
    from: require('date-fns/format')(from, 'yyyy-MM-dd HH:mm:ss'),
    to:   require('date-fns/format')(now,  'yyyy-MM-dd HH:mm:ss'),
  };
}
function statusWhere(status) { if (!status || status === 'all') return '1=1'; return 'o.status = ?'; }
function statusParams(status) { if (!status || status === 'all') return []; return [String(status)]; }

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

/**
 * Ricalcola il totale di un ordine sulla base di order_items.
 * Se viene passato un connection, usa quella transazionale.
 */
async function recalcOrderTotal(orderId, conn) {
  const sql = `
    SELECT IFNULL(SUM(i.qty * i.price), 0) AS total
    FROM order_items i
    WHERE i.order_id = ?
  `;
  const [rows] = await (conn || pool).query(sql, [orderId]);
  const total = rows.length ? Number(rows[0].total || 0) : 0;

  await (conn || pool).query(
    `UPDATE orders
       SET total = ?, updated_at = NOW()
     WHERE id = ?`,
    [total, orderId],
  );

  return total;
}

/** Stampa via TCP 9100 (ESC/POS) */
async function printComande(order, opts = {}) {
  try {
    const enabled = String(process.env.PRINTER_ENABLED || 'false') === 'true';
    if (!enabled) {
      log.warn('🖨️  PRINTER_DISABLED — niente stampa', { service: 'server' });
      return { ok: true, skipped: true };
    }
    const pizHost = process.env.PIZZERIA_PRINTER_IP || process.env.PRINTER_IP;
    const pizPort = Number(process.env.PIZZERIA_PRINTER_PORT || process.env.PRINTER_PORT || 9100);
    const kitHost = process.env.KITCHEN_PRINTER_IP  || process.env.PRINTER_IP;
    const kitPort = Number(process.env.KITCHEN_PRINTER_PORT  || process.env.PRINTER_PORT || 9100);

    const PIZZERIA_CATEGORIES = (process.env.PIZZERIA_CATEGORIES || 'PIZZE,PIZZE ROSSE,PIZZE BIANCHE')
      .split(',').map(s => s.trim().toUpperCase());
    const KITCHEN_CATEGORIES  = (process.env.KITCHEN_CATEGORIES  || 'BEVANDE,ANTIPASTI')
      .split(',').map(s => s.trim().toUpperCase());

    const pizItems = order.items.filter(i => PIZZERIA_CATEGORIES.includes(String(i.category || '').toUpperCase()));
    const kitItems = order.items.filter(i => KITCHEN_CATEGORIES.includes(String(i.category || '').toUpperCase()));

    const { createConnection } = require('net');
    const sendRaw = (host, port, text) => new Promise((resolve, reject) => {
      const sock = createConnection({ host, port }, () => { sock.write(text, () => sock.end()); });
      sock.on('error', reject); sock.on('close', () => resolve(true));
    });
    const buildTextCopy = (title, items) => {
      const brand = process.env.BRAND_NAME || 'Pizzeria';
      const now   = format(new Date(), "dd/MM/yyyy HH:mm", { locale: it });
      let out = '';
      out += '\x1B!\x38'; out += `${brand}\n`; out += '\x1B!\x00';
      out += `${title}  #${order.id}\n`;
      out += `Cliente: ${order.customer_name || '-'}  Tel: ${order.phone || '-'}\n`;
      out += `Quando: ${order.scheduled_at || now}\n`;
      out += '------------------------------\n';
      for (const it of items) { out += ` ${it.qty} x ${it.name}\n`; if (it.notes) out += `  * ${it.notes}\n`; }
      out += '------------------------------\n\n\n\x1DVA\x00';
      return out;
    };

    if (pizItems.length) await sendRaw(pizHost, pizPort, buildTextCopy('PIZZERIA', pizItems));
    if (kitItems.length) await sendRaw(kitHost, kitPort, buildTextCopy('CUCINA',   kitItems));
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

// ➕ Aggiunge righe ad un ordine esistente (compat con Opzione B)
router.post('/:id(\\d+)/items', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });

  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    return res.status(400).json({ ok: false, error: 'no_items' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [exists] = await conn.query(
      'SELECT id FROM orders WHERE id = ? LIMIT 1',
      [id],
    );
    if (!exists.length) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ ok: false, error: 'not_found' });
    }

    let inserted = 0;

    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const name = String(it.name || '').trim();
      if (!name) continue;

      await conn.query(
        `INSERT INTO order_items (order_id, product_id, name, qty, price, notes, created_at)
         VALUES (?,?,?,?,?,?,NOW())`,
        [
          id,
          it.product_id ?? null,
          name,
          it.qty ?? 1,
          it.price ?? 0,
          it.notes ?? null,
        ],
      );
      inserted += 1;
    }

    const total = await recalcOrderTotal(id, conn);

    await conn.commit();

    const header = await loadHeader(id, conn);
    const details = await loadItems(id, conn);
    const full = { ...header, items: details };

    // riuso evento "status" come "ordine aggiornato"
    bus.emit('status', { id, status: full.status });

    log.info('➕ ORDERS.addItems ✅', {
      service: 'server',
      id,
      added : inserted,
      total,
    });

    res.status(201).json(full);
  } catch (err) {
    await conn.rollback();
    log.error('➕ ORDERS.addItems ❌', {
      service: 'server',
      error  : String(err),
      id,
    });
    res.status(500).json({ ok: false, error: 'orders_add_items_error', reason: String(err) });
  } finally {
    conn.release();
  }
});

// Crea ordine
router.post('/', async (req, res) => {
  const body = req.body || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // === INIZIO MODIFICA: resolve users.id dal payload ======================
    const email = body.email ?? body.customer?.email ?? null;
    const phone = body.phone ?? body.customer?.phone ?? null;
    let customer_user_id = null;
    try {
      customer_user_id = await resolveCustomerUserId(conn, { email, phone });
      log.info('🧩 ORDERS.create → customer_user_id = %s', customer_user_id, { email, phone });
    } catch (e) {
      log.warn('⚠️ ORDERS.create resolveCustomerUserId KO: %s', String(e?.message || e));
    }
    // === FINE MODIFICA ======================================================

    const [r] = await conn.query(
      `INSERT INTO orders
         (customer_name, phone, email, people, scheduled_at, note, channel, status, created_at, updated_at, customer_user_id)
       VALUES (?,?,?,?,?,?,?,?,NOW(),NOW(),?)`,
      [
        body.customer_name || null,
        body.phone ?? null,
        body.email ?? null,
        body.people ?? null,
        body.scheduled_at ?? null,
        body.note ?? null,
        body.channel || 'admin',
        'pending',
        customer_user_id
      ]
    );
    const orderId = r.insertId;

    const itemsBody = Array.isArray(body.items) ? body.items : [];
    for (const it of itemsBody) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_id, name, qty, price, notes, created_at)
         VALUES (?,?,?,?,?,?,NOW())`,
        [orderId, it.product_id ?? null, it.name, it.qty, it.price, it.notes ?? null]
      );
    }

    await conn.commit();

    const full = { ...(await loadHeader(orderId, conn)), items: await loadItems(orderId, conn) };
    bus.emit('created', { id: full.id, status: full.status });

    log.info('🧾 ORDERS.create ✅', { service: 'server', id: orderId, items: itemsBody.length });
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
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders?.();

  log.info('🧵 ORDERS.stream ▶️ open', { service: 'server', ip: req.ip });

  const ping = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: "ok"\n\n`);
  }, 25000);

  const onCreated = (payload) => { res.write(`event: created\n`); res.write(`data: ${JSON.stringify(payload)}\n\n`); };
  const onStatus  = (payload) => { res.write(`event: status\n`);  res.write(`data: ${JSON.stringify(payload)}\n\n`); };

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
// - 🆕 checkIn / checkOut idempotenti (persistono checkin_at / checkout_at / dwell_sec)
// - 🆕 assignReservationTable (usato dai sockets) + changeTable alias
// ============================================================================

'use strict';

const { query } = require('../db');
const logger = require('../logger');
const env    = require('../env');
const google = require('./google.service');

// --- Helpers -----------------------------------------------------------------
function trimOrNull(s) { const v = (s ?? '').toString().trim(); return v ? v : null; }
function toDayRange(fromYmd, toYmd) {
  const out = { from: null, to: null };
  if (fromYmd) out.from = `${fromYmd} 00:00:00`;
  if (toYmd)   out.to   = `${toYmd} 23:59:59`;
  return out;
}

/**
 * Converte qualunque input (stringa ISO, Date, oppure 'YYYY-MM-DD HH:mm:ss'
 * locale) in una stringa MySQL DATETIME "YYYY-MM-DD HH:mm:ss" in **UTC**.
 *
 * Pipeline che vogliamo:
 * - Il FE lavora in ORA LOCALE (Europe/Rome nel tuo caso).
 *   (logica gemella di toUTCFromLocalDateTimeInput sul FE: src/app/shared/utils.date.ts).
 * - Quando manda al BE valori tipo "2025-11-15T19:00" o "2025-11-15 19:00:00",
 *   qui li interpretiamo come locali e li convertiamo in UTC.
 * - Il DB è configurato con time_zone = '+00:00', quindi il DATETIME salvato
 *   è già UTC e quando lo rileggiamo/serializziamo va verso il FE come ISO con 'Z'.
 */
function isoToMysql(iso) {
  if (!iso) return null;
  if (iso instanceof Date) return dateToMysqlUtc(iso);
  const s = String(iso).trim();

  // Se è già nel formato MySQL "YYYY-MM-DD HH:mm:ss" lo tratto come ORA LOCALE
  // del ristorante e lo porto in UTC.
  const mysqlLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (mysqlLike.test(s)) {
    const [datePart, timePart] = s.split(' ');
    const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10));
    const [hh, mm, ss] = timePart.split(':').map((n) => parseInt(n, 10));
    const local = new Date(y, m - 1, d, hh, mm, ss); // 👉 locale
    if (!Number.isNaN(local.getTime())) return dateToMysqlUtc(local);
  }

  // Per tutto il resto ("YYYY-MM-DDTHH:mm", ISO con 'Z', ecc.) lascio che il
  // costruttore Date si arrangi. Se è senza 'Z' verrà interpretato come locale,
  // se ha 'Z' è già UTC.
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return dateToMysqlUtc(d);

  // Fallback compat per formati strani: mantengo il tuo vecchio comportamento.
  return s.replace('T', ' ').slice(0, 19);
}

/**
 * Helper interno: Date → stringa MySQL DATETIME in UTC.
 */
function dateToMysqlUtc(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

/**
 * Calcola start_at / end_at a partire da una stringa di input (tipicamente
 * "YYYY-MM-DDTHH:mm" dalla tua admin PWA) e applica le regole pranzo/cena.
 *
 * - L'input viene interpretato come ORA LOCALE del ristorante.
 * - Decidiamo se è pranzo o cena guardando l'ora locale (<16 ⇒ pranzo).
 * - Poi convertiamo sia start che end in UTC per salvarli in DB.
 */
function computeEndAtFromStart(startAtIso) {
  if (!startAtIso) throw new Error('startAtIso mancante per computeEndAtFromStart');

  const raw = String(startAtIso).trim();
  let localStart = null;

  // Caso 1: "YYYY-MM-DD HH:mm[:ss]" (già con spazio)
  const spaceLike = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/;
  const spaceMatch = raw.match(spaceLike);
  if (spaceMatch) {
    const [, datePart, hhStr, mmStr, ssStr] = spaceMatch;
    const [y, m, d] = datePart.split('-').map((n) => parseInt(n, 10));
    const hh = parseInt(hhStr, 10);
    const mm = parseInt(mmStr, 10);
    const ss = ssStr ? parseInt(ssStr, 10) : 0;
    localStart = new Date(y, m - 1, d, hh, mm, ss);
  } else {
    // Caso 2: qualunque ISO gestito da Date ("YYYY-MM-DDTHH:mm" o ISO con Z).
    localStart = new Date(raw);
  }

  if (Number.isNaN(localStart.getTime())) {
    throw new Error(`startAtIso non valido: ${startAtIso}`);
  }

  // Regola pranzo/cena basata sull'ORA LOCALE (getHours).
  const addMin = (localStart.getHours() < 16
    ? (env.RESV?.defaultLunchMinutes || 90)
    : (env.RESV?.defaultDinnerMinutes || 120));

  const localEnd = new Date(localStart.getTime() + addMin * 60 * 1000);

  return {
    startMysql: dateToMysqlUtc(localStart),
    endMysql  : dateToMysqlUtc(localEnd),
  };
}

// ============================================================================
// ⚙️ Cambio stato basico (compat): accetta azione o stato
// ============================================================================

function normalizeStatusAction(actionOrStatus) {
  if (!actionOrStatus) return { nextStatus: null, note: null };
  const s = String(actionOrStatus).toLowerCase();
  if (s === 'accept' || s === 'accepted') return { nextStatus: 'accepted', note: null };
  if (s === 'reject' || s === 'rejected' || s === 'cancel' || s === 'cancelled' || s === 'canceled') {
    return { nextStatus: 'cancelled', note: null };
  }
  return { nextStatus: s, note: null };
}

// ============================================================================
// 📋 LIST / GET
// ============================================================================

async function list({ status, from, to, q } = {}) {
  const where = [];
  const params = [];

  if (status && status !== 'all') {
    where.push('r.status = ?');
    params.push(status);
  }

  const qNorm = trimOrNull(q);
  if (qNorm) {
    const raw = qNorm;
    const clean = raw.replace(/\s+/g, ' ').trim();
    const tokens = clean.split(' ').filter(Boolean);

    // Caso rapido: #123 oppure solo numeri → match ID diretto
    const idCandidate = clean.replace(/^#/, '');
    if (/^\d+$/.test(idCandidate)) {
      where.push('r.id = ?');
      params.push(Number(idCandidate));
    }

    // Per ogni token costruisco un OR "ampio" e lo metto in AND
    for (const t of tokens) {
      const like = `%${t}%`;
      const tDigits = t.replace(/\D+/g, '');
      const likeDigits = tDigits ? `%${tDigits}%` : null;
      where.push(
        '(' +
        'r.customer_first COLLATE utf8mb4_unicode_ci LIKE ? OR ' +
        'r.customer_last COLLATE utf8mb4_unicode_ci LIKE ? OR ' +
        "CONCAT_WS(' ', r.customer_first, r.customer_last) COLLATE utf8mb4_unicode_ci LIKE ? OR " +
        'r.phone COLLATE utf8mb4_unicode_ci LIKE ? OR ' +
        'r.email COLLATE utf8mb4_unicode_ci LIKE ? OR ' +
        'r.notes COLLATE utf8mb4_unicode_ci LIKE ? OR ' +
        'r.status_note COLLATE utf8mb4_unicode_ci LIKE ? OR ' +
        't.table_number LIKE ?' +
        (likeDigits ? ' OR REPLACE(REPLACE(REPLACE(REPLACE(r.phone, " ", ""), "+", ""), "-", ""), "/", "") LIKE ?' : '') +
        ')'
      );
      if (likeDigits) {
        params.push(like, like, like, like, like, like, like, like, likeDigits);
      } else {
        params.push(like, like, like, like, like, like, like, like);
      }
    }
  }

  const range = toDayRange(from, to);
  if (range.from) { where.push('r.start_at >= ?'); params.push(range.from); }
  if (range.to)   { where.push('r.start_at <= ?'); params.push(range.to);   }

  const sql = `
    SELECT
      r.id,
      r.customer_first,
      r.customer_last,
      r.phone,
      r.email,
      r.user_id,
      r.party_size,
      r.start_at,
      r.end_at,
      r.room_id,
      r.notes,
      r.status,
      r.created_by,
      r.updated_by,
      r.status_note,
      r.status_changed_at,
      r.client_token,
      r.table_id,
      r.created_at,
      r.updated_at,
      r.checkin_at,
      r.checkout_at,
      r.dwell_sec,
      u.first_name   AS user_first_name,
      u.last_name    AS user_last_name,
      u.email        AS user_email,
      t.table_number,
      CONCAT('Tavolo ', t.table_number) AS table_name
    FROM reservations r
    LEFT JOIN users  u ON u.id = r.user_id
    LEFT JOIN tables t ON t.id = r.table_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.start_at ASC, r.id ASC
  `;
  const rows = await query(sql, params);
  return rows;
}

async function getById(id) {
  const sql = `
    SELECT
      r.id,
      r.customer_first,
      r.customer_last,
      r.phone,
      r.email,
      r.user_id,
      r.party_size,
      r.start_at,
      r.end_at,
      r.room_id,
      r.notes,
      r.status,
      r.created_by,
      r.updated_by,
      r.status_note,
      r.status_changed_at,
      r.client_token,
      r.table_id,
      r.created_at,
      r.updated_at,
      r.checkin_at,
      r.checkout_at,
      r.dwell_sec,
      u.first_name   AS user_first_name,
      u.last_name    AS user_last_name,
      u.email        AS user_email,
      t.table_number,
      CONCAT('Tavolo ', t.table_number) AS table_name
    FROM reservations r
    LEFT JOIN users  u ON u.id = r.user_id
    LEFT JOIN tables t ON t.id = r.table_id
    WHERE r.id = ?
    LIMIT 1`;
  const rows = await query(sql, [id]); return rows[0] || null;
}

async function ensureUser({ first, last, email, phone }) {
  const e = trimOrNull(email), p = trimOrNull(phone);
  if (e) {
    const r = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [e]);
    if (r.length) return r[0].id;
  }
  if (p) {
    const r = await query('SELECT id FROM users WHERE phone = ? LIMIT 1', [p]);
    if (r.length) return r[0].id;
  }
  const res = await query(
    `INSERT INTO users (first_name, last_name, email, phone)
     VALUES (?, ?, ?, ?)`,
    [trimOrNull(first), trimOrNull(last), e, p]
  );
  return res.insertId;
}

async function updateUserById(id, { first, last, email, phone }) {
  if (!id) return;
  const fields = [];
  const params = [];

  if (first !== undefined && first !== null) { fields.push('first_name=?'); params.push(trimOrNull(first)); }
  if (last  !== undefined && last  !== null) { fields.push('last_name=?');  params.push(trimOrNull(last)); }
  if (email !== undefined && email !== null) { fields.push('email=?');      params.push(trimOrNull(email)); }
  if (phone !== undefined && phone !== null) { fields.push('phone=?');      params.push(trimOrNull(phone)); }

  if (!fields.length) return;
  params.push(id);
  await query(`UPDATE users SET ${fields.join(', ')} WHERE id=?`, params);
}

function normPhone(p) { return String(p || '').replace(/\D/g, ''); }
function isPhoneMatch(a, b) {
  const na = normPhone(a);
  const nb = normPhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 8 && nb.length >= 8) return na.slice(-8) === nb.slice(-8);
  return false;
}

async function syncGoogleContactOnCreate(dto, userId) {
  const phone = trimOrNull(dto.phone);
  if (!phone) return;

  let items = [];
  try {
    items = await google.searchContacts(phone, 5);
  } catch (e) {
    logger.warn('👤⚠️ [Google] search failed', { error: String(e) });
    return;
  }

  const match = (items || []).find((it) => isPhoneMatch(phone, it.phone));
  if (!match?.resourceName) return;

  // Aggiorna DB (utente locale) con dati recenti se abbiamo match Google
  try {
    await updateUserById(userId, {
      first: dto.customer_first,
      last : dto.customer_last,
      email: dto.email,
      phone: dto.phone,
    });
  } catch (e) {
    logger.warn('👤⚠️ [DB] user update failed', { error: String(e), userId });
  }

  // Aggiorna il contatto Google (best-effort)
  try {
    await google.updateContact({
      resourceName: match.resourceName,
      etag: match.etag,
      givenName: trimOrNull(dto.customer_first),
      familyName: trimOrNull(dto.customer_last),
      displayName: `${dto.customer_first || ''} ${dto.customer_last || ''}`.trim() || null,
      email: trimOrNull(dto.email),
      phone: trimOrNull(dto.phone),
      note: trimOrNull(dto.google_note) || trimOrNull(dto.notes),
    });
  } catch (e) {
    logger.warn('👤⚠️ [Google] update failed', { error: String(e), resourceName: match.resourceName });
  }
}

// ============================================================================
// ➕ CREATE
// ============================================================================

async function create(dto, { user } = {}) {
  const userId = await ensureUser({
    first: dto.customer_first,
    last : dto.customer_last,
    email: dto.email,
    phone: dto.phone,
  });

  const noteValue = trimOrNull(dto.google_note) || trimOrNull(dto.notes);
  const startIso = dto.start_at;
  const endIso   = dto.end_at || null;

  const { startMysql, endMysql } = endIso
    ? { startMysql: isoToMysql(startIso), endMysql: isoToMysql(endIso) }
    : computeEndAtFromStart(startIso);

  const res = await query(
    `INSERT INTO reservations
      (customer_first, customer_last, phone, email,
       user_id, party_size, start_at, end_at, room_id, table_id,
       notes, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`,
    [
      trimOrNull(dto.customer_first), trimOrNull(dto.customer_last),
      trimOrNull(dto.phone), trimOrNull(dto.email),
      userId, Number(dto.party_size) || 1, startMysql, endMysql,
      dto.room_id || null, dto.table_id || null,
      noteValue, trimOrNull(user?.email) || null
    ]);
  const created = await getById(res.insertId);
  logger.info('🆕 reservation created', { id: created.id, by: user?.email || null });

  // Best-effort sync: se il numero matcha un contatto Google, aggiorno DB+Google
  try {
    await syncGoogleContactOnCreate(dto, userId);
  } catch (e) {
    logger.warn('👤⚠️ [Google] sync failed', { error: String(e) });
  }

  return created;
}

// ============================================================================
// ✏️ UPDATE
// ============================================================================

async function update(id, dto, { user } = {}) {
  let userId = null;
  if (dto.customer_first !== undefined || dto.customer_last !== undefined
    || dto.email !== undefined || dto.phone !== undefined) {
    userId = await ensureUser({
      first: dto.customer_first,
      last : dto.customer_last,
      email: dto.email,
      phone: dto.phone,
    });
  }
  let startMysql = null, endMysql = null;
  if (dto.start_at) {
    const endIso = dto.end_at || null;
    const c = endIso
      ? { startMysql: isoToMysql(dto.start_at), endMysql: isoToMysql(endIso) }
      : computeEndAtFromStart(dto.start_at);
    startMysql = c.startMysql; endMysql = c.endMysql;
  }
  const fields = [], pr = [];
  if (userId !== null) { fields.push('user_id=?'); pr.push(userId); }
  if (dto.customer_first !== undefined) { fields.push('customer_first=?'); pr.push(trimOrNull(dto.customer_first)); }
  if (dto.customer_last  !== undefined) { fields.push('customer_last=?');  pr.push(trimOrNull(dto.customer_last));  }
  if (dto.phone          !== undefined) { fields.push('phone=?');          pr.push(trimOrNull(dto.phone));          }
  if (dto.email          !== undefined) { fields.push('email=?');          pr.push(trimOrNull(dto.email));          }
  if (dto.party_size     !== undefined) { fields.push('party_size=?');     pr.push(dto.party_size || 1);           }
  if (startMysql         !== null)      { fields.push('start_at=?');       pr.push(startMysql);                    }
  if (endMysql           !== null)      { fields.push('end_at=?');         pr.push(endMysql);                      }
  if (dto.room_id  !== undefined) { fields.push('room_id=?');  pr.push(dto.room_id || null); }
  if (dto.table_id !== undefined) { fields.push('table_id=?'); pr.push(dto.table_id || null); }
  if (dto.notes !== undefined || dto.google_note !== undefined) {
    fields.push('notes=?');
    pr.push(trimOrNull(dto.google_note) || trimOrNull(dto.notes));
  }
  if (dto.checkin_at  !== undefined) {
    fields.push('checkin_at=?');
    pr.push(dto.checkin_at ? isoToMysql(dto.checkin_at) : null);
  }
  if (dto.checkout_at !== undefined) {
    fields.push('checkout_at=?');
    pr.push(dto.checkout_at ? isoToMysql(dto.checkout_at) : null);
  }
  if (dto.dwell_sec   !== undefined) {
    fields.push('dwell_sec=?');
    pr.push(dto.dwell_sec == null ? null : Number(dto.dwell_sec));
  }
  fields.push('updated_by=?'); pr.push(trimOrNull(user?.email) || null);

  if (!fields.length) {
    logger.info('✏️ update: nessun campo da aggiornare', { id });
    return await getById(id);
  }
  pr.push(id);
  await query(`UPDATE reservations SET ${fields.join(', ')} WHERE id=?`, pr);
  const updated = await getById(id);
  logger.info('✏️ reservation updated', { id, by: user?.email || null });
  return updated;
}

// ============================================================================
// 🗑️ DELETE (hard, con policy) – invariato
// ============================================================================

async function remove(id, { user, reason } = {}) {
  const existing = await getById(id);
  if (!existing) return false;
  const allowAnyByEnv =
    (env.RESV && env.RESV.allowDeleteAnyStatus === true) ||
    (String(process.env.RESV_ALLOW_DELETE_ANY_STATUS || '').toLowerCase() === 'true');
  const statusNorm = String(existing.status || '').toLowerCase();
  const isCancelled = (statusNorm === 'cancelled' || statusNorm === 'canceled');
  if (!allowAnyByEnv && !isCancelled) {
    logger.warn('🛡️ hard-delete NEGATO (stato non cancellato)', { id, status: existing.status }); return false;
  }
  await query('DELETE FROM reservations WHERE id=? LIMIT 1', [id]);
  logger.info('🗑️ reservation removed', { id, by: user?.email || null, reason: reason || null });
  return true;
}

// ============================================================================
// 📊 COUNT BY STATUS
// ============================================================================

async function countByStatus({ from, to } = {}) {
  const where = [];
  const params = [];
  const range = toDayRange(from, to);
  if (range.from) { where.push('r.start_at >= ?'); params.push(range.from); }
  if (range.to)   { where.push('r.start_at <= ?'); params.push(range.to);   }
  const sql = `
    SELECT r.status, COUNT(*) AS count
    FROM reservations r
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY r.status
  `;
  const rows = await query(sql, params);
  const out = { pending: 0, accepted: 0, cancelled: 0 };
  for (const r of rows) {
    const s = String(r.status || '').toLowerCase();
    if (s === 'pending') out.pending = r.count;
    else if (s === 'accepted') out.accepted = r.count;
    else if (s === 'cancelled' || s === 'canceled') out.cancelled = r.count;
  }
  return out;
}

// ============================================================================
// 📚 ROOMS / TABLES
// ============================================================================

async function listRooms() {
  const sql = `
    SELECT id, name, description
    FROM rooms
    WHERE is_active = 1
    ORDER BY sort_order ASC, id ASC
  `;
  return await query(sql, []);
}

async function listTablesByRoom(roomId) {
  const sql = `
    SELECT id, room_id, table_number, capacity, is_active
    FROM tables
    WHERE room_id = ?
    ORDER BY table_number ASC, id ASC
  `;
  return await query(sql, [roomId]);
}

// ============================================================================
// 🪑 Assegnazione tavolo
// ============================================================================

async function assignReservationTable(id, tableId, { user } = {}) {
  await query(
    `UPDATE reservations
        SET table_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? LIMIT 1`,
    [tableId || null, trimOrNull(user?.email) || null, id]
  );
  const updated = await getById(id);
  logger.info('🪑 reservation table assigned', { id, table_id: tableId, by: user?.email || null });
  return updated;
}

// Alias più leggibile lato chiamante
const changeTable = assignReservationTable;

// ============================================================================
// ✅ Cambio stato “semplice” (non usa state-machine avanzata)
// ============================================================================

async function updateStatus(id, actionOrStatus, { user } = {}) {
  const existing = await getById(id);
  if (!existing) return null;
  const { nextStatus } = normalizeStatusAction(actionOrStatus);
  if (!nextStatus) {
    logger.warn('⚠️ updateStatus: stato non valido', { id, actionOrStatus });
    return existing;
  }
  await query(
    `UPDATE reservations
        SET status = ?, status_changed_at = CURRENT_TIMESTAMP, updated_by = ?
      WHERE id = ? LIMIT 1`,
    [nextStatus, trimOrNull(user?.email) || null, id]
  );
  const updated = await getById(id);
  logger.info('🔁 reservation status updated', {
    id,
    from: existing.status,
    to  : updated.status,
    by  : user?.email || null
  });
  return updated;
}

// ============================================================================
// 🕒 Check-in / Check-out
// ============================================================================

async function checkIn(id, { at, user } = {}) {
  const existing = await getById(id);
  if (!existing) return null;

  const checkin_at_mysql = isoToMysql(at || new Date()) || null;

  await query(
    `UPDATE reservations
        SET checkin_at = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
      WHERE id = ? LIMIT 1`,
    [checkin_at_mysql, trimOrNull(user?.email) || null, id]
  );

  const updated = await getById(id);
  logger.info('✅ reservation check-in', {
    id,
    at     : updated.checkin_at,
    by     : user?.email || null,
    status : updated.status,
  });
  return updated;
}

async function checkOut(id, { at, user } = {}) {
  const existing = await getById(id);
  if (!existing) return null;

  // Orario di checkout: se non passo nulla → adesso
  const checkoutDate = at ? new Date(at) : new Date();
  const checkout_at_mysql = isoToMysql(checkoutDate) || null;

  // dwell_sec (in secondi) se ho un checkin_at valido
  let dwell_sec = null;
  if (existing.checkin_at) {
    const startMs = new Date(existing.checkin_at).getTime();
    const endMs   = checkoutDate.getTime();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
      dwell_sec = Math.max(0, Math.floor((endMs - startMs) / 1000));
    }
  }

  // Costruisco SQL + parametri mantenendo il tuo stile
  const params = [checkout_at_mysql, trimOrNull(user?.email) || null];
  let SQL = `
    UPDATE reservations
       SET checkout_at = ?,
           updated_at  = CURRENT_TIMESTAMP,
           updated_by  = ?`;

  if (dwell_sec !== null) {
    SQL += `,
           dwell_sec   = ?`;
    params.push(dwell_sec);
  }

  SQL += `
     WHERE id = ? LIMIT 1`;
  params.push(id);

  await query(SQL, params);

  const updated = await getById(id);
  logger.info('✅ reservation check-out', {
    id,
    at     : updated.checkout_at,
    dwell  : updated.dwell_sec,
    by     : user?.email || null,
    status : updated.status,
  });
  return updated;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  list,
  getById,
  create,
  update,
  updateStatus,
  remove,
  countByStatus,
  listRooms,
  listTablesByRoom,
  // 🆕
  assignReservationTable,
  changeTable,
  checkIn,
  checkOut,
};
```

### ./src/services/reservations-status.service.js
```
// src/services/reservations-status.service.js
// ----------------------------------------------------------------------------
// State machine per le prenotazioni + persistenza su DB.
// - Interfaccia: updateStatus({ id, action, reason?, user_email? })
// - Compat FE: confirm/confirmed → accepted (badge verde); cancel/* → cancelled (badge visibile)
// - UPDATE dinamica solo su colonne realmente presenti (status_note / reason, status_changed_at, updated_*)
// - Alias compat: updateReservationStatus(...) → updateStatus(...)
// ----------------------------------------------------------------------------

'use strict';

const { query } = require('../db');
const logger    = require('../logger');

// Azioni consentite (accettiamo sia verbi sia stati finali)
const ALLOWED = new Set([
  'accept','accepted',
  'confirm','confirmed',       // → accepted
  'arrive','arrived',
  'reject','rejected',
  'cancel','canceled','cancelled', // → cancelled (UK) per compat FE badge
  'prepare','preparing',
  'ready',
  'complete','completed',
  'no_show','noshow'
]);

// Normalizzazione: azione → stato DB
const MAP = {
  accept     : 'accepted',
  confirm    : 'accepted',
  confirmed  : 'accepted',
  arrive     : 'arrived',
  reject     : 'rejected',
  cancel     : 'cancelled',
  cancelled  : 'cancelled',
  canceled   : 'cancelled',
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

// Cache colonne
const _colsCache = new Map();
async function columnsOf(table = 'reservations') {
  if (_colsCache.has(table)) return _colsCache.get(table);
  const rows = await query(
    `SELECT COLUMN_NAME AS name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  const set = new Set(rows.map(r => r.name));
  _colsCache.set(table, set);
  return set;
}

/**
 * Aggiorna lo stato e ritorna la riga aggiornata.
 * - Scrive status_note (se esiste) o reason (fallback) solo se reason è valorizzato.
 * - Aggiorna status_changed_at/updated_* solo se esistono.
 */
async function updateStatus({ id, action, reason = null, user_email = 'system' }) {
  const rid = Number(id);
  if (!rid || !action) throw new Error('missing_id_or_action');

  const newStatus = toStatus(action);
  const cols = await columnsOf('reservations');

  const set = [];
  const pr  = [];

  set.push('status = ?'); pr.push(newStatus);

  const hasReason = reason !== null && reason !== undefined && String(reason).trim() !== '';
  if (hasReason) {
    if (cols.has('status_note')) {
      set.push('status_note = COALESCE(?, status_note)'); pr.push(reason);
    } else if (cols.has('reason')) {
      set.push('reason = COALESCE(?, reason)');           pr.push(reason);
    }
  }

  if (cols.has('status_changed_at')) set.push('status_changed_at = CURRENT_TIMESTAMP');
  if (cols.has('updated_at'))        set.push('updated_at = CURRENT_TIMESTAMP');
  if (cols.has('updated_by'))       { set.push('updated_by = ?'); pr.push(user_email); }

  if (!set.length) throw new Error('no_fields_to_update');

  pr.push(rid);
  const sql = `UPDATE reservations SET ${set.join(', ')} WHERE id = ? LIMIT 1`;
  const res = await query(sql, pr);
  if (!res?.affectedRows) throw new Error('reservation_not_found');

  logger.info('🧾 RESV.status ✅ updated', { id: rid, newStatus, usedCols: set.map(s => s.split('=')[0].trim()) });

  const rows = await query('SELECT * FROM reservations WHERE id = ?', [rid]);
  return rows[0] || null;
}

// Alias compat per vecchi import
const updateReservationStatus = (args) => updateStatus(args);

module.exports = { updateStatus, updateReservationStatus };
```

### ./src/services/thermal-printer.service.js
```
// server/src/services/thermal-printer.service.js
// Stampa termica: daily, placecards multipli e singolo segnaposto.
// Mantengo lo stile e NON sovrascrivo la tua logica ordini: provo le API esistenti
// e, se mancano i metodi “placecard”, uso un fallback ESC/POS in solo testo
// (niente QR/immagini → massima compatibilità). Formattazione tipo utils/print.js.
// 🆕 Opzioni compatibili (ENV): PRINTER_CODEPAGE, PRINTER_WIDTH_MM / PRINTER_COLS,
// PRINTER_DAILY_GROUPED, PRINTER_LOGO_PATH (PNG), BIZ_TZ, DB_TIME_IS_UTC,
// PRINTER_QR_SIZE, PRINTER_QR_ECC, PRINTER_TOP_PAD_LINES, PRINTER_BOTTOM_PAD_LINES,
// PRINTER_HEADER_FEED_BEFORE, PRINTER_FOOTER_FEED_AFTER, PRINTER_DEBUG_HEX,
// PRINTER_QR_MODE (auto|escpos|raster), PRINTER_QR_SCALE, PRINTER_TIME_DATE_SEP.

'use strict';

const fs     = require('fs');
const path   = require('path');
const net    = require('net');
const logger = require('../logger');
const env    = require('../env');

// opzionali: codepage + PNG (fallback automatici se non installati)
let iconv;
try { iconv = require('iconv-lite'); } catch { iconv = null; }
let PNGjs;
try { ({ PNG: PNGjs } = require('pngjs')); } catch (e) { PNGjs = null; }
// opzionale per QR raster
let QRLib;
try { QRLib = require('qrcode'); } catch (e) { QRLib = null; }

// Se hai già un order-printer service, lo riuso:
let orderPrinter;
try { orderPrinter = require('./order-printer.service'); }
catch { orderPrinter = null; }

/* ───────────────────────────────── Helpers ───────────────────────────────── */

function toISO(x) {
  if (!x) return '';
  if (x instanceof Date) return x.toISOString();
  if (typeof x === 'string') return x;
  if (typeof x === 'number') { const d = new Date(x); return isNaN(d) ? '' : d.toISOString(); }
  const s = x?.date || x?.day || x?.ymd || '';
  return typeof s === 'string' ? s : '';
}
function toYMD(x) {
  const iso = toISO(x) || new Date().toISOString();
  return String(iso).slice(0, 10); // YYYY-MM-DD
}
function timeHM(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${hh}:${mm}`;
}

// ASCII “safe”: rimpiazza caratteri fuori 0x20..0x7E (evita problemi codepage)
function asciiSafe(s) { return String(s || '').replace(/[^\x20-\x7E]/g, '?'); }

// Colonne: 80mm≈48, 58mm≈42/32 — override con PRINTER_COLS se vuoi forzare
const WIDTH_MM = Number(process.env.PRINTER_WIDTH_MM || 80);
const COLS = Number(process.env.PRINTER_COLS || (WIDTH_MM >= 70 ? 48 : 42));

// Padding a larghezza fissa (default 42/48 colonne)
function padLine(left, right, width = COLS) {
  let L = asciiSafe(String(left || ''));
  let R = asciiSafe(String(right || ''));
  const maxLeft = Math.max(0, width - (R.length + 1));
  if (L.length > maxLeft) {
    L = (maxLeft > 3) ? (L.slice(0, maxLeft - 3) + '...') : L.slice(0, maxLeft);
  }
  const spaces = Math.max(1, width - (L.length + R.length));
  return L + ' '.repeat(spaces) + R;
}

const ESC = 0x1b, GS = 0x1d;
function cmdInit()         { return Buffer.from([ESC, 0x40]); }            // ESC @
function cmdAlign(n=0)     { return Buffer.from([ESC, 0x61, n]); }         // 0=left 1=center 2=right
function cmdMode(n=0)      { return Buffer.from([ESC, 0x21, n]); }         // bitmask stile testo
function cmdLF(n=1)        { return Buffer.from(Array(n).fill(0x0a)); }
function cmdCut(full=true) { return Buffer.from([GS, 0x56, full ? 0x00 : 0x01]); }

// feed n righe (padding preciso)
function cmdFeed(n = 0) {
  const nn = Math.max(0, Math.min(255, Number(n)||0));
  return Buffer.from([ESC, 0x64, nn]);
}

// dimensione h/w 1..8 (GS ! v) — compat ampiezza/altezza
function cmdSize(w = 1, h = 1) {
  const W = Math.max(1, Math.min(8, w));
  const H = Math.max(1, Math.min(8, h));
  const v = ((W - 1) << 4) | (H - 1);
  return Buffer.from([GS, 0x21, v]);
}

// Codepage (default cp858) + encode
const CODEPAGE = (process.env.PRINTER_CODEPAGE || 'cp858').toLowerCase();
function selectCodepageBuffer() {
  const map = { cp437:0, cp850:2, cp852:18, cp858:19, cp1252:16 };
  const n = map[CODEPAGE] ?? 19;
  return Buffer.from([ESC, 0x74, n]);
}
function encodeText(s) {
  const plain = String(s || '').replace(/\r/g, '');
  // ➜ fallback latin1: così caratteri base restano stampabili (niente bullet)
  if (!iconv) return Buffer.from(plain, 'latin1');
  try { return iconv.encode(plain, CODEPAGE, { addBOM:false }); }
  catch { return Buffer.from(plain, 'latin1'); }
}
function line(s='') { return Buffer.concat([ encodeText(s), Buffer.from([0x0a]) ]); }
// testo senza newline (per comporre righe miste con grandezze diverse)
function text(s='') { return encodeText(s); }

// Intestazioni/piedi da ENV o env.PRINTER
function readHeaderLines() {
  const raw = env.PRINTER?.header ?? process.env.PRINTER_HEADER ?? '';
  return String(raw).split('|').filter(Boolean);
}
function readFooterLines() {
  const raw = env.PRINTER?.footer ?? process.env.PRINTER_FOOTER ?? '';
  return String(raw).split('|').filter(Boolean);
}

function socketWrite(sock, chunk) {
  return new Promise((res, rej) => sock.write(chunk, (err) => err ? rej(err) : res()));
}

/**
 * withPrinter: gestisce connessione + header/footer + cut.
 * NB: header/footer via ENV; imposta anche codepage se disponibile.
 * 🆕: feed configurabili prima dell'header e dopo il footer (prima del cut).
 */
async function withPrinter(io, fn) {
  if (!env.PRINTER?.enabled && String(process.env.PRINTER_ENABLED).toLowerCase()!=='true') {
    logger.warn('🖨️ PRINTER disabled by env'); return { jobId:`noop-${Date.now()}`, printedCount:0 };
  }
  const ip   = env.PRINTER?.ip   || process.env.PRINTER_IP;
  const port = Number(env.PRINTER?.port || process.env.PRINTER_PORT || 9100);
  if (!ip || !port) { logger.warn('🖨️ PRINTER not configured'); return { jobId:`noop-${Date.now()}`, printedCount:0 }; }

  const sock = new net.Socket();
  await new Promise((res, rej) => {
    sock.once('error', rej);
    sock.connect(port, ip, () => { sock.off('error', rej); res(); });
  });

  const HEADER_FEED_BEFORE = Number(process.env.PRINTER_HEADER_FEED_BEFORE || 0);
  const FOOTER_FEED_AFTER  = Number(process.env.PRINTER_FOOTER_FEED_AFTER  || 4);

  try {
    await socketWrite(sock, cmdInit());
    await socketWrite(sock, selectCodepageBuffer());

    // Header (centrato)
    const headerLines = readHeaderLines();
    if (headerLines.length) {
      if (HEADER_FEED_BEFORE > 0) await socketWrite(sock, cmdFeed(HEADER_FEED_BEFORE));
      await socketWrite(sock, cmdAlign(1));
      for (const l of headerLines) { await socketWrite(sock, line(l)); }
      await socketWrite(sock, cmdLF(1));
      await socketWrite(sock, cmdAlign(0));
    }

    const out = await fn(sock);

    // Footer (centrato)
    const footerLines = readFooterLines();
    if (footerLines.length) {
      await socketWrite(sock, cmdLF(1));
      await socketWrite(sock, cmdAlign(1));
      for (const l of footerLines) { await socketWrite(sock, line(l)); }
      await socketWrite(sock, cmdAlign(0));
    }

    // 🆕 extra feed sotto il footer prima del taglio (evita che "salga" sul successivo)
    if (FOOTER_FEED_AFTER > 0) await socketWrite(sock, cmdFeed(FOOTER_FEED_AFTER));

    const doCut = (env.PRINTER?.cut ?? String(process.env.PRINTER_CUT||'true').toLowerCase()==='true');
    if (doCut) { await socketWrite(sock, cmdCut(true)); }
    sock.end();
    return out || { jobId:`job-${Date.now()}`, printedCount:0 };
  } catch (e) {
    try { sock.end(); } catch {}
    throw e;
  }
}

/* ─────────────── Opzioni avanzate opzionali (TZ, QR, PNG) ─────────────── */

const DISPLAY_TZ     = process.env.BIZ_TZ || 'Europe/Rome';
const DB_TIME_IS_UTC = String(process.env.DB_TIME_IS_UTC || 'false') === 'true';
const DAILY_GROUPED  = String(process.env.PRINTER_DAILY_GROUPED ?? 'true') !== 'false'; // default true

const TOP_PAD_LINES    = Number(process.env.PRINTER_TOP_PAD_LINES || 2);
const BOTTOM_PAD_LINES = Number(process.env.PRINTER_BOTTOM_PAD_LINES || 4);

// QR
const QR_BASE_URL     = (process.env.QR_BASE_URL || '').trim();
const QR_SIZE_ENV     = Number(process.env.PRINTER_QR_SIZE || 5);
// ✅ ECC corretto: L=48, M=49, Q=50, H=51
const QR_ECC_ENV      = String(process.env.PRINTER_QR_ECC || 'H').toUpperCase();
const QR_CAPTION_GAP  = Number(process.env.PRINTER_QR_CAPTION_GAP_LINES || 1);
const DEBUG_HEX       = String(process.env.PRINTER_DEBUG_HEX || '').toLowerCase() === 'true';
// 🆕: di default imposto raster (più compatibile sulle stampanti economiche)
const QR_MODE         = String(process.env.PRINTER_QR_MODE || 'raster').toLowerCase(); // auto|escpos|raster
const QR_SCALE        = Math.max(1, Math.min(12, Number(process.env.PRINTER_QR_SCALE || 4)));
const TIME_DATE_SEP   = (process.env.PRINTER_TIME_DATE_SEP ?? '  -  '); // ← niente bullet ‘•’

const MAX_DOTS = WIDTH_MM >= 70 ? 576 : 384; // raster approx

function parseDbDate(s) {
  const str = String(s || '').trim();
  if (!str) return new Date(NaN);
  if (str.includes('T')) return new Date(str);
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

// Raster PNG (opzionale)
function buildRasterFromPNG(png, maxWidthDots = MAX_DOTS, threshold = 200) {
  const targetW = Math.min(maxWidthDots, png.width);
  const ratio   = targetW / png.width;
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
  return Buffer.concat([Buffer.from([GS, 0x76, 0x30, m, xL, xH, yL, yH]), bmp, Buffer.from([0x0a])]);
}

let LOGO_RASTER = null;
(function preloadLogo() {
  try {
    const logoPath = process.env.PRINTER_LOGO_PATH || 'assets/logo.png';
    const abs = path.resolve(process.cwd(), logoPath);
    if (PNGjs && fs.existsSync(abs)) {
      const buf = fs.readFileSync(abs);
      const png = PNGjs.sync.read(buf);
      const raster = buildRasterFromPNG(png, Math.floor(MAX_DOTS * 0.85), 190);
      LOGO_RASTER = Buffer.concat([cmdAlign(1), raster, cmdLF(1)]);
      logger.info(`🖼️ Logo caricato: ${abs}`);
    }
  } catch (e) {
    logger.warn('Logo PNG non caricabile', { msg: String(e?.message || e) });
  }
})();

// ──────────────────────── QR ESC/POS (Model 2) ──────────────────────────────
function qrSelectModel2() { return Buffer.from([GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]); }
function qrStoreData(data) {
  const payload = Buffer.from(String(data || ''), 'ascii'); // URL → ASCII puro
  const len = payload.length + 3;
  const pL = len & 0xff, pH = (len >> 8) & 0xff;
  return Buffer.from([GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30, ...payload]);
}
function qrSetModuleSize(size = 6) {
  const s = Math.max(1, Math.min(16, size));
  return Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, s]);
}
function qrSetECCFromEnv() {
  const map = { L: 48, M: 49, Q: 50, H: 51 };
  const lv = map[QR_ECC_ENV] ?? 51;
  return Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, lv]);
}
function qrPrint() { return Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]); }

// Nome adattivo su una riga (cartellini)
function printAdaptiveName(buffers, name, maxCols = COLS) {
  const txt = up(name || '');
  const widths = [3, 2, 1]; // prova 3x → 2x → 1x (altezza fissa 2)
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
  buffers.push(cmdSize(chosenW, H), cmdAlign(1), line(shown), cmdAlign(0), cmdSize(1,1));
}

/* ─────────────── FUNZIONI ADEGUATE ALLO STILE “VECCHIO” ─────────────── */

/**
 * 🗒️ Stampa giornaliera prenotazioni (formato testo tipo print.js)
 * - intestazione "Prenotazioni <giorno umano>"
 * - separatori a COLS colonne
 * - modalità:
 *   • grouped (default): blocchi per HH:mm con titolo grande centrato
 *   • flat: tabellare con ORA/TAV/PAX/NOME (+ phone/notes su righe successive)
 * - niente simbolo euro (compat codepage)
 */
async function printDailyReservations(args) {
  // (1) Riuso modulo esterno se disponibile (non tocco la tua logica)
  if (orderPrinter?.printDailyReservations) {
    return await orderPrinter.printDailyReservations(args);
  }

  const date = toYMD(args?.date);
  const rows = Array.isArray(args?.rows) ? args.rows : [];

  return await withPrinter({}, async (sock) => {
    const sep = '-'.repeat(COLS);

    // Titolo
    await socketWrite(sock, cmdAlign(1));
    await socketWrite(sock, cmdMode(0x08)); // bold
    await socketWrite(sock, line('PRENOTAZIONI'));
    await socketWrite(sock, cmdMode(0x00));
    await socketWrite(sock, line(formatYmdHuman(date).toUpperCase()));
    await socketWrite(sock, cmdAlign(0));
    await socketWrite(sock, line(sep));

    let printed = 0;

    if (DAILY_GROUPED) {
      // Raggruppo per orario (nel fuso DISPLAY_TZ)
      const groups = new Map();
      for (const r of rows) {
        const t = formatTimeHHmm(r.start_at);
        if (!groups.has(t)) groups.set(t, []);
        groups.get(t).push(r);
      }
      const keys = Array.from(groups.keys()).sort((a,b) => a.localeCompare(b));

      for (const k of keys) {
        const list = groups.get(k) || [];
        await socketWrite(sock, cmdAlign(1));
        await socketWrite(sock, cmdSize(2,2));
        await socketWrite(sock, line(k));
        await socketWrite(sock, cmdSize(1,1));
        await socketWrite(sock, cmdAlign(0));
        await socketWrite(sock, line(sep));

        list.sort((a,b) => (a.table_number ?? a.table_id ?? 0) - (b.table_number ?? b.table_id ?? 0));

        for (const r of list) {
          const tavNum = (r.table_number ?? r.table_id ?? '').toString();
          const pax    = (r.party_size || '-').toString();
          const name   = ((r.customer_first || '') + ' ' + (r.customer_last || '')).trim() || '—';

          // Blocco sinistro: "T" normale + numero grande (2x2 bold) + due spazi
          const leftVisualCols = 2 /*"T "*/ + 2 /*num 2x width*/ + 2 /*gap*/;

          // Prima riga: T + numero grande + prima parte nome
          await socketWrite(sock, text('T '));
          await socketWrite(sock, cmdMode(0x08));
          await socketWrite(sock, cmdSize(2,2));
          await socketWrite(sock, text(tavNum || '-'));
          await socketWrite(sock, cmdSize(1,1));
          await socketWrite(sock, cmdMode(0x00));
          await socketWrite(sock, text('  ')); // gap visivo

          const w1 = Math.max(1, COLS - leftVisualCols);
          const first = name.slice(0, w1);
          await socketWrite(sock, line(first));

          // Seconda riga: rientro e resto del nome / info
          const remain = name.slice(w1).trim();
          if (remain) await socketWrite(sock, line(' '.repeat(leftVisualCols) + remain));
          if (r.phone) await socketWrite(sock, line(' '.repeat(leftVisualCols) + String(r.phone)));
          if (r.notes) await socketWrite(sock, line(' '.repeat(leftVisualCols) + ('NOTE: ' + r.notes)));
          await socketWrite(sock, cmdLF(1));
          printed++;
        }
        await socketWrite(sock, line(sep));
      }
    } else {
      // Flat tabellare
      const head =
        'ORA  ' + 'TAV  ' + 'PAX ' + 'NOME'.padEnd(Math.max(4, COLS - ('ORA  TAV  PAX '.length)));
      await socketWrite(sock, cmdMode(0x08));
      await socketWrite(sock, line(head));
      await socketWrite(sock, cmdMode(0x00));
      await socketWrite(sock, line(sep));

      rows.sort((a,b) => String(a.start_at).localeCompare(String(b.start_at)));

      for (const r of rows) {
        const time = formatTimeHHmm(r.start_at);
        const tav  = (r.table_number ?? r.table_id ?? '-').toString().padEnd(4, ' ');
        const pax  = (r.party_size || '-').toString().padEnd(3, ' ');
        const name = ((r.customer_first || '') + ' ' + (r.customer_last || '')).trim() || '—';

        const left = `${time}  ${tav} ${pax}`;
        const width = Math.max(1, COLS - left.length - 1);
        const first = name.slice(0, width);
        await socketWrite(sock, line(left + ' ' + first));

        const remain = name.slice(width).trim();
        if (remain) await socketWrite(sock, line(' '.repeat(left.length + 1) + remain));
        if (r.phone) await socketWrite(sock, line(' '.repeat(left.length + 1) + String(r.phone)));
        if (r.notes) await socketWrite(sock, line(' '.repeat(left.length + 1) + ('NOTE: ' + r.notes)));
        await socketWrite(sock, cmdLF(1));
        printed++;
      }
      await socketWrite(sock, line(sep));
    }

    await socketWrite(sock, cmdAlign(1));
    await socketWrite(sock, line(`Operatore: ${args?.user?.email || 'sistema'}`));
    await socketWrite(sock, cmdAlign(0));
    return { jobId: `daily-${Date.now()}`, printedCount: printed };
  });
}

/**
 * 🪪 Stampa segnaposti in batch (formato testo vecchio)
 * - Prova riuso modulo esterno; se non c'è, chiama printSinglePlaceCard per ogni riga
 * - Ritorna jobId di batch + printedCount
 */
async function printPlaceCards(args) {
  // (1) Riuso modulo esterno, se presente
  if (orderPrinter?.printPlaceCards) {
    return await orderPrinter.printPlaceCards(args);
  }

  // (2) Se esiste solo il “singolo”, vado in batch manuale
  if (orderPrinter?.printSinglePlaceCard || orderPrinter?.printPlacecardOne || orderPrinter?.printPlaceCardOne) {
    const rows = Array.isArray(args?.rows) ? args.rows : [];
    let count = 0;
    for (const r of rows) {
      await printSinglePlaceCard({ reservation: r, user: args?.user, logoText: args?.logoText, qrBaseUrl: args?.qrBaseUrl });
      count++;
    }
    return { jobId: `placecards-${Date.now()}`, printedCount: count };
  }

  // (3) Fallback: batch tramite singolo “nostro”
  const rows = Array.isArray(args?.rows) ? args.rows : [];
  let count = 0;
  for (const r of rows) {
    await printSinglePlaceCard({ reservation: r, user: args?.user, logoText: args?.logoText, qrBaseUrl: args?.qrBaseUrl });
    count++;
  }
  return { jobId: `placecards-${Date.now()}`, printedCount: count };
}

/**
 * 🎴 Singolo segnaposto (fallback stile vecchio)
 * - Nome centrato in grande (doppia altezza, adattivo 3x/2x/1x + ellissi)
 * - Riga sotto: "(coperti)  Sala" se presente
 * - Logo PNG centrato (se PRINTER_LOGO_PATH presente e pngjs disponibile)
 * - QR opzionale: usa qrBaseUrl oppure QR_BASE_URL (ENV)
 * - Usa top/bottom pad da env: PRINTER_TOP_PAD_LINES / PRINTER_BOTTOM_PAD_LINES
 * - 🆕 Log di debug delle variabili interpolate (tavolo/qr/etc.)
 */
async function printSinglePlaceCard({ reservation, user, logoText, qrBaseUrl }) {
  // (1) Metodi nativi esistenti: non tocco la tua logica
  if (orderPrinter?.printSinglePlaceCard) {
    const out = await orderPrinter.printSinglePlaceCard({ reservation, user, logoText, qrBaseUrl });
    return { jobId: out?.jobId || `placecard-${reservation?.id}-${Date.now()}` };
  }
  if (orderPrinter?.printPlacecardOne) {
    const out = await orderPrinter.printPlacecardOne({ reservation, user, logoText, qrBaseUrl });
    return { jobId: out?.jobId || `placecard-${reservation?.id}-${Date.now()}` };
  }
  if (orderPrinter?.printPlaceCardOne) {
    const out = await orderPrinter.printPlaceCardOne({ reservation, user, logoText, qrBaseUrl });
    return { jobId: out?.jobId || `placecard-${reservation?.id}-${Date.now()}` };
  }

  // (2) Fallback testuale con formattazione tipo utils/print.js
  const name = (reservation?.display_name || `${reservation?.customer_first||''} ${reservation?.customer_last||''}` || 'Cliente').trim();
  const cov  = Number(reservation?.party_size || reservation?.covers || 0) || 1;

  // Tavolo robusto: primo definito
  const tableNum  = (reservation?.table_number ?? reservation?.table_id ?? null);
  const tableName = reservation?.table_name || null;
  const tavNumberOnly = (tableNum !== null && tableNum !== '') ? String(tableNum) : (tableName || '');

  const sala = reservation?.room_name || reservation?.room || reservation?.room_id || '';

  // Log dettagliato dei valori interpolati
  logger.info('🧩 placecard vars', {
    id: reservation?.id || null,
    name, cov,
    table_number: reservation?.table_number ?? null,
    table_id: reservation?.table_id ?? null,
    table_name: reservation?.table_name ?? null,
    tavNumberOnly: tavNumberOnly,
    room_name: reservation?.room_name ?? null,
    qr_base_env: QR_BASE_URL || '',
    qr_base_arg: qrBaseUrl || '',
    cols: COLS
  });

  return await withPrinter({}, async (sock) => {
    await socketWrite(sock, cmdAlign(1));
    if (TOP_PAD_LINES > 0) await socketWrite(sock, cmdFeed(TOP_PAD_LINES));

    if (LOGO_RASTER) { await socketWrite(sock, LOGO_RASTER); }

    // 🆕 SOLO NUMERO TAVOLO — enorme e bold (8x8). Se non c'è, non stampo nulla qui.
    if (tavNumberOnly) {
      await socketWrite(sock, cmdMode(0x08));       // bold
      await socketWrite(sock, cmdSize(8,8));        // enorme
      await socketWrite(sock, line(up(String(tavNumberOnly))));
      await socketWrite(sock, cmdSize(1,1));
      await socketWrite(sock, cmdMode(0x00));
    }

    // Nome grande adattivo
    const buffers = [];
    printAdaptiveName(buffers, name, COLS);
    for (const b of buffers) await socketWrite(sock, b);

    // Sotto-riga informativa
    const infoParts = [`(${cov})`];
    if (sala) infoParts.push(`SALA ${sala}`);
    await socketWrite(sock, line(infoParts.join('  ')));

    // Data/ora (in TZ)  — separatore ASCII, niente “•”
    const startAt = String(reservation?.start_at || '');
    const d = parseDbDate(startAt);
    await socketWrite(sock, line(formatTimeHHmm(startAt) + TIME_DATE_SEP + formatDateHuman(d)));

    // QR opzionale
    const base = (qrBaseUrl || QR_BASE_URL || '').replace(/\/+$/,'');
    if (!base) {
      logger.warn('🔳 QR skipped: base URL vuota (QR_BASE_URL o qrBaseUrl non impostati)');
    } else {
      const url = base + '/';
      logger.info('🔳 QR params', { mode: QR_MODE, size: QR_SIZE_ENV, scale: QR_SCALE, ecc: QR_ECC_ENV, url });

      const wantRaster = (QR_MODE === 'raster') || (QR_MODE === 'auto' && QRLib && PNGjs);
      let didRaster = false;

      if (wantRaster) didRaster = await tryPrintQrAsRaster(sock, url);

      if (!didRaster && QR_MODE !== 'raster') {
        // Provo ESC/POS model 2 (alcune stampanti non lo supportano)
        const seq = [
          cmdAlign(1),
          (QR_CAPTION_GAP > 0 ? cmdFeed(QR_CAPTION_GAP) : Buffer.alloc(0)),
          qrSelectModel2(),
          qrSetModuleSize(QR_SIZE_ENV),
          qrSetECCFromEnv(),
          qrStoreData(url),
          qrPrint(),
          cmdAlign(0),
          cmdLF(1),
        ];
        if (DEBUG_HEX) {
          const hex = Buffer.concat(seq).toString('hex').slice(0, 200);
          logger.info('🔬 QR bytes (head)', { hex });
        }
        for (const part of seq) await socketWrite(sock, part);
      }

      if (!didRaster && QR_MODE === 'raster') {
        // raster richiesto ma non disponibile
        logger.warn('🔳 QR raster non disponibile: installa "qrcode" (npm i qrcode)');
        await socketWrite(sock, line(url)); // almeno l’URL in chiaro
      } else if (didRaster) {
        await socketWrite(sock, cmdLF(1));
      }
    }

    if (BOTTOM_PAD_LINES > 0) await socketWrite(sock, cmdFeed(BOTTOM_PAD_LINES));
    return { jobId: `placecard-${reservation?.id || 'na'}-${Date.now()}` };
  });
}

// Rasterizza un QR usando la lib "qrcode" + stampa come immagine (ESC/POS raster).
async function tryPrintQrAsRaster(sock, url) {
  if (!QRLib || !PNGjs) return false;
  try {
    const eccMap = { L:'L', M:'M', Q:'Q', H:'H' };
    const ecc = eccMap[QR_ECC_ENV] || 'H';
    const pngBuf = await QRLib.toBuffer(url, {
      errorCorrectionLevel: ecc,
      margin: 0,
      scale: QR_SCALE, // dimensione modulare
      type: 'png',
    });
    const png = PNGjs.sync.read(pngBuf);
    const raster = buildRasterFromPNG(png, Math.floor(MAX_DOTS * 0.7), 160);
    await socketWrite(sock, cmdAlign(1));
    await socketWrite(sock, raster);
    await socketWrite(sock, cmdAlign(0));
    return true;
  } catch (e) {
    logger.warn('🔳 QR raster generation failed', { msg: String(e?.message || e) });
    return false;
  }
}

/* ─────────────────────────────── EXPORTS ─────────────────────────────── */

module.exports = {
  printDailyReservations,
  printPlaceCards,
  printSinglePlaceCard,
};
```

### ./src/services/voucher-notify.service.js
```
// ============================================================================
// voucher-notify.service.js
// - Email + SMS conferma attivazione buono regalo (best-effort)
// - Stile: commenti 🇮🇹 + log con emoji
// ============================================================================

'use strict';

const nodemailer = require('nodemailer');
const logger = require('../logger');
const env = require('../env');
const wa = require('./whatsapp.service');

let _transport = null;
function getTransporter() {
  if (!env.MAIL?.enabled) return null;
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host  : env.MAIL.host,
    port  : Number(env.MAIL.port || 587),
    secure: !!env.MAIL.secure,
    auth  : { user: env.MAIL.user, pass: env.MAIL.pass },
  });
  return _transport;
}

function fmtDateIt(isoLike) {
  try {
    const d = isoLike ? new Date(isoLike) : new Date();
    if (Number.isNaN(d.getTime())) return String(isoLike || '');
    return new Intl.DateTimeFormat('it-IT', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return String(isoLike || '');
  }
}

function buildOptOutUrl(params = {}) {
  const base =
    process.env.PUBLIC_BASE_URL ||
    env.WA?.webhookBaseUrl ||
    '';
  if (!base) return null;
  const qp = new URLSearchParams();
  if (params.email) qp.set('email', String(params.email));
  if (params.phone) qp.set('phone', String(params.phone));
  if (params.channel) qp.set('channel', String(params.channel));
  return `${base.replace(/\/+$/, '')}/optout?${qp.toString()}`;
}

function buildOptInUrl(token) {
  const base =
    process.env.PUBLIC_BASE_URL ||
    env.WA?.webhookBaseUrl ||
    '';
  if (!base || !token) return null;
  const qp = new URLSearchParams({ token: String(token) });
  return `${base.replace(/\/+$/, '')}/optin?${qp.toString()}`;
}

async function sendActivationEmail({ to, voucher, contact }) {
  if (!env.MAIL?.enabled) {
    logger.warn('📧 [Voucher] email skipped (disabled)');
    return { ok: false, reason: 'disabled' };
  }
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  const t = getTransporter();
  if (!t) return { ok: false, reason: 'no_transporter' };

  const biz = env.MAIL?.bizName || 'La tua attività';
  const subject = `${biz} — Attivazione Buono Regalo`;
  const name = [contact?.customer_first, contact?.customer_last].filter(Boolean).join(' ') || 'Cliente';
  const valueEUR = (Number(voucher?.value_cents || 0) / 100).toFixed(2);
  const validUntil = voucher?.valid_until ? fmtDateIt(voucher.valid_until) : '';
  const optUrl = buildOptOutUrl({ email: dest, channel: 'email' });

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0 0 12px">${biz}</h2>
    <p>Ciao <b>${name}</b>,</p>
    <p>Il tuo <b>Buono Regalo</b> è stato attivato correttamente.</p>
    <p><b>Valore:</b> ${valueEUR} EUR</p>
    ${validUntil ? `<p><b>Valido fino al:</b> ${validUntil}</p>` : ''}
    <p>Conserva questo messaggio per qualsiasi necessità.</p>
    ${optUrl ? `<p style="font-size:12px">Per disiscriverti: <a href="${optUrl}">${optUrl}</a></p>` : ''}
    <p>— ${biz}</p>
  </div>`;

  const mail = {
    from: env.MAIL.from,
    to: dest,
    subject,
    html,
    replyTo: env.MAIL.replyTo || undefined,
  };

  const info = await t.sendMail(mail);
  logger.info('📧 [Voucher] email sent', { to: dest, messageId: info?.messageId });
  return { ok: true, messageId: info?.messageId };
}

async function sendActivationSms({ to, voucher }) {
  const sid = process.env.TWILIO_ACCOUNT_SID || env.WA?.accountSid || '';
  const token = process.env.TWILIO_AUTH_TOKEN || env.WA?.authToken || '';
  const from = process.env.SMS_FROM || process.env.TWILIO_SMS_FROM || '';
  if (!sid || !token || !from) {
    logger.warn('📱 [Voucher] SMS skipped (missing config)', { hasSid: !!sid, hasToken: !!token, hasFrom: !!from });
    return { ok: false, reason: 'missing_config' };
  }
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  let twilio;
  try {
    twilio = require('twilio')(sid, token);
  } catch (e) {
    logger.warn('📱 [Voucher] SMS skipped (twilio not available)', { error: String(e?.message || e) });
    return { ok: false, reason: 'no_twilio' };
  }

  const valueEUR = (Number(voucher?.value_cents || 0) / 100).toFixed(2);
  const validUntil = voucher?.valid_until ? fmtDateIt(voucher.valid_until) : '';
  const optUrl = buildOptOutUrl({ phone: dest, channel: 'sms' });
  const text = `Buono Regalo attivato. Valore ${valueEUR} EUR${validUntil ? `, valido fino al ${validUntil}` : ''}. Per disiscriverti rispondi STOP.${optUrl ? ` ${optUrl}` : ''}`;

  const msg = await twilio.messages.create({ from, to: dest, body: text });
  logger.info('📱 [Voucher] SMS sent', { to: dest, sid: msg?.sid });
  return { ok: true, sid: msg?.sid };
}

async function sendMarketingConfirmEmail({ to, contact, token }) {
  if (!env.MAIL?.enabled) {
    logger.warn('📧 [Voucher] confirm email skipped (disabled)');
    return { ok: false, reason: 'disabled' };
  }
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  const t = getTransporter();
  if (!t) return { ok: false, reason: 'no_transporter' };

  const biz = env.MAIL?.bizName || 'La tua attività';
  const subject = `${biz} — Conferma consenso marketing`;
  const name = [contact?.customer_first, contact?.customer_last].filter(Boolean).join(' ') || 'Cliente';
  const confirmUrl = buildOptInUrl(token);

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0 0 12px">${biz}</h2>
    <p>Ciao <b>${name}</b>,</p>
    <p>Per confermare il consenso marketing, clicca qui:</p>
    <p><a href="${confirmUrl}">${confirmUrl}</a></p>
    <p>Se non sei stato tu, ignora questo messaggio.</p>
    <p>— ${biz}</p>
  </div>`;

  const mail = {
    from: env.MAIL.from,
    to: dest,
    subject,
    html,
    replyTo: env.MAIL.replyTo || undefined,
  };

  const info = await t.sendMail(mail);
  logger.info('📧 [Voucher] confirm email sent', { to: dest, messageId: info?.messageId });
  return { ok: true, messageId: info?.messageId };
}

async function sendMarketingConfirmSms({ to, token }) {
  const sid = process.env.TWILIO_ACCOUNT_SID || env.WA?.accountSid || '';
  const tokenEnv = process.env.TWILIO_AUTH_TOKEN || env.WA?.authToken || '';
  const from = process.env.SMS_FROM || process.env.TWILIO_SMS_FROM || '';
  if (!sid || !tokenEnv || !from) {
    logger.warn('📱 [Voucher] confirm SMS skipped (missing config)', { hasSid: !!sid, hasToken: !!tokenEnv, hasFrom: !!from });
    return { ok: false, reason: 'missing_config' };
  }
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  let twilio;
  try {
    twilio = require('twilio')(sid, tokenEnv);
  } catch (e) {
    logger.warn('📱 [Voucher] confirm SMS skipped (twilio not available)', { error: String(e?.message || e) });
    return { ok: false, reason: 'no_twilio' };
  }

  const confirmUrl = buildOptInUrl(token);
  const text = `Conferma consenso marketing: ${confirmUrl}`;
  const msg = await twilio.messages.create({ from, to: dest, body: text });
  logger.info('📱 [Voucher] confirm SMS sent', { to: dest, sid: msg?.sid });
  return { ok: true, sid: msg?.sid };
}

async function sendMarketingConfirmWhatsapp({ to, token }) {
  const confirmUrl = buildOptInUrl(token);
  const text = `Conferma consenso marketing: ${confirmUrl}`;
  const res = await wa.sendText({ to, text });
  return res;
}

async function sendMarketingOptInEmail({ to, contact }) {
  if (!env.MAIL?.enabled) {
    logger.warn('📧 [Voucher] marketing email skipped (disabled)');
    return { ok: false, reason: 'disabled' };
  }
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  const t = getTransporter();
  if (!t) return { ok: false, reason: 'no_transporter' };

  const biz = env.MAIL?.bizName || 'La tua attività';
  const subject = `${biz} — Consenso marketing ricevuto`;
  const name = [contact?.customer_first, contact?.customer_last].filter(Boolean).join(' ') || 'Cliente';
  const optUrl = buildOptOutUrl({ email: dest, channel: 'email' });

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0 0 12px">${biz}</h2>
    <p>Ciao <b>${name}</b>,</p>
    <p>Abbiamo registrato il tuo <b>consenso marketing</b>.</p>
    <p>Potrai ricevere comunicazioni promozionali.</p>
    ${optUrl ? `<p style="font-size:12px">Per disiscriverti: <a href="${optUrl}">${optUrl}</a></p>` : '<p style="font-size:12px">Per disiscriverti rispondi a questa email.</p>'}
    <p>— ${biz}</p>
  </div>`;

  const mail = {
    from: env.MAIL.from,
    to: dest,
    subject,
    html,
    replyTo: env.MAIL.replyTo || undefined,
  };

  const info = await t.sendMail(mail);
  logger.info('📧 [Voucher] marketing email sent', { to: dest, messageId: info?.messageId });
  return { ok: true, messageId: info?.messageId };
}

async function sendMarketingOptInSms({ to }) {
  const sid = process.env.TWILIO_ACCOUNT_SID || env.WA?.accountSid || '';
  const token = process.env.TWILIO_AUTH_TOKEN || env.WA?.authToken || '';
  const from = process.env.SMS_FROM || process.env.TWILIO_SMS_FROM || '';
  if (!sid || !token || !from) {
    logger.warn('📱 [Voucher] marketing SMS skipped (missing config)', { hasSid: !!sid, hasToken: !!token, hasFrom: !!from });
    return { ok: false, reason: 'missing_config' };
  }
  const dest = String(to || '').trim();
  if (!dest) return { ok: false, reason: 'no_recipient' };

  let twilio;
  try {
    twilio = require('twilio')(sid, token);
  } catch (e) {
    logger.warn('📱 [Voucher] marketing SMS skipped (twilio not available)', { error: String(e?.message || e) });
    return { ok: false, reason: 'no_twilio' };
  }

  const optUrl = buildOptOutUrl({ phone: dest, channel: 'sms' });
  const text = `Consenso marketing registrato. Per revocarlo rispondi STOP.${optUrl ? ` ${optUrl}` : ''}`;
  const msg = await twilio.messages.create({ from, to: dest, body: text });
  logger.info('📱 [Voucher] marketing SMS sent', { to: dest, sid: msg?.sid });
  return { ok: true, sid: msg?.sid };
}

async function sendMarketingOptInWhatsapp({ to }) {
  const optUrl = buildOptOutUrl({ phone: to, channel: 'whatsapp' });
  const text = `Consenso marketing registrato. Per revocarlo rispondi STOP.${optUrl ? ` ${optUrl}` : ''}`;
  const res = await wa.sendText({ to, text });
  return res;
}

module.exports = {
  sendActivationEmail,
  sendActivationSms,
  sendMarketingConfirmEmail,
  sendMarketingConfirmSms,
  sendMarketingConfirmWhatsapp,
  sendMarketingOptInEmail,
  sendMarketingOptInSms,
  sendMarketingOptInWhatsapp,
};
```

### ./src/services/whatsapp.service.js
```
'use strict';

/**
 * services/whatsapp.service.js
 * -----------------------------------------------------------------------------
 * ✅ UNICA FONTE DI VERITÀ WhatsApp (Twilio)
 *
 * Obiettivi:
 * 1) Inviare TEMPLATE approvato (Quick Reply) per aprire finestra 24h
 * 2) Gestire inbound webhook Twilio:
 *    - ButtonPayload / ButtonText / Body
 *    - OriginalRepliedMessageSid -> risalire a reservation_id
 * 3) BLOCCARE free-text fuori finestra 24h (evita “200 OK ma non consegnato”)
 * 4) Salvare tracking su DB (best-effort) + fallback in-memory in DEV
 *
 * ENV principali:
 * - WA_ENABLED=true|false
 * - TWILIO_ACCOUNT_SID=AC...
 * - TWILIO_AUTH_TOKEN=...
 * - WA_FROM=whatsapp:+1...   (numero WhatsApp abilitato su Twilio)
 * - WA_DEFAULT_CC=+39
 *
 * Template SID:
 * - WA_TEMPLATE_RESERVATION_CONFIRM_SID=HX...  (QUICK REPLY conferma prenotazione)
 * - WA_TEMPLATE_STATUS_CHANGE_SID=HX...        (template cambio stato - opzionale)
 *
 * Webhook:
 * - WA_WEBHOOK_BASE_URL=https://.... (PUBBLICO, raggiungibile da Twilio!)
 * - WA_BLOCK_FREE_TEXT_OUTSIDE_24H=true|false
 */

const logger = require('../logger');
const env    = require('../env');

// ----------------------------------------------------------------------------
// DB best-effort (se non c’è, fallback in-memory)
// ----------------------------------------------------------------------------
let dbQuery = null;
try {
  // eslint-disable-next-line global-require
  const db = require('../db');
  dbQuery = db.query || null;
} catch (e) {
  dbQuery = null;
}

// mysql2 compat: a volte query() ritorna [rows, fields]
async function dbExec(sql, params) {
  if (!dbQuery) return null;
  const out = await dbQuery(sql, params);
  if (Array.isArray(out) && Array.isArray(out[0])) return out[0];
  return out;
}

// ----------------------------------------------------------------------------
// Config letta da env.js + fallback process.env (così NON rompiamo nulla)
// ----------------------------------------------------------------------------
function envStr(v, fb = '') {
  const s = (v === undefined || v === null) ? '' : String(v);
  return s.trim() || fb;
}
function envBool(v, fb = false) {
  const s = envStr(v, '');
  if (!s) return fb;
  return ['1', 'true', 'yes', 'y', 'on'].includes(s.toLowerCase());
}

const CFG = {
  enabled : envBool(process.env.WA_ENABLED, !!env.WA?.enabled),
  sid     : envStr(process.env.TWILIO_ACCOUNT_SID, env.WA?.accountSid || ''),
  token   : envStr(process.env.TWILIO_AUTH_TOKEN, env.WA?.authToken || ''),
  from    : envStr(process.env.WA_FROM, env.WA?.from || ''),
  defaultCc: envStr(process.env.WA_DEFAULT_CC, env.WA?.defaultCc || '+39'),

  templateReservationConfirmSid: envStr(
    process.env.WA_TEMPLATE_RESERVATION_CONFIRM_SID,
    env.WA?.templateReservationConfirmSid || ''
  ),
  templateStatusChangeSid: envStr(
    process.env.WA_TEMPLATE_STATUS_CHANGE_SID,
    // fallback vecchio nome
    env.WA?.templateStatusChangeSid || env.WA?.templateSid || ''
  ),

  webhookBaseUrl: envStr(
    process.env.WA_WEBHOOK_BASE_URL,
    env.WA?.webhookBaseUrl || env.PUBLIC_BASE_URL || ''
  ),

  blockFreeTextOutside24h: envBool(
    process.env.WA_BLOCK_FREE_TEXT_OUTSIDE_24H,
    !!env.WA?.blockFreeTextOutside24h
  ),

  logContent: envBool(process.env.WA_LOG_CONTENT, !!env.WA?.logContent),
};

// ----------------------------------------------------------------------------
// Fallback in-memory (DEV)
// ----------------------------------------------------------------------------
const mem = {
  lastInboundAtByPhone: new Map(), // phone_e164 -> Date
  outboundLinkBySid: new Map(),    // templateSid(MessageSid) -> { reservationId, kind, toPhone, createdAt }
};

// ----------------------------------------------------------------------------
// Twilio lazy require
// ----------------------------------------------------------------------------
let _twilioFactory = null;
function _loadTwilioFactory() {
  if (_twilioFactory) return _twilioFactory;
  try {
    // eslint-disable-next-line global-require
    _twilioFactory = require('twilio');
    return _twilioFactory;
  } catch (e) {
    logger.warn('📲 WA: modulo "twilio" non risolvibile (non installato?)', { error: String(e) });
    _twilioFactory = null;
    return null;
  }
}

let _client = null;
function getClient() {
  if (!CFG.enabled) return null;

  const twilioFactory = _loadTwilioFactory();
  if (!twilioFactory) return null;

  if (!CFG.sid || !CFG.token) {
    logger.warn('📲 WA: credenziali Twilio mancanti', {
      wa_env: { enabled: CFG.enabled, hasSid: !!CFG.sid, hasToken: !!CFG.token, hasFrom: !!CFG.from }
    });
    return null;
  }

  if (!_client) {
    _client = twilioFactory(CFG.sid, CFG.token);
    logger.info('📳 WA client inizializzato', {
      wa_env: { enabled: CFG.enabled, hasSid: !!CFG.sid, hasToken: !!CFG.token, from: CFG.from ? '[set]' : '' }
    });
  }

  return _client;
}

// ----------------------------------------------------------------------------
// Helpers phone
// ----------------------------------------------------------------------------
function _stripWhatsappPrefix(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  return s.startsWith('whatsapp:') ? s.slice('whatsapp:'.length) : s;
}

function normalizeToE164(phone) {
  if (!phone) return null;

  let p = _stripWhatsappPrefix(phone);
  p = String(p).trim();
  p = p.replace(/[^\d+]/g, '');

  if (!p) return null;
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return '+' + p.slice(2);

  // fallback: aggiungo prefisso default (es +39)
  return (CFG.defaultCc || '+39') + p.replace(/^0+/, '');
}

function toWhatsAppAddress(phoneE164) {
  const p = normalizeToE164(phoneE164);
  if (!p) return null;
  return `whatsapp:${p}`;
}

function fromWhatsAppAddress(addr) {
  if (!addr) return null;
  const a = String(addr);
  return a.startsWith('whatsapp:') ? a.replace('whatsapp:', '') : a;
}

function _normalizeFrom(from) {
  const raw = String(from || '').trim();
  if (!raw) return '';

  if (raw.startsWith('whatsapp:')) return raw;

  const e164 = normalizeToE164(raw);
  if (!e164) return '';
  return `whatsapp:${e164}`;
}

function safeJson(obj) {
  try { return JSON.stringify(obj); } catch (e) { return '{"_error":"json_stringify_failed"}'; }
}

// ----------------------------------------------------------------------------
// DB helpers (best-effort)
// ----------------------------------------------------------------------------
async function upsertContactInbound(phoneE164, waId, profileName, inboundAtUtc) {
  if (!phoneE164) return;

  mem.lastInboundAtByPhone.set(phoneE164, inboundAtUtc);

  if (!dbQuery) return;
  try {
    await dbExec(
      `
      INSERT INTO wa_contacts (phone_e164, wa_id, profile_name, last_inbound_at)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        wa_id = VALUES(wa_id),
        profile_name = VALUES(profile_name),
        last_inbound_at = VALUES(last_inbound_at)
      `,
      [phoneE164, waId || null, profileName || null, inboundAtUtc]
    );
  } catch (e) {
    logger.warn(`⚠️ WA contacts upsert fallito (ok in DEV): ${e.message}`, { service: 'server' });
  }
}

async function insertWaMessage(row) {
  if (!row || !row.sid) return;

  // Fallback in-memory per link (importantissimo per OriginalRepliedMessageSid)
  if (row.direction === 'out') {
    mem.outboundLinkBySid.set(row.sid, {
      reservationId: row.reservation_id || null,
      kind: row.kind,
      toPhone: row.to_phone || null,
      createdAt: new Date(),
    });
  }

  if (!dbQuery) return;
  try {
    await dbExec(
      `
      INSERT INTO wa_messages
        (sid, direction, kind, to_phone, from_phone, reservation_id, status, payload_json, created_at)
      VALUES
        (?,   ?,         ?,    ?,        ?,          ?,             ?,      ?,           UTC_TIMESTAMP())
      `,
      [
        row.sid,
        row.direction,
        row.kind,
        row.to_phone || null,
        row.from_phone || null,
        row.reservation_id || null,
        row.status || null,
        row.payload_json || null,
      ]
    );
  } catch (e) {
    logger.warn(`⚠️ WA messages insert fallito (ok in DEV): ${e.message}`, { service: 'server' });
  }
}

async function updateWaMessageStatus(messageSid, status, errorCode, errorMessage, payload) {
  if (!messageSid) return;

  if (!dbQuery) return;
  try {
    await dbExec(
      `
      UPDATE wa_messages
      SET status = ?, error_code = ?, error_message = ?, payload_json = COALESCE(payload_json, ?)
      WHERE sid = ?
      `,
      [status || null, errorCode || null, errorMessage || null, payload ? safeJson(payload) : null, messageSid]
    );
  } catch (e) {
    logger.warn(`⚠️ WA status update fallito (ok in DEV): ${e.message}`, { service: 'server' });
  }
}

async function getLastInboundAt(phoneE164) {
  if (!phoneE164) return null;

  if (dbQuery) {
    try {
      const rows = await dbExec(`SELECT last_inbound_at FROM wa_contacts WHERE phone_e164 = ? LIMIT 1`, [phoneE164]);
      const r = Array.isArray(rows) ? rows[0] : null;
      if (r && r.last_inbound_at) return new Date(r.last_inbound_at);
    } catch (e) {
      // ignore
    }
  }

  return mem.lastInboundAtByPhone.get(phoneE164) || null;
}

async function findOutboundLinkBySid(originalSid) {
  if (!originalSid) return null;

  if (dbQuery) {
    try {
      const rows = await dbExec(
        `
        SELECT reservation_id, kind, to_phone
        FROM wa_messages
        WHERE sid = ? AND direction = 'out'
        ORDER BY id DESC
        LIMIT 1
        `,
        [originalSid]
      );
      const r = Array.isArray(rows) ? rows[0] : null;
      if (r) {
        return { reservationId: r.reservation_id || null, kind: r.kind || null, toPhone: r.to_phone || null };
      }
    } catch (e) {
      // ignore
    }
  }

  return mem.outboundLinkBySid.get(originalSid) || null;
}

async function isWithin24hSession(phoneE164) {
  const last = await getLastInboundAt(phoneE164);
  if (!last) return false;
  const diffMs = Date.now() - last.getTime();
  return diffMs >= 0 && diffMs <= 24 * 60 * 60 * 1000;
}

// ----------------------------------------------------------------------------
// URL callback status
// ----------------------------------------------------------------------------
function buildStatusCallbackUrl() {
  const base = envStr(CFG.webhookBaseUrl, '');
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/api/notifications/wa/status`;
}

// ----------------------------------------------------------------------------
// API: FREE TEXT
// ----------------------------------------------------------------------------
async function sendText(arg1, arg2, arg3) {
  // Firma compat:
  // - sendText(to, text, mediaUrl?)
  // - sendText({ to, text, mediaUrl?, from?, allowOutsideWindow? })
  let to = null;
  let text = null;
  let mediaUrl = null;
  let from = null;
  let allowOutsideWindow = false;

  if (arg1 && typeof arg1 === 'object') {
    to = arg1.to;
    text = arg1.text ?? arg1.body ?? arg1.message ?? null;
    mediaUrl = arg1.mediaUrl ?? null;
    from = arg1.from ?? null;
    allowOutsideWindow = !!arg1.allowOutsideWindow;
  } else {
    to = arg1;
    text = arg2;
    mediaUrl = arg3 ?? null;
  }

  if (!CFG.enabled) {
    logger.warn('📲 WA SKIPPED (disabled)', { to: String(to || '') });
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  const client = getClient();
  if (!client) {
    logger.warn('📲 WA SKIPPED (client_unavailable)', { to: String(to || '') });
    return { ok: false, skipped: true, reason: 'client_unavailable' };
  }

  const phone = normalizeToE164(to);
  if (!phone) {
    logger.warn('📲 WA SKIPPED (no_phone)', { to: String(to || '') });
    return { ok: false, skipped: true, reason: 'no_phone' };
  }

  const body = String(text || '').trim();
  if (!body) {
    logger.warn('📲 WA SKIPPED (empty_text)', { to: phone });
    return { ok: false, skipped: true, reason: 'empty_text' };
  }

  // BLOCCO fuori 24h (se attivo)
  if (CFG.blockFreeTextOutside24h && !allowOutsideWindow) {
    const inSession = await isWithin24hSession(phone);
    if (!inSession) {
      logger.warn('⛔ WA free-text BLOCCATO (fuori finestra 24h) -> usa TEMPLATE', { service: 'server', to: phone });
      return { ok: false, skipped: true, reason: 'outside_24h_window_use_template' };
    }
  }

  const waFrom = _normalizeFrom(from || CFG.from);
  if (!waFrom) {
    logger.warn('📲 WA SKIPPED (missing_from)', { to: phone });
    return { ok: false, skipped: true, reason: 'missing_from' };
  }

  const payload = {
    from: waFrom,
    to: toWhatsAppAddress(phone),
    body,
  };

  const cb = buildStatusCallbackUrl();
  if (cb) payload.statusCallback = cb;

  if (mediaUrl) {
    if (Array.isArray(mediaUrl)) {
      const arr = mediaUrl.map(x => String(x || '').trim()).filter(Boolean);
      if (arr.length) payload.mediaUrl = arr;
    } else {
      const u = String(mediaUrl).trim();
      if (u) payload.mediaUrl = [u];
    }
  }

  logger.info('📲 WA sendText ▶️', {
    service: 'server',
    to: phone,
    hasMedia: !!payload.mediaUrl,
    body: CFG.logContent ? body : '[hidden]'
  });

  const msg = await client.messages.create(payload);

  logger.info('📲 WA sendText OK ✅', { service: 'server', sid: msg.sid, to: phone });

  await insertWaMessage({
    sid: msg.sid,
    direction: 'out',
    kind: 'free_text',
    to_phone: phone,
    from_phone: fromWhatsAppAddress(waFrom),
    reservation_id: null,
    status: msg.status || null,
    payload_json: safeJson({ payload }),
  });

  return { ok: true, sid: msg.sid, skipped: false, reason: null };
}

// Alias compat
async function sendMessage(...args) {
  return sendText(...args);
}

// ----------------------------------------------------------------------------
// API: TEMPLATE (Content API)
// ----------------------------------------------------------------------------
async function sendTemplate({ to, contentSid, variables = {}, kind = 'template', reservationId = null }) {
  const phone = normalizeToE164(to);
  if (!phone) return { ok: false, skipped: true, reason: 'invalid_to' };
  if (!contentSid) return { ok: false, skipped: true, reason: 'missing_contentSid' };

  if (!CFG.enabled) return { ok: false, skipped: true, reason: 'disabled' };

  const client = getClient();
  if (!client) return { ok: false, skipped: true, reason: 'client_unavailable' };

  const waFrom = _normalizeFrom(CFG.from);
  if (!waFrom) return { ok: false, skipped: true, reason: 'missing_from' };

  const payload = {
    from: waFrom,
    to: toWhatsAppAddress(phone),
    contentSid,
    contentVariables: safeJson(variables),
  };

  const cb = buildStatusCallbackUrl();
  if (cb) payload.statusCallback = cb;

  logger.info('📲 WA template send ▶️', {
    service: 'server',
    to: phone,
    kind,
    reservationId: reservationId || null,
    contentSid
  });

  const msg = await client.messages.create(payload);

  logger.info('📲 WA template OK ✅', {
    service: 'server',
    sid: msg.sid,
    to: phone,
    kind,
    reservationId: reservationId || null
  });

  // IMPORTANTISSIMO: link SID template -> reservationId
  await insertWaMessage({
    sid: msg.sid,
    direction: 'out',
    kind,
    to_phone: phone,
    from_phone: fromWhatsAppAddress(waFrom),
    reservation_id: reservationId,
    status: msg.status || null,
    payload_json: safeJson({ payload }),
  });

  return { ok: true, sid: msg.sid, skipped: false, reason: null };
}

// ----------------------------------------------------------------------------
// TEMPLATE: Prenotazione - conferma (quello che hai creato)
// Variabili:
//  {{1}} Nome
//  {{2}} Data
//  {{3}} Ora
//  {{4}} Coperti
// ----------------------------------------------------------------------------
async function sendReservationConfirmTemplate({ to, name, dateStr, timeStr, peopleStr, reservationId }) {
  const sid = CFG.templateReservationConfirmSid;
  if (!sid) {
    logger.error('❌ WA_TEMPLATE_RESERVATION_CONFIRM_SID mancante in .env', { service: 'server' });
    return { ok: false, skipped: true, reason: 'missing_env_template_sid' };
  }

  const vars = {
    1: String(name || '').trim() || 'Cliente',
    2: String(dateStr || '').trim() || '-',
    3: String(timeStr || '').trim() || '-',
    4: String(peopleStr || '').trim() || '-',
  };

  return sendTemplate({
    to,
    contentSid: sid,
    variables: vars,
    kind: 'reservation_confirm',
    reservationId: reservationId || null,
  });
}

// ----------------------------------------------------------------------------
// STATUS CHANGE (compat + template opzionale)
// ----------------------------------------------------------------------------
function buildStatusText({ status, dateYmd, timeHm, partySize, name, tableName }) {
  const S = String(status || '').toUpperCase();
  const n = name ? ` ${name}` : '';
  const when = (dateYmd && timeHm) ? ` per il ${dateYmd} alle ${timeHm}` : '';
  const pax = partySize ? ` (persone: ${partySize})` : '';
  const tbl = tableName ? ` • ${tableName}` : '';
  return `🟢 Aggiornamento prenotazione${n}:\nStato: ${S}${when}${pax}${tbl}\n— ${env.MAIL?.bizName || 'La tua attività'}`;
}

async function sendStatusChange({ to, reservation, status, reason }) {
  if (!CFG.enabled) {
    logger.warn('📲 WA SKIPPED (disabled)', { id: reservation?.id });
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  const phone = normalizeToE164(to || reservation?.contact_phone || reservation?.phone);
  if (!phone) {
    logger.warn('📲 WA SKIPPED (no phone)', { id: reservation?.id });
    return { ok: false, skipped: true, reason: 'no_phone' };
  }

  // Ricavo data/ora dal start_at (best-effort)
  const start = reservation?.start_at ? new Date(reservation.start_at) : null;
  const ymd = start ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}` : null;
  const hm  = start ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}` : null;

  const name = reservation?.display_name || [reservation?.customer_first, reservation?.customer_last].filter(Boolean).join(' ');
  const body = buildStatusText({
    status,
    dateYmd: ymd,
    timeHm: hm,
    partySize: reservation?.party_size,
    name,
    tableName: reservation?.table_name
  });

  // Se hai un template status-change lo uso (fuori finestra va bene)
  if (CFG.templateStatusChangeSid) {
    const vars = {
      '1': name || 'Cliente',
      '2': String(status || '').toUpperCase(),
      '3': `${ymd || ''} ${hm || ''}`.trim(),
      '4': String(reservation?.party_size || ''),
      '5': reservation?.table_name || '',
      '6': reason || ''
    };

    return sendTemplate({
      to: phone,
      contentSid: CFG.templateStatusChangeSid,
      variables: vars,
      kind: 'status_change',
      reservationId: reservation?.id || null,
    });
  }

  // Freeform: dentro 24h (se blocco attivo)
  return sendText({ to: phone, text: body });
}

// ----------------------------------------------------------------------------
// Webhook inbound: parsing + action detect
// ----------------------------------------------------------------------------
function detectAction({ bodyText, buttonText, buttonPayload }) {
  const t  = String(bodyText || '').trim().toLowerCase();
  const bt = String(buttonText || '').trim().toLowerCase();
  const bp = String(buttonPayload || '').trim().toLowerCase();
  const hay = `${t} ${bt} ${bp}`.trim();

  // Nel tuo caso:
  // - bottone "CONFERMO" (ID magari "CAMBIA ORARIO") -> confirm
  // - bottone "ANNULLA" (ID "cancel") -> cancel
  if (hay.includes('confermo') || hay.includes('confirm') || hay.includes('cambia orario')) return 'confirm';
  if (hay.includes('annulla') || hay.includes('cancel')) return 'cancel';

  return null;
}

async function handleInboundWebhook(form) {
  const messageSid = form.MessageSid || form.SmsSid || null;
  const fromAddr   = form.From || null; // whatsapp:+39...
  const toAddr     = form.To || null;

  const fromPhone = normalizeToE164(fromWhatsAppAddress(fromAddr));
  const toPhone   = normalizeToE164(fromWhatsAppAddress(toAddr));

  const bodyText      = form.Body || '';
  const buttonText    = form.ButtonText || '';
  const buttonPayload = form.ButtonPayload || '';

  const originalSid = form.OriginalRepliedMessageSid || null;

  const profileName = form.ProfileName || null;
  const waId        = form.WaId || null;

  // 1) aggiorno inbound (apre finestra 24h)
  await upsertContactInbound(fromPhone, waId, profileName, new Date());

  // 2) salvo inbound in tabella
  if (messageSid) {
    await insertWaMessage({
      sid: messageSid,
      direction: 'in',
      kind: 'inbound',
      to_phone: toPhone,
      from_phone: fromPhone,
      reservation_id: null,
      status: null,
      payload_json: safeJson(form),
    });
  }

  // 3) azione
  const action = detectAction({ bodyText, buttonText, buttonPayload });

  // 4) link reservation via OriginalRepliedMessageSid
  let link = null;
  if (action && originalSid) {
    link = await findOutboundLinkBySid(originalSid);
  }

  const out = {
    ok: true,
    messageSid,
    fromPhone,
    toPhone,
    bodyText,
    buttonText,
    buttonPayload,
    originalSid,
    action, // 'confirm' | 'cancel' | null
    reservationId: link ? link.reservationId : null,
    linkedKind: link ? link.kind : null,
  };

  logger.info('📩 WA inbound', {
    service: 'server',
    from: fromPhone,
    action: out.action,
    reservationId: out.reservationId,
    originalSid: out.originalSid,
  });

  return out;
}

// ----------------------------------------------------------------------------
// Health
// ----------------------------------------------------------------------------
function health() {
  const hasTwilioModule = !!_loadTwilioFactory();
  return {
    enabled: !!CFG.enabled,
    hasTwilioModule,
    hasSid: !!CFG.sid,
    hasToken: !!CFG.token,
    hasFrom: !!CFG.from,
    defaultCc: CFG.defaultCc || '+39',
    webhookBaseUrl: CFG.webhookBaseUrl ? '[set]' : '',
    blockFreeTextOutside24h: !!CFG.blockFreeTextOutside24h,
    hasTemplateReservationConfirm: !!CFG.templateReservationConfirmSid,
    hasTemplateStatusChange: !!CFG.templateStatusChangeSid,
  };
}

module.exports = {
  getClient,

  // Send
  sendText,
  sendMessage,
  sendTemplate,
  sendReservationConfirmTemplate,
  sendStatusChange,

  // Webhook
  handleInboundWebhook,
  updateWaMessageStatus,

  // Utils
  _normalizeToE164: normalizeToE164,

  // Debug
  health,
};
```

### ./src/services/whatsapp-twilio.service.js
```
'use strict';

/**
 * whatsapp-twilio.service.js
 * ---------------------------------------------------------
 * 🎯 SCOPO:
 * - Qui dentro teniamo SOLO la creazione del client Twilio.
 * - Zero logiche business.
 * - Zero parsing webhook.
 *
 * ✅ In questo modo:
 * - whatsapp.service.js = logica WA (template, finestra 24h, tracking, ecc.)
 * - whatsapp-twilio.service.js = adapter Twilio
 */

const twilio = require('twilio');
const env = require('../env');

function createClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN || env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    // Non logghiamo qui: la logica + log sta in whatsapp.service.js
    return null;
  }

  return twilio(accountSid, authToken);
}

module.exports = {
  createClient,
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
'use strict';
/**
 * Socket entry — singleton + bootstrap canali
 * -------------------------------------------------------------
 * - Mantiene i tuoi log di connessione/disconnessione
 * - Mantiene il ping/pong ("🏓") per diagnostica rapida
 * - Espone un singleton io() richiamabile dai router/service
 * - Monta i canali modulari (orders, nfc.session)
 */

const logger = require('../logger');

let _io = null;

/**
 * Inizializza socket.io una sola volta e monta i canali modulari.
 *
 * @param {import('socket.io').Server} ioInstance
 * @returns {import('socket.io').Server}
 */
function init(ioInstance) {
  if (_io) {
    logger.warn(
      '🔌 SOCKET init chiamato più volte — uso il singleton esistente',
    );
    return _io;
  }

  _io = ioInstance;

  // === HANDLER BASE =========================================================
  ioInstance.on('connection', (socket) => {
    logger.info('🔌 SOCKET connected', { id: socket.id });

    socket.on('ping', () => {
      logger.info('🏓 ping from', { id: socket.id });
      socket.emit('pong');
    });

    socket.on('disconnect', (reason) => {
      logger.info('🔌 SOCKET disconnected', { id: socket.id, reason });
    });
  });

  // === CANALI MODULARI ======================================================
  // ORDERS: canale + bus per broadcast "order-created"/"order-updated"
  try {
    const ordersMod = require('./orders');
    if (ordersMod && typeof ordersMod.mount === 'function') {
      ordersMod.mount(ioInstance);
      logger.info('📡 SOCKET channel mounted: orders');
    } else if (typeof ordersMod === 'function') {
      // compat vecchia versione: module.exports = (io) => { ... }
      ordersMod(ioInstance);
      logger.info('📡 SOCKET channel mounted (legacy fn): orders');
    } else {
      logger.warn(
        '📡 SOCKET channel orders non montato (export inatteso, manca mount(io))',
      );
    }
  } catch (err) {
    logger.warn('📡 SOCKET channel orders non disponibile', {
      error: String(err),
    });
  }

  // 🆕 canale NFC session (join/leave stanza session:<SID>)
  try {
    const nfcMod = require('./nfc.session');
    if (nfcMod && typeof nfcMod.mount === 'function') {
      nfcMod.mount(ioInstance);
      logger.info('📡 SOCKET channel mounted: nfc.session');
    } else if (typeof nfcMod === 'function') {
      nfcMod(ioInstance);
      logger.info('📡 SOCKET channel mounted (legacy fn): nfc.session');
    } else {
      logger.warn(
        '📡 SOCKET channel nfc.session non montato (export inatteso, manca mount(io))',
      );
    }
  } catch (err) {
    logger.warn('📡 SOCKET channel nfc.session non disponibile', {
      error: String(err),
    });
  }

  logger.info('🔌 SOCKET bootstrap completato ✅');
  return _io;
}

/**
 * Restituisce il singleton io() per i router/service BE.
 *
 * @returns {import('socket.io').Server}
 */
function getIo() {
  if (!_io) throw new Error('socket.io non inizializzato');
  return _io;
}

// Funzione principale esportata (compat con require('./sockets/index')(io))
function socketsEntry(serverOrIo) {
  return init(serverOrIo);
}

// Espongo anche metodi nominati
socketsEntry.init = init;
socketsEntry.io = getIo;

module.exports = socketsEntry;
module.exports.io = getIo;
module.exports.init = init;
```

### ./src/sockets/nfc.session.js
```
'use strict';
/**
 * Canale Socket — NFC Session
 * - join_session { session_id }
 * - leave_session { session_id }
 * Stanza: "session:<SID>"
 */

const logger = require('../logger');

/** @param {import('socket.io').Server} io */
module.exports = function(io) {
  io.on('connection', (socket) => {

    socket.on('join_session', (p) => {
      try{
        const sid = Number(p?.session_id || 0) || 0;
        if (!sid) return;
        const room = `session:${sid}`;
        socket.join(room);
        logger.info('🔗 [SOCKET] join_session', { sid, socket: socket.id });
      }catch(e){
        logger.warn('⚠️ [SOCKET] join_session KO', { error: String(e) });
      }
    });

    socket.on('leave_session', (p) => {
      try{
        const sid = Number(p?.session_id || 0) || 0;
        if (!sid) return;
        const room = `session:${sid}`;
        socket.leave(room);
        logger.info('🔗 [SOCKET] leave_session', { sid, socket: socket.id });
      }catch(e){
        logger.warn('⚠️ [SOCKET] leave_session KO', { error: String(e) });
      }
    });

  });
};
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
'use strict';

// 📡 Socket.IO: canale "orders" + bus per broadcast da backend
// -------------------------------------------------------------
// - mount(io): registra i listener di connessione/disconnessione
// - broadcastOrderCreated(order): emette "order-created" a tutti gli admin
// - broadcastOrderUpdated(order): emette "order-updated" (status change)
// -------------------------------------------------------------

const logger = require('../logger');
const sockets = require('./index'); // per usare il singleton io()

/**
 * Monta il canale "orders" sul namespace di default.
 *
 * @param {import('socket.io').Server} io
 */
function mount(io) {
  io.of('/').on('connection', (socket) => {
    logger.info('🔌 socket orders ▶️ connected', { id: socket.id });

    socket.on('disconnect', () => {
      logger.info('🔌 socket orders ⏹ disconnected', { id: socket.id });
    });

    // (eventuali) azioni client → server in futuro
    // es: socket.on('orders:subscribe', () => ...)
  });
}

/**
 * Broadcast "order-created" — usato da /api/orders POST
 *
 * @param {object} order
 */
function broadcastOrderCreated(order) {
  try {
    const io = sockets.io(); // prende il singleton da sockets/index
    io.of('/').emit('order-created', order);

    logger.info('📡 order-created ▶️ broadcast', {
      id      : order && order.id,
      table_id: order && order.table_id,
      room_id : order && order.room_id,
    });
  } catch (err) {
    logger.warn('📡 order-created broadcast KO', { error: String(err) });
  }
}

/**
 * Broadcast "order-updated" — usato da PATCH /api/orders/:id/status
 *
 * @param {object} order
 */
function broadcastOrderUpdated(order) {
  try {
    const io = sockets.io();
    io.of('/').emit('order-updated', {
      id         : order && order.id,
      status     : order && order.status,
      table_id   : order && order.table_id,
      fulfillment: order && order.fulfillment,
    });

    logger.info('📡 order-updated ▶️ broadcast', {
      id         : order && order.id,
      status     : order && order.status,
      table_id   : order && order.table_id,
      fulfillment: order && order.fulfillment,
    });
  } catch (err) {
    logger.warn('📡 order-updated broadcast KO', { error: String(err) });
  }
}

module.exports = {
  mount,
  broadcastOrderCreated,
  broadcastOrderUpdated,
};
```

### ./src/sockets/reservations.js
```
// C:\Users\Endri Azizi\progetti-dev\my_dev\be\src\sockets\reservations.js
// 📡 Socket.IO — Prenotazioni tavolo (realtime) + creazione anche da Admin
// - Mantiene i canali esistenti (reservations-get/new/update-status/assign-table)
// - 🆕 Eventi di comodo per check-in / check-out (opzionali dal client)
//   • 'reservation-checkin'  { id, at? }   → svc.checkIn(...)
//   • 'reservation-checkout' { id, at? }   → svc.checkOut(...)
// - 🧼 Al check-out, emette anche { table_id, cleaning_until } per attivare la “Pulizia 5:00” sui FE passivi.

'use strict';

const logger = require('../logger');
const env    = require('../env');

const {
  create: createReservation,
  updateStatus: updateReservationStatus,
  assignReservationTable,          // ✅ c'è già nel service
  list: listReservations,
  checkIn,                         // ✅ nomi reali dal service
  checkOut                         // ✅ nomi reali dal service
} = require('../services/reservations.service');

// finestra pulizia (default 5 minuti) → configurabile via ENV
const CLEAN_SEC =
  Number(process.env.CLEAN_SECONDS || (env.RESV && env.RESV.cleanSeconds) || 300);

module.exports = (io) => {
  io.on('connection', (socket) => {
    logger.info('📡 [RES] SOCKET connected', { id: socket.id });

    // registrazione canali
    socket.on('register-admin',   () => socket.join('admins'));
    socket.on('register-customer', (token) => token && socket.join(`c:${token}`));

    // LIST
    socket.on('reservations-get', async (filter = {}) => {
      logger.info('📡 [RES] reservations-get ▶️', { from: socket.id, filter });
      const rows = await listReservations(filter);
      socket.emit('reservations-list', rows);
    });

    // CREATE (cliente)
    socket.on('reservation-new', async (dto) => {
      logger.info('📡 [RES] reservation-new ▶️', { origin: 'customer', body: dto });
      const r = await createReservation(dto);
      io.to('admins').emit('reservation-created', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-created', r);
      logger.info('📡 [RES] reservation-created ✅ broadcast', { id: r.id });
    });

    // CREATE (admin)
    socket.on('reservation-admin-new', async (dto) => {
      logger.info('📡 [RES] reservation-admin-new ▶️', { origin: 'admin', body: dto });
      const r = await createReservation(dto);
      io.to('admins').emit('reservation-created', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-created', r);
      logger.info('📡 [RES] reservation-created ✅ (admin)', { id: r.id });
    });

    // CAMBIO STATO (compat con FE storico)
    socket.on('reservation-update-status', async ({ id, status }) => {
      logger.info('📡 [RES] reservation-update-status ▶️', { id, status });
      const r = await updateReservationStatus({ id, action: status });
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    // ASSEGNAZIONE TAVOLO
    socket.on('reservation-assign-table', async ({ id, table_id }) => {
      logger.info('📡 [RES] reservation-assign-table ▶️', { id, table_id });
      const r = await assignReservationTable(id, table_id);
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    // 🆕 CHECK-IN
    socket.on('reservation-checkin', async ({ id, at = null }) => {
      logger.info('📡 [RES] reservation-checkin ▶️', { id, at });
      const r = await checkIn(id, { at, user: { email: 'socket@server' } });
      io.to('admins').emit('reservation-checkin', { id: r.id, checkin_at: r.checkin_at, table_id: r.table_id || null });
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
      logger.info('📡 [RES] reservation-checkin ✅ broadcast', { id: r.id });
    });

    // 🆕 CHECK-OUT
    socket.on('reservation-checkout', async ({ id, at = null }) => {
      logger.info('📡 [RES] reservation-checkout ▶️', { id, at });
      const r = await checkOut(id, { at, user: { email: 'socket@server' } });

      // calcolo in uscita una cleaning window lato socket (non blocca il BE)
      const base = at ? new Date(at).getTime() : Date.now();
      const cleaning_until = new Date(base + CLEAN_SEC * 1000).toISOString();

      io.to('admins').emit('reservation-checkout', {
        id         : r.id,
        table_id   : r.table_id || null,
        checkout_at: r.checkout_at,
        dwell_sec  : r.dwell_sec || null,
        cleaning_until
      });
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
      logger.info('📡 [RES] reservation-checkout ✅ broadcast', { id: r.id, cleaning_until });
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

### ./src/utils/customers.resolve.js
```
// src/utils/customers.resolve.js
// -----------------------------------------------------------------------------
// resolveCustomerUserId(db, { email, phone, displayName? })
//
// - db: oggetto con .query (pool mysql2, conn mysql2 o wrapper { query }).
// - Se trova un utente per email/telefono → restituisce id.
// - Se non trova ma abbiamo almeno email/phone → crea un utente "cliente".
// - Non gestisce ancora OTP: phone_verified_at e verification_channel li useremo
//   nello STEP 2 (quando introdurremo la verifica).
// -----------------------------------------------------------------------------

'use strict';

const logger = require('../logger');

function trimOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

// Normalizzazione molto conservativa: togli spazi, trattini, punti
function normalizePhone(v) {
  const s = trimOrNull(v);
  if (!s) return null;
  return s.replace(/[\s\-\.]/g, '');
}

// Normalizza risultato di db.query():
// - mysql2/promise conn/pool → [rows, fields] → ritorniamo rows
// - wrapper { query }        → ritorna già rows
async function runQuery(db, sql, params = []) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('resolveCustomerUserId: db.query mancante');
  }
  const res = await db.query(sql, params);
  if (Array.isArray(res) && Array.isArray(res[0])) return res[0];
  return res;
}

async function resolveCustomerUserId(db, payload = {}) {
  const email       = trimOrNull(payload.email);
  const phone       = trimOrNull(payload.phone);
  const displayName = trimOrNull(payload.displayName);
  const phoneNorm   = normalizePhone(phone);

  if (!email && !phone) {
    logger.info('👥 resolveCustomerUserId: skip (no email/phone)');
    return null;
  }

  // 1) Tenta di trovare un utente esistente
  try {
    let row = null;

    if (email) {
      const rows = await runQuery(
        db,
        'SELECT id, email, phone FROM users WHERE email = ? LIMIT 1',
        [email],
      );
      row = rows?.[0] || null;
    }

    if (!row && phone) {
      const rows = await runQuery(
        db,
        `
          SELECT id, email, phone
          FROM users
          WHERE REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '.', '')
                = REPLACE(REPLACE(REPLACE(?, ' ', ''), '-', ''), '.', '')
          LIMIT 1
        `,
        [phone],
      );
      row = rows?.[0] || null;
    }

    if (row) {
      // Best-effort: aggiorna phone_normalized (se la colonna c'è, dopo migrazione 007)
      if (phoneNorm) {
        try {
          await runQuery(
            db,
            'UPDATE users SET phone = COALESCE(phone, ?), phone_normalized = ? WHERE id = ?',
            [phone, phoneNorm, row.id],
          );
        } catch (e) {
          logger.warn('👥 resolveCustomerUserId: update phone_normalized KO (continuo)', {
            id: row.id,
            error: String(e),
          });
        }
      }

      logger.info('👥 resolveCustomerUserId: hit existing user', {
        id   : row.id,
        email: row.email,
        phone: row.phone,
      });
      return row.id;
    }
  } catch (e) {
    logger.warn('👥 resolveCustomerUserId: lookup KO (continuo senza customer_user_id)', {
      error: String(e),
      email,
      phone,
    });
    return null;
  }

  // 2) Nessun utente trovato → creiamo un nuovo "cliente"
  try {
    let first = null;
    let last  = null;

    if (displayName) {
      const parts = displayName.split(/\s+/);
      first = parts[0] || null;
      if (parts.length > 1) {
        last = parts.slice(1).join(' ') || null;
      }
    }

    const now = new Date();

    const result = await runQuery(
      db,
      `
        INSERT INTO users
          (first_name, last_name, email, phone, phone_normalized, trust_score, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        first,
        last,
        email,
        phone,
        phoneNorm,
        50,    // trust_score di default (cliente "neutro")
        now,
        now,
      ],
    );

    const id = result && result.insertId ? result.insertId : null;

    logger.info('👥 resolveCustomerUserId: created new customer user', {
      id,
      email,
      phone,
      displayName,
    });

    return id;
  } catch (e) {
    logger.error('👥 resolveCustomerUserId: INSERT user KO, continuo senza customer_user_id', {
      error: String(e),
      email,
      phone,
      displayName,
    });
    return null;
  }
}

module.exports = resolveCustomerUserId;
```

### ./src/utils/print-order.js
```
// src/utils/print-order.js
// ============================================================================
// Stampa ESC/POS “Pizzeria/Cucina”. NIENTE simbolo € (codepage problemi).
// - legge env PRINTER_* e mapping categorie PIZZERIA_CATEGORIES / KITCHEN_CATEGORIES
// - se PRINTER_ENABLED=false → no-op (non blocca i flussi)
// - 🆕 per COMANDA (centro produzione): font più grande + bold, cliente/tavolo/sala evidenti,
//   raggruppamento per categoria (ANTIPASTI → PIZZE ROSSE → PIZZE BIANCHE → altre)
//   + spaziatura maggiore e wrapping note (leggibile per dislessia)
//   + prezzi per riga (in piccolo) e totale finale (senza simbolo €)
//   + orario “DOMENICA 10/11/2025  ore 04:42”
// ============================================================================
// Nota: manteniamo lo stile verboso con emoji nei log, come da progetto.
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

// --- ESC/POS helpers (dimensioni/bold/alignment/spacing/font/codepage) ------
function init(sock) { sock.write(esc(0x1B,0x40)); }                    // ESC @
function alignLeft(sock){ sock.write(esc(0x1B,0x61,0x00)); }           // ESC a 0
function alignCenter(sock){ sock.write(esc(0x1B,0x61,0x01)); }         // ESC a 1
function boldOn(sock){ sock.write(esc(0x1B,0x45,0x01)); }              // ESC E 1
function boldOff(sock){ sock.write(esc(0x1B,0x45,0x00)); }             // ESC E 0
function sizeNormal(sock){ sock.write(esc(0x1D,0x21,0x00)); }          // GS ! 0 (1x)
function sizeTall(sock){ sock.write(esc(0x1D,0x21,0x01)); }            // GS ! 1 (2x altezza)
function sizeBig(sock){ sock.write(esc(0x1D,0x21,0x11)); }             // GS ! 17 (2x larghezza+altezza)
function fontA(sock){ sock.write(esc(0x1B,0x4D,0x00)); }               // ESC M 0 → Font A (leggibile)
function charSpacing(sock, n){ sock.write(esc(0x1B,0x20, Math.max(0,Math.min(255,n)))); } // ESC SP n
function setLineSpacing(sock, n){ sock.write(esc(0x1B,0x33, Math.max(0,Math.min(255,n)))); } // ESC 3 n
function resetLineSpacing(sock){ sock.write(esc(0x1B,0x32)); }         // ESC 2 (default)
function feedLines(sock, n){ sock.write(esc(0x1B,0x64, Math.max(0,Math.min(255,n)))); }     // ESC d n
function cutIfEnabled(sock){ if (PRINTER_CUT === 'true') sock.write(esc(0x1D,0x56,0x42,0x00)); } // GS V B n
function codepageCP1252(sock){ try{ sock.write(esc(0x1B,0x74,0x10)); }catch{} } // ESC t 16 → CP1252 (tipico Epson)

// --- Scrittura linea con sanificazione (accenti/apici/dash) -----------------
function sanitizeForEscpos(s) {
  return String(s || '')
    // apici/virgolette tipografiche → ASCII
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // em/en dash → trattino semplice
    .replace(/[\u2013\u2014]/g, '-')
    // simbolo euro → testuale
    .replace(/€+/g, 'EUR')
    // spazi multipli → singolo
    .replace(/\s+/g, ' ')
    .trim();
}
function writeLine(sock, s) {
  const line = sanitizeForEscpos(s) + '\n';
  // molti ESC/POS accettano latin1; con CP1252 selezionata gli accenti IT vanno ok
  sock.write(Buffer.from(line, 'latin1'));
}

// --- Layout/Wrap COMANDA -----------------------------------------------------
const COMANDA_MAX_COLS = 42;        // stima sicura per 80mm con Font A
const COMANDA_LINE_SP  = 48;        // spaziatura righe “larga” per leggibilità

function wrapText(s, max = COMANDA_MAX_COLS) {
  const text = sanitizeForEscpos(s);
  if (!text) return [];
  const words = text.split(' ');
  const out = []; let cur = '';
  for (const w of words) {
    const candidate = cur ? cur + ' ' + w : w;
    if (candidate.length <= max) cur = candidate;
    else { if (cur) out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

function qtyStr(q) { return String(Math.max(1, Number(q) || 1)).padStart(2,' '); }
function money(n){ return Number(n || 0).toFixed(2); }

// ----------------------------------------------------------------------------
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

// --- Ordinamento categorie per COMANDA (centro produzione) -------------------
const COMANDA_CATEGORY_ORDER = [
  'ANTIPASTI',
  'PIZZE ROSSE',
  'PIZZE BIANCHE',
];
function categoryRank(name) {
  const up = (name || 'Altro').toString().toUpperCase().trim();
  const idx = COMANDA_CATEGORY_ORDER.indexOf(up);
  return idx === -1 ? 100 + up.charCodeAt(0) : idx; // sconosciute dopo, ma stabili
}

// --- Estrai "Sala ..." e "Tavolo ..." ---------------------------------------
function extractTableLabel(order) {
  const direct = order.table_name || order.table_number || order.table_label || order.table_id;
  if (direct) return `Tavolo ${direct}`;
  const note = (order.note || '').toString();
  const m = note.match(/Tavolo\s+([A-Za-z0-9\-_]+)/i);
  return m ? `Tavolo ${m[1]}` : null;
}
function extractRoomLabel(order) {
  const direct = order.room_name || order.room_label || order.room;
  if (direct) return `Sala ${direct}`;
  if (order.room_id) return `Sala ${order.room_id}`;
  return null;
}

// --- Modalità ordine (fulfillment) -------------------------------------------
function resolveFulfillment(order) {
  const v = (order.fulfillment || '').toString().trim().toLowerCase();
  if (v === 'table' || v === 'takeaway' || v === 'delivery') return v;
  // Fallback compat: se ho table_id considero "table", altrimenti "takeaway".
  return order.table_id ? 'table' : 'takeaway';
}

function extractDeliveryAddressLine(order) {
  const addr = order.delivery_address || order.deliveryAddress || null;
  if (addr) return String(addr).trim();
  // Fallback minimo: provo ad usare note o telefono se mancano i campi dedicati.
  const note = order.delivery_note || order.note || null;
  if (note) return String(note).trim();
  const phone = order.delivery_phone || order.phone || null;
  if (phone) return `Tel: ${String(phone).trim()}`;
  return null;
}

// --- Formattazione orario stile “DOMENICA 10/11/2025  ore 04:42” -------------
function fmtComandaDate(iso) {
  try{
    const d = iso ? new Date(iso) : new Date();
    const gg = d.toLocaleDateString('it-IT', { weekday: 'long' }).toUpperCase();
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2,'0');
    const mn = String(d.getMinutes()).padStart(2,'0');
    return `${gg} ${dd}/${mm}/${yy}  ore ${hh}:${mn}`;
  }catch{ return String(iso || ''); }
}

// --- Stampa standard (CONTO) -------------------------------------------------
async function printSlip(title, order) {
  const sock = await openSocket();
  const write = (buf) => sock.write(buf);

  init(sock);
  // Titolo alto (come prima)
  write(esc(0x1B,0x21,0x20));       // double height (compat classic)
  write(Buffer.from(String(title)+'\n','latin1'));
  write(esc(0x1B,0x21,0x00));       // normal

  const headerLines = (PRINTER_HEADER || '').split('|').filter(Boolean);
  for (const h of headerLines) write(Buffer.from(sanitizeForEscpos(h)+'\n','latin1'));

  write(Buffer.from('------------------------------\n','latin1'));
  write(Buffer.from(`#${order.id}  ${sanitizeForEscpos(order.customer_name)}\n`,'latin1'));
  if (order.phone) write(Buffer.from(`${sanitizeForEscpos(order.phone)}\n`,'latin1'));
  if (order.people) write(Buffer.from(`Coperti: ${order.people}\n`,'latin1'));
  if (order.scheduled_at) write(Buffer.from(`Orario: ${fmtComandaDate(order.scheduled_at)}\n`,'latin1'));
  // Modalità ordine (senza cambiare le logiche esistenti: aggiungo solo righe info)
  const fulfillment = resolveFulfillment(order);
  if (fulfillment === 'table') {
    const room = extractRoomLabel(order);
    const table = extractTableLabel(order);
    if (room)  write(Buffer.from(`${sanitizeForEscpos(room)}\n`, 'latin1'));
    if (table) write(Buffer.from(`${sanitizeForEscpos(table)}\n`, 'latin1'));
  } else if (fulfillment === 'takeaway') {
    write(Buffer.from('ASPORTO\n', 'latin1'));
  } else if (fulfillment === 'delivery') {
    write(Buffer.from('DOMICILIO\n', 'latin1'));
    const line = extractDeliveryAddressLine(order);
    if (line) write(Buffer.from(`${sanitizeForEscpos(line)}\n`, 'latin1'));
  }
  write(Buffer.from('------------------------------\n','latin1'));

  for (const it of order.items) {
    write(Buffer.from(`${it.qty} x ${sanitizeForEscpos(it.name)}  ${money(it.price)}\n`,'latin1'));
    if (it.notes) write(Buffer.from(`  NOTE: ${sanitizeForEscpos(it.notes)}\n`,'latin1'));
  }

  write(Buffer.from('------------------------------\n','latin1'));
  write(Buffer.from(`Totale: ${money(order.total || 0)}\n`,'latin1'));
  if (PRINTER_FOOTER) {
    write(Buffer.from('\n','latin1'));
    for (const f of (PRINTER_FOOTER || '').split('|')) write(Buffer.from(sanitizeForEscpos(f)+'\n','latin1'));
  }
  write(Buffer.from('\n','latin1'));
  cutIfEnabled(sock);
  sock.end();
}

// --- Normalizzazione NOTE prodotto → “SENZA: …\nAGGIUNGI: …” -----------------
function normalizeNotesForKitchen(raw) {
  if (!raw) return null;
  let s = String(raw);
  // separatore “—” → newline; EXTRA → AGGIUNGI
  s = s.replace(/—/g, '\n'); // em-dash → newline
  s = s.replace(/\bEXTRA:/gi, 'AGGIUNGI:');
  // se qualcuno scrive “SENZA: … AGGIUNGI: …” su 1 sola riga con trattini → forza newline
  s = s.replace(/\s*[-–—]\s*AGGIUNGI:/gi, '\nAGGIUNGI:');
  // pulizia
  s = sanitizeForEscpos(s);
  return s;
}

// --- Stampa COMANDA (centro produzione) — font grande/bold + spacing ---------
async function printComandaSlip(title, order) {
  const sock = await openSocket();

  // init + set leggibilità (Font A, spaziatura righe, leggera spaziatura caratteri, codepage)
  init(sock);
  codepageCP1252(sock);
  fontA(sock);
  setLineSpacing(sock, COMANDA_LINE_SP);
  charSpacing(sock, 1);

  // Intestazione centrale
  alignCenter(sock);
  sizeBig(sock); boldOn(sock); writeLine(sock, title); boldOff(sock);

  const client = (order.customer_name || 'Cliente').toString().trim();
  sizeBig(sock); boldOn(sock); writeLine(sock, client); boldOff(sock);

  const room = extractRoomLabel(order);
  const table = extractTableLabel(order);
  if (room) { sizeBig(sock); boldOn(sock); writeLine(sock, room); boldOff(sock); }
  if (table){ sizeBig(sock); boldOn(sock); writeLine(sock, table); boldOff(sock); }

  // Modalità ordine: per asporto/domicilio aggiungo una riga grande e leggibile
  const fulfillment = resolveFulfillment(order);
  if (fulfillment === 'takeaway') {
    sizeBig(sock); boldOn(sock); writeLine(sock, 'ASPORTO'); boldOff(sock);
  } else if (fulfillment === 'delivery') {
    sizeBig(sock); boldOn(sock); writeLine(sock, 'DOMICILIO'); boldOff(sock);
    const line = extractDeliveryAddressLine(order);
    if (line) {
      const lines = wrapText(line, COMANDA_MAX_COLS);
      for (const ln of lines) writeLine(sock, ln);
    }
  }

  // Sub-intestazione compatta
  sizeNormal(sock);
  writeLine(sock, '==============================');
  alignLeft(sock);
  writeLine(sock, `#${order.id}`);
  if (order.people) writeLine(sock, `Coperti: ${order.people}`);
  if (order.scheduled_at) writeLine(sock, `Orario: ${fmtComandaDate(order.scheduled_at)}`);
  if (order.phone) writeLine(sock, `Tel: ${order.phone}`);
  if (order.note) {
    const nlines = wrapText(`Note: ${order.note}`, COMANDA_MAX_COLS);
    for (const ln of nlines) writeLine(sock, ln);
  }
  writeLine(sock, '------------------------------');

  // Raggruppa per categoria con ordinamento desiderato
  const groups = new Map(); // cat -> items[]
  for (const it of (order.items || [])) {
    const cat = (it.category || 'Altro').toString();
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(it);
  }
  const categories = Array.from(groups.keys()).sort((a,b) => {
    const ra = categoryRank(a), rb = categoryRank(b);
    return ra === rb ? a.localeCompare(b, 'it') : ra - rb;
  });

  // Stampa per categoria
  let grand = 0;
  for (const cat of categories) {
    const list = groups.get(cat) || [];

    // Header categoria in bold (un pelo più grande)
    writeLine(sock, ''); // riga vuota
    boldOn(sock); sizeTall(sock); writeLine(sock, cat.toUpperCase()); boldOff(sock); sizeNormal(sock);
    writeLine(sock, '------------------------------');

    // Prodotto: qty ben visibile + nome in bold (UPPER), con spaziatura verticale extra
    for (const it of list) {
      const qty = Math.max(1, Number(it.qty) || 1);
      const qtyTxt = qtyStr(qty);
      const name = (it.name || '').toString().trim().toUpperCase();

      // Riga principale (grande)
      boldOn(sock); sizeTall(sock);
      writeLine(sock, `${qtyTxt} x ${name}`);
      boldOff(sock); sizeNormal(sock);

      // NOTE (normalizzate: SENZA → newline → AGGIUNGI)
      if (it.notes) {
        const norm = normalizeNotesForKitchen(it.notes);
        const lines = wrapText(`NOTE: ${norm}`, COMANDA_MAX_COLS);
        boldOn(sock);
        for (const ln of lines) writeLine(sock, '  ' + ln);
        boldOff(sock);
      }

      // Prezzi in piccolo (unitario e totale riga)
      const unit = Number(it.price || 0);
      const rowTot = unit * qty;
      if (unit > 0) {
        writeLine(sock, `  prezzo: ${money(unit)}  •  riga: ${money(rowTot)}`);
      }
      grand += rowTot;

      // aria tra righe prodotto
      feedLines(sock, 1);
    }
  }

  // Totale COMANDA (solo numerico, niente €)
  alignCenter(sock);
  writeLine(sock, '==============================');
  boldOn(sock); writeLine(sock, `TOTALE: ${money(grand)}`); boldOff(sock);

  // Footer tecnico + reset spacing + taglio
  writeLine(sock, '');
  writeLine(sock, 'COMANDA');
  writeLine(sock, '');

  resetLineSpacing(sock);
  charSpacing(sock, 0);
  cutIfEnabled(sock);
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
    note: orderFull.note,                 // per eventuale 'Tavolo ...'
    fulfillment: orderFull.fulfillment,
    delivery_name: orderFull.delivery_name,
    delivery_phone: orderFull.delivery_phone,
    delivery_address: orderFull.delivery_address,
    delivery_note: orderFull.delivery_note,
    table_name: orderFull.table_name,     // se forniti dal chiamante
    table_number: orderFull.table_number, // idem
    table_id: orderFull.table_id,         // idem
    room_name: orderFull.room_name,       // 🆕 sala se disponibile
    room_id: orderFull.room_id,           // 🆕 id sala come fallback
  };

  if (pizzeria.length) {
    await printSlip('PIZZERIA', { ...head, items: pizzeria });
    logger.info('🖨️  PIZZERIA printed', { id: orderFull.id, items: pizzeria.length });
  }
  if (kitchen.length) {
    await printSlip('CUCINA', { ...head, items: kitchen });
    logger.info('🖨️  CUCINA printed', { id: orderFull.id, items: kitchen.length });
  }
}

// 🆕 Stampa SOLO un centro (PIZZERIA | CUCINA) — usa la formattazione COMANDA
async function printOrderForCenter(orderFull, center = 'PIZZERIA') {
  if (PRINTER_ENABLED !== 'true') {
    logger.warn('🧾 PRINT(comanda) disabled (PRINTER_ENABLED=false)');
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
    note: orderFull.note,
    fulfillment: orderFull.fulfillment,
    delivery_name: orderFull.delivery_name,
    delivery_phone: orderFull.delivery_phone,
    delivery_address: orderFull.delivery_address,
    delivery_note: orderFull.delivery_note,
    table_name: orderFull.table_name,
    table_number: orderFull.table_number,
    table_id: orderFull.table_id,
    room_name: orderFull.room_name,   // 🆕
    room_id: orderFull.room_id,       // 🆕
  };

  const which = String(center || 'PIZZERIA').toUpperCase();
  const payload = which === 'CUCINA' ? kitchen : pizzeria;
  const title   = which === 'CUCINA' ? 'CUCINA' : 'PIZZERIA';

  if (!payload.length) {
    logger.info('🧾 comanda skip (no items per centro)', { id: orderFull.id, center: which });
    return;
  }
  await printComandaSlip(title, { ...head, items: payload }); // 👈 stile COMANDA
  logger.info('🧾 comanda printed', { id: orderFull.id, center: which, items: payload.length });
}

module.exports = { printOrderDual, printOrderForCenter };
```
