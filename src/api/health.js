// src/api/health.js
// Endpoints di diagnostica. /api/health/time mostra orari server+DB.
// GET /api/health/twilio = stato gate Twilio (enabled, dryRun, reason, hasCreds).
// 🆕 GET /api/health/summary = riepilogo per dashboard (ping, time, tz, printer, versione).

const router = require('express').Router();
const { query } = require('../db');
const logger = require('../logger');
const twilioService = require('../services/twilio.service');

// ============================================================================
// 🆕 GET /api/health/summary — riepilogo per Dashboard Admin
// ============================================================================
router.get('/summary', async (_req, res) => {
  logger.info('📊 [GET] /api/health/summary');
  try {
    const now = new Date();
    const appTz = process.env.APP_TZ || process.env.TZ || process.env.BIZ_TZ || 'Europe/Rome';

    // Ping ok (siamo qui = risponde)
    const ping = { ok: true, time: now.toISOString() };

    // Info time (Node + DB)
    let timeInfo = null;
    try {
      const rows = await query(`
        SELECT
          @@global.time_zone AS global_time_zone,
          @@session.time_zone AS session_time_zone,
          NOW() AS now_session,
          UTC_TIMESTAMP() AS now_utc,
          TIMEDIFF(NOW(), UTC_TIMESTAMP()) AS diff_session_vs_utc
      `);
      timeInfo = rows && rows[0] ? rows[0] : {};
    } catch (e) {
      logger.warn('⚠️ health/summary: time query KO', { error: String(e) });
    }

    // Stampante (print-settings)
    let printer = { enabled: false, configured: false };
    try {
      const { getPrintSettings } = require('../services/print-settings.service');
      const st = await getPrintSettings();
      printer = {
        enabled: !!st?.printer_enabled,
        configured: !!(st?.printer_ip || st?.printer_host),
      };
    } catch (e) {
      logger.warn('⚠️ health/summary: print-settings KO', { error: String(e) });
    }

    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      ping,
      app: {
        serverTZ: Intl.DateTimeFormat().resolvedOptions().timeZone || '(unknown)',
        nodeNow: now.toString(),
        nodeIso: now.toISOString(),
        envTZ: process.env.TZ || '(unset)',
        APP_TZ: appTz,
      },
      db: timeInfo,
      printer,
      version: process.env.APP_VERSION || process.env.npm_package_version || null,
    });
  } catch (err) {
    logger.error('❌ [GET] /api/health/summary', { error: String(err) });
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

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
