'use strict';

/**
 * services/orders.service.js
 * -----------------------------------------------------------------------------
 * Query e operazioni transazionali per ORDINI.
 * - Stile: log con emoji, errori espliciti.
 * - Transazioni con pool.getConnection() per header+righe atomiche.
 */

const { pool, query } = require('../db');
const logger = require('../logger');

// Helpers ---------------------------------------------------------------------
function toInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function toMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function nowIso() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

// Service ---------------------------------------------------------------------
const Orders = {
  /**
   * Crea un ordine con le righe in transazione.
   * dto: {
   *  customer_name, phone, email?, people?, scheduled_at?, note?, channel?,
   *  items: [{ product_id?, name, qty, price, notes? }]
   * }
   */
  async create(dto) {
    if (!dto || !Array.isArray(dto.items) || dto.items.length === 0) {
      throw new Error('missing_items');
    }
    const items = dto.items.map(it => ({
      product_id: it.product_id ?? null,
      name: String(it.name || '').trim(),
      qty: toInt(it.qty, 1),
      price: toMoney(it.price),
      notes: (it.notes ?? null) ? String(it.notes).trim() : null,
    })).filter(it => it.name && it.qty > 0);

    if (!items.length) throw new Error('invalid_items');

    const total = items.reduce((acc, it) => acc + (it.qty * it.price), 0);

    const header = {
      customer_name: String(dto.customer_name || '').trim() || null,
      phone: (dto.phone || dto.customer_phone || null),
      email: (dto.email || dto.customer_email || null),
      people: toInt(dto.people, 1),
      scheduled_at: dto.scheduled_at ? String(dto.scheduled_at).slice(0, 19) : null,
      note: dto.note ? String(dto.note).trim() : null,
      channel: (dto.channel || 'online').toString().toLowerCase(),
      status: 'pending',
      total: toMoney(total),
      created_at: nowIso()
    };

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [res] = await conn.query(
        `INSERT INTO orders
         (customer_name, phone, email, people, scheduled_at, note, channel, status, total, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [header.customer_name, header.phone, header.email, header.people, header.scheduled_at,
         header.note, header.channel, header.status, header.total, header.created_at]
      );

      const orderId = Number(res.insertId);

      const values = [];
      const params = [];
      for (const it of items) {
        values.push('(?,?,?,?,?,?,?)');
        params.push(orderId, it.product_id, it.name, it.qty, it.price, it.notes, nowIso());
      }

      await conn.query(
        `INSERT INTO order_items
         (order_id, product_id, name, qty, price, notes, created_at)
         VALUES ${values.join(',')}`,
        params
      );

      await conn.commit();

      logger.info('🆕 ORDINE creato ✅', { id: orderId, items: items.length, total: header.total });
      return { id: orderId, ...header };
    } catch (err) {
      await conn.rollback();
      logger.error('💥 ORDINE create ❌ ROLLBACK', { error: String(err) });
      throw err;
    } finally {
      conn.release();
    }
  },

  async setStatus(id, status) {
    const valid = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!valid.includes(String(status))) throw new Error('invalid_status');

    await query(
      `UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? LIMIT 1`,
      [status, id]
    );
    logger.info('✏️ ORDINE status aggiornato', { id, status });
    return true;
  },

  /** Lista “header” (senza righe) */
  async listHeaders() {
    const rows = await query(
      `SELECT id, customer_name, phone, email, people, scheduled_at, status, total, channel, created_at, updated_at
       FROM orders
       ORDER BY id DESC
       LIMIT 500`
    );
    return rows;
  },

  /** Lista completa con righe (hydrate) */
  async listFull() {
    const headers = await this.listHeaders();
    if (!headers.length) return [];
    const ids = headers.map(h => h.id);
    const items = await query(
      `SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
      ids
    );
    const map = new Map(headers.map(h => [h.id, { ...h, items: [] }]));
    for (const it of items) {
      const h = map.get(it.order_id);
      if (h) h.items.push(it);
    }
    return Array.from(map.values());
  },

  async listByStatus(status) {
    const rows = await query(
      `SELECT id, customer_name, phone, email, people, scheduled_at, status, total, channel, created_at, updated_at
       FROM orders
       WHERE status=?
       ORDER BY id DESC
       LIMIT 500`,
      [status]
    );
    return rows;
  },

  async listLastHours(hours = 24) {
    const h = Math.max(1, Math.min(168, parseInt(hours, 10) || 24)); // 1..168
    const rows = await query(
      `SELECT id, customer_name, phone, email, people, scheduled_at, status, total, channel, created_at, updated_at
       FROM orders
       WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? HOUR)
       ORDER BY id DESC`,
      [h]
    );
    return rows;
  }
};

module.exports = Orders;
