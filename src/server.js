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
const { processPrintQueueOnce } = require('./services/print-jobs.service');

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

// Consenti embed in iframe da altri siti (prenota = contenuto incorporabile)
// Imposta Content-Security-Policy: frame-ancestors; default * (tutti). Su Plesk l’HTML è servito da Apache/Nginx: vedi docs/EMBED-IFRAME-PLESK.md
const frameAncestors = (env.FRAME_ANCESTORS || '*').trim();
if (frameAncestors) {
  app.use((_req, res, next) => {
    res.set('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
    next();
  });
}

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

// 🆕 WhatsApp WebQR (BLOCCO 3 — stub: GET /status, /qr, POST /send)
if (ensureExists('api/whatsapp-webqr', 'API /api/whatsapp-webqr'))
  app.use('/api/whatsapp-webqr', require('./api/whatsapp-webqr'));

// 🆕 WhatsApp Templates (preview + send reservation-received)
if (ensureExists('api/whatsapp-templates', 'API /api/whatsapp'))
  app.use('/api/whatsapp', require('./api/whatsapp-templates'));

// 🆕 Gift Vouchers (Buoni Regalo)
if (ensureExists('api/gift-vouchers', 'API /api/gift-vouchers'))
  app.use('/api/gift-vouchers', require('./api/gift-vouchers')(app));

// 🍟 FRY: ordine al volo antipasti + cucina live (pubblico, x-fry-key se FRY_PUBLIC_KEY)
if (ensureExists('api/fry', 'API /api/fry'))
  app.use('/api/fry', require('./api/fry'));

// 🆕 Public voucher activation (no-auth)
if (ensureExists('api/public-voucher', 'API /api/public/voucher'))
  app.use('/api/public', require('./api/public-voucher')(app));

// Health
if (ensureExists('api/health', 'API /api/health'))
  app.use('/api/health', require('./api/health'));

// 📊 Reports (dashboard aggregati)
if (ensureExists('api/reports', 'API /api/reports'))
  app.use('/api/reports', require('./api/reports'));

// [DEV] Support dev: POST /api/support/dev/restart (solo NODE_ENV!==production + DEV_ALLOW_RESTART=1)
if (ensureExists('api/support.dev', 'API /api/support/dev'))
  app.use('/api/support/dev', require('./api/support.dev'));

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

// TASK E: error handler finale per loggare 500 e rispondere JSON
app.use((err, _req, res, _next) => {
  const path = _req?.path ?? _req?.url ?? '';
  const method = _req?.method ?? '';
  logger.error('[API] 💥 500', { path, method, err: String(err?.message || err) });
  if (!res.headersSent) {
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

server.listen(env.PORT, () =>
  logger.info(`🚀 HTTP listening on :${env.PORT}`),
);

// ============================================================================
// 🧾 Worker coda stampa (best-effort, no crash)
// ============================================================================

const PRINT_QUEUE_ENABLED =
  String(process.env.PRINT_QUEUE_ENABLED || 'true') === 'true';
const PRINT_QUEUE_INTERVAL_MS = Math.max(
  5_000,
  Number(process.env.PRINT_QUEUE_INTERVAL_MS || 30_000),
);

if (PRINT_QUEUE_ENABLED) {
  setInterval(async () => {
    try {
      await processPrintQueueOnce({ limit: 5 });
    } catch (e) {
      logger.warn('🧾🧵 print queue tick KO (best-effort)', {
        error: String((e && e.message) || e),
      });
    }
  }, PRINT_QUEUE_INTERVAL_MS);
  logger.info('🧾🧵 print queue ON', { every_ms: PRINT_QUEUE_INTERVAL_MS });
} else {
  logger.info('🧾🧵 print queue OFF (PRINT_QUEUE_ENABLED=false)');
}
