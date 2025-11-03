// server/src/server.js
// ============================================================================
// HTTP server + mount API routes (stile Endri: log verbose, ensureExists, CORS)
// - Aggiunta: /api/product-ingredients (ingredienti per prodotto, formato a righe)
// ============================================================================

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');

const env = require('./env');
const logger = require('./logger');

const app = express();
const server = http.createServer(app);

// ----------------------------------------------------------------------------
// Middlewares base
// ----------------------------------------------------------------------------
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

// ----------------------------------------------------------------------------
// Helper: verifica esistenza file/modulo prima del require (log chiaro)
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// Ping rapido (no cache)
// ----------------------------------------------------------------------------
app.get('/api/ping', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, time: new Date().toISOString() });
});

// ----------------------------------------------------------------------------
// API mounts (ognuna protetta da ensureExists per non far crashare il boot)
// ----------------------------------------------------------------------------
if (ensureExists('api/auth', 'API /api/auth')) app.use('/api/auth', require('./api/auth'));

if (ensureExists('api/reservations', 'API /api/reservations')) {
  app.use('/api/reservations', require('./api/reservations'));
} else {
  app.use('/api/reservations', (_req, res) =>
    res.status(501).json({ error: 'Reservations API not installed yet' })
  );
}

if (ensureExists('api/products', 'API /api/products')) app.use('/api/products', require('./api/products'));
if (ensureExists('api/orders', 'API /api/orders')) app.use('/api/orders', require('./api/orders'));
if (ensureExists('api/tables', 'API /api/tables')) app.use('/api/tables', require('./api/tables'));
if (ensureExists('api/rooms', 'API /api/rooms')) app.use('/api/rooms', require('./api/rooms'));
if (ensureExists('api/notifications', 'API /api/notifications')) app.use('/api/notifications', require('./api/notifications'));

// === NOVITÀ: Product Ingredients ============================================
// Rotta per ottenere gli ingredienti (righe) collegati ad un prodotto,
// usata nel Builder per mostrare le chips e calcolare gli extra.
if (ensureExists('api/product_ingredients', 'API /api/product-ingredients')) {
  app.use('/api/product-ingredients', require('./api/product_ingredients'));
} else {
  logger.warn('⚠️ API /api/product-ingredients non trovata: le chips ingredienti non funzioneranno');
}

// ----------------------------------------------------------------------------
// Printer routes (se presenti)
// ----------------------------------------------------------------------------
if (ensureExists('api/printer', 'API /api/printer')) {
  // Nota: dentro api/printer esporti già un router con /printer/*
  app.use('/api', require('./api/printer'));
}

// ----------------------------------------------------------------------------
// Health (sempre disponibile)
// ----------------------------------------------------------------------------
app.use('/api/health', require('./api/health'));

// ----------------------------------------------------------------------------
// Socket.IO (facoltativo) — non blocca l'avvio se mancano i file
// ----------------------------------------------------------------------------
const { Server } = require('socket.io');
const io = new Server(server, { path: '/socket.io', cors: { origin: true, credentials: true } });
if (ensureExists('sockets/index', 'Sockets entry')) {
  require('./sockets/index')(io);
} else {
  logger.warn('⚠️ sockets/index non trovato: i socket non saranno gestiti');
  io.on('connection', (s) => logger.info('🔌 socket connected (fallback)', { id: s.id }));
}

// ----------------------------------------------------------------------------
// Schema check / migrations (se presenti)
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// Start
// ----------------------------------------------------------------------------
server.listen(env.PORT, () => logger.info(`🚀 HTTP listening on :${env.PORT}`));
