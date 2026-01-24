'use strict';

/**
 * API NOTIFICATIONS
 * -----------------
 * Rotte per invio email e WhatsApp (test/simple), con fallback sicuri.
 * Obiettivo: MAI passare ad Express handler undefined.
 *
 * Stile: log con emoji, requireAuth con fallback DEV, guardie robuste.
 *
 * ✅ PULIZIA WA:
 * - Usiamo SOLO ../services/whatsapp.service come unico punto WA
 * - Niente più doppioni whatsapp-twilio.service
 */

const express = require('express');
const router  = express.Router();

const logger = require('../logger');

// === requireAuth con fallback DEV (stile già usato altrove) ==================
let requireAuth;
try {
  ({ requireAuth } = require('../middleware/auth'));
  if (typeof requireAuth !== 'function') throw new Error('requireAuth non è una funzione');
  logger.info('🔐 requireAuth caricato da ../middleware/auth');
} catch (e) {
  logger.warn('⚠️ requireAuth non disponibile. Uso FALLBACK DEV (solo locale).', { error: String(e) });
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
  mailer = require('../services/mailer.service');
  logger.info('📧 mailer.service caricato');
} catch {
  logger.warn('📧 mailer.service non disponibile');
}

let waSvc = null;
try {
  waSvc = require('../services/whatsapp.service');
  logger.info('📲 whatsapp.service caricato (UNICO)');
} catch {
  logger.warn('📲 whatsapp.service non disponibile');
  waSvc = null;
}

// === Helper: wrapper sicuro per route handler ================================
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
    waHealth: waSvc?.health ? waSvc.health() : null
  });
});

// === EMAIL ===================================================================
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
 */
router.post(
  '/wa/test',
  requireAuth,
  safeRoute('wa.test', async (req, res) => {
    if (!waSvc) return res.status(501).json({ error: 'wa_not_available' });

    const to   = (req.body?.to || '').toString().trim();
    const text = (req.body?.text || 'Ciao 👋 questo è un messaggio di test').toString();
    if (!to) return res.status(400).json({ error: 'missing_to' });

    // Ora sendText è GARANTITO dal service unico
    const out = await waSvc.sendText({ to, text });
    logger.info('📲 WA test inviato ✅', { to, sid: out?.sid || null, skipped: !!out?.skipped });
    res.json({ ok: true, sid: out?.sid || null, skipped: out?.skipped || false, reason: out?.reason || null });
  })
);

/**
 * POST /api/notifications/wa/send
 * body: { to, text, mediaUrl? }
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

    const out = await waSvc.sendText({ to, text, mediaUrl });
    logger.info('📲 WA inviato ✅', { to, sid: out?.sid || null, hasMedia: !!mediaUrl, skipped: !!out?.skipped });
    res.json({ ok: true, sid: out?.sid || null, skipped: out?.skipped || false, reason: out?.reason || null });
  })
);

module.exports = router;
