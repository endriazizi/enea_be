// ============================================================================
// /api/gift-vouchers — CRUD + stampa buoni regalo
// - Stile progetto: commenti lunghi 🇮🇹 + log con emoji
// - Update solo se status=active (e non scaduto)
// - Delete soft → status=void
// - Print → ESC/POS + audit (success/fail)
// ============================================================================

'use strict';

const express = require('express');
const router  = express.Router();

const logger = require('../logger');
const { printGiftVoucherSlip, buildQrText } = require('../services/gift-voucher-printer.service');

module.exports = (app) => {
  const db  = app?.get('db') || require('../db');
  const log = app?.get('logger') || logger;

  // Normalizza risultato db.query():
  async function q(sql, params = []) {
    const res = await db.query(sql, params);
    return (Array.isArray(res) && Array.isArray(res[0])) ? res[0] : res;
  }

  const toNum = (v, def = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const toDate = (v) => (v ? new Date(v) : null);

  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function generateCode(len = 8) {
    let out = '';
    for (let i = 0; i < len; i += 1) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
  }

  function mapRow(r) {
    if (!r) return null;
    return {
      id           : r.id,
      code         : r.code,
      value_cents  : Number(r.value_cents || 0),
      event_title  : r.event_title,
      description  : r.description || null,
      valid_from   : r.valid_from,
      valid_until  : r.valid_until,
      status       : r.status,
      status_db    : r.status_db || r.status,
      redeemed_at  : r.redeemed_at || null,
      redeemed_note: r.redeemed_note || null,
      created_at   : r.created_at,
      updated_at   : r.updated_at || null,
      qr_text      : r.qr_text || null,
    };
  }

  // =========================================================================
  // GET /api/gift-vouchers?status=&q=&from=&to=
  // =========================================================================
  router.get('/', async (req, res) => {
    try {
      const { status, q: qRaw, from, to } = req.query || {};
      const qStr = String(qRaw || '').trim();
      const conds = [];
      const params = [];

      if (from) {
        conds.push('gv.created_at >= ?');
        params.push(toDate(from));
      }
      if (to) {
        conds.push('gv.created_at <= ?');
        params.push(toDate(to));
      }

      const statusStr = String(status || '').toLowerCase();
      if (statusStr && statusStr !== 'all') {
        if (statusStr === 'expired') {
          conds.push(`gv.status = 'active' AND gv.valid_until < UTC_TIMESTAMP()`);
        } else if (statusStr === 'active') {
          conds.push(`gv.status = 'active' AND gv.valid_until >= UTC_TIMESTAMP()`);
        } else {
          conds.push('gv.status = ?');
          params.push(statusStr);
        }
      }

      if (qStr) {
        conds.push(`(
          gv.code LIKE ?
          OR gv.event_title LIKE ?
          OR gv.description LIKE ?
        )`);
        const like = `%${qStr}%`;
        params.push(like, like, like);
      }

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await q(
        `SELECT
           gv.*,
           gv.status AS status_db,
           CASE
             WHEN gv.status = 'active' AND gv.valid_until < UTC_TIMESTAMP() THEN 'expired'
             ELSE gv.status
           END AS status
         FROM gift_vouchers gv
         ${where}
         ORDER BY gv.id DESC
         LIMIT 500`,
        params,
      );

      const out = (rows || []).map(mapRow);
      log.info('🎁 [GiftVouchers] list', { count: out.length, status: statusStr || 'all', q: qStr || null });
      res.json(out);
    } catch (e) {
      log.error('🎁 gift-vouchers list ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'gift_vouchers_list_error' });
    }
  });

  // =========================================================================
  // GET /api/gift-vouchers/:id
  // =========================================================================
  router.get('/:id(\\d+)', async (req, res) => {
    try {
      const id = toNum(req.params.id);
      const rows = await q(
        `SELECT
           gv.*,
           gv.status AS status_db,
           CASE
             WHEN gv.status = 'active' AND gv.valid_until < UTC_TIMESTAMP() THEN 'expired'
             ELSE gv.status
           END AS status
         FROM gift_vouchers gv
         WHERE gv.id = ?
         LIMIT 1`,
        [id],
      );
      const row = rows && rows[0] ? rows[0] : null;
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });

      const qrText = buildQrText(row.code);
      res.json(mapRow({ ...row, qr_text: qrText }));
    } catch (e) {
      log.error('🎁 gift-vouchers get ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'gift_vouchers_get_error' });
    }
  });

  // =========================================================================
  // POST /api/gift-vouchers
  // =========================================================================
  router.post('/', async (req, res) => {
    const dto = req.body || {};
    try {
      const valueCents = toNum(dto.value_cents || dto.valueCents);
      if (!valueCents || valueCents <= 0) {
        return res.status(400).json({ ok: false, error: 'value_cents_invalid' });
      }
      const eventTitle = String(dto.event_title || '').trim();
      if (!eventTitle) {
        return res.status(400).json({ ok: false, error: 'event_title_required' });
      }
      const validUntil = dto.valid_until ? toDate(dto.valid_until) : null;
      if (!validUntil || isNaN(validUntil.getTime())) {
        return res.status(400).json({ ok: false, error: 'valid_until_required' });
      }
      const validFrom = dto.valid_from ? toDate(dto.valid_from) : null;

      let insertedId = null;
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
              valueCents,
              eventTitle,
              dto.description || null,
              validFrom,
              validUntil,
            ],
          );
          insertedId = r?.insertId;
          break;
        } catch (e) {
          if (String(e?.code || '').toLowerCase() === 'er_dup_entry') {
            log.warn('🎁 [GiftVouchers] code collision, retry', { attempt: i + 1 });
            continue;
          }
          throw e;
        }
      }

      if (!insertedId) {
        return res.status(500).json({ ok: false, error: 'code_generation_failed' });
      }

      const rows = await q(
        `SELECT
           gv.*,
           gv.status AS status_db,
           gv.status AS status
         FROM gift_vouchers gv
         WHERE gv.id = ?
         LIMIT 1`,
        [insertedId],
      );
      log.info('🎁 [GiftVouchers] create OK', { id: insertedId, code });
      res.status(201).json(mapRow(rows[0]));
    } catch (e) {
      log.error('🎁 gift-vouchers create ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'gift_vouchers_create_error' });
    }
  });

  // =========================================================================
  // PUT /api/gift-vouchers/:id  (solo active + non scaduto)
  // =========================================================================
  router.put('/:id(\\d+)', async (req, res) => {
    const id = toNum(req.params.id);
    const dto = req.body || {};
    try {
      const rows = await q(
        `SELECT
           id, status, valid_until
         FROM gift_vouchers
         WHERE id = ?
         LIMIT 1`,
        [id],
      );
      const existing = rows && rows[0] ? rows[0] : null;
      if (!existing) return res.status(404).json({ ok: false, error: 'not_found' });

      const isExpired = existing.status === 'active' && new Date(existing.valid_until) < new Date();
      if (existing.status !== 'active' || isExpired) {
        return res.status(409).json({ ok: false, error: 'voucher_not_editable' });
      }

      const valueCents = dto.value_cents != null || dto.valueCents != null
        ? toNum(dto.value_cents || dto.valueCents)
        : null;
      if (valueCents != null && valueCents <= 0) {
        return res.status(400).json({ ok: false, error: 'value_cents_invalid' });
      }

      const eventTitle = dto.event_title != null ? String(dto.event_title || '').trim() : null;
      if (eventTitle !== null && !eventTitle) {
        return res.status(400).json({ ok: false, error: 'event_title_required' });
      }

      const validUntil = dto.valid_until ? toDate(dto.valid_until) : null;
      if (dto.valid_until && (!validUntil || isNaN(validUntil.getTime()))) {
        return res.status(400).json({ ok: false, error: 'valid_until_required' });
      }

      const validFrom = dto.valid_from ? toDate(dto.valid_from) : null;

      await q(
        `UPDATE gift_vouchers SET
           value_cents = COALESCE(?, value_cents),
           event_title = COALESCE(?, event_title),
           description = COALESCE(?, description),
           valid_from  = COALESCE(?, valid_from),
           valid_until = COALESCE(?, valid_until),
           updated_at  = UTC_TIMESTAMP()
         WHERE id = ?`,
        [
          valueCents,
          eventTitle,
          dto.description != null ? dto.description : null,
          validFrom,
          validUntil,
          id,
        ],
      );

      const outRows = await q(
        `SELECT
           gv.*,
           gv.status AS status_db,
           CASE
             WHEN gv.status = 'active' AND gv.valid_until < UTC_TIMESTAMP() THEN 'expired'
             ELSE gv.status
           END AS status
         FROM gift_vouchers gv
         WHERE gv.id = ?
         LIMIT 1`,
        [id],
      );

      log.info('🎁 [GiftVouchers] update OK', { id });
      res.json(mapRow(outRows[0]));
    } catch (e) {
      log.error('🎁 gift-vouchers update ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'gift_vouchers_update_error' });
    }
  });

  // =========================================================================
  // DELETE /api/gift-vouchers/:id  (soft delete → status=void)
  // =========================================================================
  router.delete('/:id(\\d+)', async (req, res) => {
    const id = toNum(req.params.id);
    try {
      const rows = await q('SELECT id, status FROM gift_vouchers WHERE id = ? LIMIT 1', [id]);
      const row = rows && rows[0] ? rows[0] : null;
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });

      await q(
        `UPDATE gift_vouchers
           SET status = 'void', updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [id],
      );

      log.warn('🎁 [GiftVouchers] void OK', { id });
      res.json({ ok: true });
    } catch (e) {
      log.error('🎁 gift-vouchers void ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'gift_vouchers_void_error' });
    }
  });

  // =========================================================================
  // POST /api/gift-vouchers/:id/print
  // =========================================================================
  router.post('/:id(\\d+)/print', async (req, res) => {
    const id = toNum(req.params.id);
    const userEmail =
      (req.user && (req.user.email || req.user.username || req.user.id)) ||
      (req.body && req.body.user_email) ||
      null;
    let printerIp = null;
    let printerPort = null;
    let qrText = null;

    try {
      const rows = await q('SELECT * FROM gift_vouchers WHERE id = ? LIMIT 1', [id]);
      const voucher = rows && rows[0] ? rows[0] : null;
      if (!voucher) return res.status(404).json({ ok: false, error: 'not_found' });

      qrText = buildQrText(voucher.code);

      try {
        const out = await printGiftVoucherSlip({ voucher, qrText });
        printerIp = out?.printer?.ip || null;
        printerPort = out?.printer?.port || null;

        await q(
          `INSERT INTO gift_voucher_print_jobs
            (voucher_id, status, error, printer_ip, printer_port, qr_text, created_by)
           VALUES (?,?,?,?,?,?,?)`,
          [id, 'success', null, printerIp, printerPort, qrText, userEmail],
        );

        log.info('🧾 [GiftVouchers] print OK', { id });
        return res.json({ ok: true });
      } catch (e) {
        const reason = String((e && e.message) || e);
        await q(
          `INSERT INTO gift_voucher_print_jobs
            (voucher_id, status, error, printer_ip, printer_port, qr_text, created_by)
           VALUES (?,?,?,?,?,?,?)`,
          [id, 'failed', reason, printerIp, printerPort, qrText, userEmail],
        );

        log.warn('🧾 [GiftVouchers] print KO', { id, error: reason });
        return res.status(502).json({ ok: false, error: 'printer_error', reason });
      }
    } catch (e) {
      log.error('🧾 gift-vouchers print ❌', { error: String(e) });
      return res.status(500).json({ ok: false, error: 'gift_vouchers_print_error' });
    }
  });

  // =========================================================================
  // (opzionale) POST /api/gift-vouchers/:id/redeem
  // =========================================================================
  router.post('/:id(\\d+)/redeem', async (req, res) => {
    const id = toNum(req.params.id);
    const note = req.body?.note || null;
    try {
      const rows = await q('SELECT id, status FROM gift_vouchers WHERE id = ? LIMIT 1', [id]);
      const row = rows && rows[0] ? rows[0] : null;
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      if (row.status !== 'active') {
        return res.status(409).json({ ok: false, error: 'voucher_not_redeemable' });
      }

      await q(
        `UPDATE gift_vouchers
           SET status = 'redeemed',
               redeemed_at = UTC_TIMESTAMP(),
               redeemed_note = ?,
               updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [note, id],
      );

      const outRows = await q(
        `SELECT
           gv.*,
           gv.status AS status_db,
           gv.status AS status
         FROM gift_vouchers gv
         WHERE gv.id = ?
         LIMIT 1`,
        [id],
      );
      log.info('🎁 [GiftVouchers] redeem OK', { id });
      res.json(mapRow(outRows[0]));
    } catch (e) {
      log.error('🎁 gift-vouchers redeem ❌', { error: String(e) });
      res.status(500).json({ ok: false, error: 'gift_vouchers_redeem_error' });
    }
  });

  return router;
};
