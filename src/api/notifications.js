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
