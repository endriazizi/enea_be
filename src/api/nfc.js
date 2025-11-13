// server/src/api/nfc.js
// ============================================================================
// API NFC — bind/resolve/qr/url per tag NFC dei tavoli
// Mantiene stile log con emoji e risposte { ok, ... }.
// ============================================================================

const express = require('express');
const router  = express.Router();
const NFC     = require('../services/nfc.service');
const logger  = require('../logger');

// POST /api/nfc/bind { table_id, forceNew? }
// → { ok:true, token, url }
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

// GET /api/nfc/resolve?token=XYZ → { ok, table_id, room_id, table_number, reservation_id? }
router.get('/resolve', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).json({ ok: false, error: 'token mancante' });

    const info = await NFC.resolveToken(token);
    if (!info)  return res.status(404).json({ ok: false, error: 'not_found_or_revoked' });

    logger.info(`🔎 [API] resolve token=${token} → table_id=${info.table_id}`);
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

    // Riuso se esiste, altrimenti crea
    const token = await NFC.bindTable(tableId, { forceNew: false });
    const url   = NFC.buildPublicUrl(token, req);
    res.json({ ok: true, token, url });
  } catch (err) {
    logger.error('❌ [API] /nfc/url/:tableId', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

// GET /api/nfc/qr?u=ENCODED_URL → PNG (qrcode)
// GET /api/nfc/qr/token/:token   → PNG (qrcode della URL pubblica)
router.get('/qr', async (req, res) => {
  try {
    const url = String(req.query.u || '').trim();
    if (!url) return res.status(400).json({ ok: false, error: 'u mancante' });

    const QR = require('qrcode'); // runtime require
    res.setHeader('Content-Type', 'image/png');
    QR.toFileStream(res, url, { errorCorrectionLevel: 'M', margin: 1, scale: 6 });
  } catch (err) {
    logger.error('❌ [API] /nfc/qr', { error: String(err) });
    res.status(500).json({ ok: false, error: err?.message || 'internal_error' });
  }
});

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

module.exports = router;
