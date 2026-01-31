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
