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
