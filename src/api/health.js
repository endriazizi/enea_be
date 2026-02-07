// src/api/health.js
// Endpoints di diagnostica. /api/health/time mostra orari server+DB.
// GET /api/health/twilio = stato gate Twilio (enabled, dryRun, reason, hasCreds).

const router = require('express').Router();
const { query } = require('../db');
const logger = require('../logger');
const twilioService = require('../services/twilio.service');

router.get('/twilio', (_req, res) => {
  try {
    const state = twilioService.getHealthState();
    res.json(state);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

router.get('/time', async (_req, res) => {
  logger.info('🧪 TZ CHECK');
  try {
    const now = new Date();
    const app = {
      serverTZ: Intl.DateTimeFormat().resolvedOptions().timeZone || '(unknown)',
      nodeNow: now.toString(),
      nodeIso: now.toISOString(),
      envTZ: process.env.TZ || '(unset)',
    };

    // 🧪 TZ CHECK: diagnostica fuso orario DB (NOW − UTC_TIMESTAMP = diff CET)
    const rows = await query(`
      SELECT
        @@global.time_zone AS global_time_zone,
        @@session.time_zone AS session_time_zone,
        NOW()              AS now_session,
        UTC_TIMESTAMP()    AS now_utc,
        TIMEDIFF(NOW(), UTC_TIMESTAMP()) AS diff_session_vs_utc
    `);

    const db = rows && rows[0] ? rows[0] : {};

    res.json({ ok: true, app, db });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

module.exports = router;
