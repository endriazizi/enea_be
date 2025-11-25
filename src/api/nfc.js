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
