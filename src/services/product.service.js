// src/services/product.service.js
'use strict';

/**
 * ProductService
 * --------------
 * - Query DB tramite wrapper unico (mysql2/promise) con log.
 * - JOIN categorie per restituire anche category name/icon.
 * - Create/Update: accetta sia category_id (numero) sia category (stringa),
 *   creando la categoria se non esiste (safe) quando passi il nome.
 *
 * Stile: commenti lunghi, log con emoji, niente sorprese.
 */

const { query } = require('../db');
const logger = require('../logger');

// Helper: normalizza boolean-like in 0/1
function toFlag(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).toLowerCase();
  return (s === '1' || s === 'true' || s === 'yes' || s === 'y') ? 1 : 0;
}

// Helper: crea o trova category_id partendo da { category_id?, category? }
async function ensureCategoryId(input) {
  const byId = Number(input?.category_id);
  if (Number.isFinite(byId) && byId > 0) return byId;

  const name = (input?.category || '').toString().trim();
  if (!name) return null;

  // prova a trovarla
  const rows = await query('SELECT id FROM categories WHERE name=? LIMIT 1', [name]);
  if (rows?.length) return rows[0].id;

  // se non esiste, creala (attiva, sort_order 0)
  const res = await query('INSERT INTO categories (name, is_active, sort_order) VALUES (?, 1, 0)', [name]);
  logger.info('📦 category created', { id: res.insertId, name });
  return res.insertId;
}

module.exports = {
  // ----------------------------------------------------------------------------
  // LIST (opzione active-only)
  // ----------------------------------------------------------------------------
  async getAll({ active } = {}) {
    const onlyActive = !!active;
    const sql = `
      SELECT
        p.id, p.name, p.description, p.price, p.is_active, p.sort_order, p.category_id,
        c.name AS category, c.icon
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${onlyActive ? 'WHERE p.is_active = 1' : ''}
      ORDER BY COALESCE(c.sort_order, 9999), c.name,
               COALESCE(p.sort_order, 9999), p.name
    `;
    const rows = await query(sql);
    logger.info('📤 products list', { count: rows.length, onlyActive });
    return rows;
  },

  // ----------------------------------------------------------------------------
  // GET BY ID
  // ----------------------------------------------------------------------------
  async getById(id) {
    const sql = `
      SELECT
        p.id, p.name, p.description, p.price, p.is_active, p.sort_order, p.category_id,
        c.name AS category, c.icon
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?
      LIMIT 1
    `;
    const rows = await query(sql, [id]);
    return rows?.[0] || null;
  },

  // ----------------------------------------------------------------------------
  // CREATE
  // ----------------------------------------------------------------------------
  async create(data) {
    const name = (data?.name || '').toString().trim();
    if (!name) throw new Error('missing_name');

    const price = Number(data?.price ?? 0);
    if (!Number.isFinite(price)) throw new Error('invalid_price');

    const category_id = await ensureCategoryId(data);
    const is_active = toFlag(data?.is_active);
    const sort_order = Number.isFinite(Number(data?.sort_order)) ? Number(data.sort_order) : 0;
    const description = (data?.description || null) ? String(data.description) : null;

    const sql = `
      INSERT INTO products (category_id, name, description, price, is_active, sort_order)
      VALUES (?, ?, ?, ?, COALESCE(?,1), ?)
    `;
    const res = await query(sql, [category_id, name, description, price, is_active, sort_order]);

    logger.info('➕ product created', { id: res.insertId, name, price, category_id });
    return await this.getById(res.insertId);
  },

  // ----------------------------------------------------------------------------
  // UPDATE
  // ----------------------------------------------------------------------------
  async update(id, data) {
    const current = await this.getById(id);
    if (!current) return null;

    const category_id = (data.hasOwnProperty('category') || data.hasOwnProperty('category_id'))
      ? await ensureCategoryId(data)
      : current.category_id;

    const name        = (data?.name !== undefined)        ? String(data.name).trim() : current.name;
    const description = (data?.description !== undefined) ? (data.description ? String(data.description) : null) : current.description;
    const price       = (data?.price !== undefined)       ? Number(data.price) : current.price;
    const sort_order  = (data?.sort_order !== undefined)  ? Number(data.sort_order) : current.sort_order;
    const is_active   = (data?.is_active !== undefined)   ? toFlag(data.is_active) : current.is_active;

    const sql = `
      UPDATE products
      SET category_id = ?,
          name = ?,
          description = ?,
          price = ?,
          is_active = ?,
          sort_order = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    await query(sql, [category_id, name, description, price, is_active, sort_order, id]);

    logger.info('✏️ product updated', { id, name });
    return await this.getById(id);
  },

  // ----------------------------------------------------------------------------
  // DELETE (hard)
  // ----------------------------------------------------------------------------
  async remove(id) {
    const res = await query('DELETE FROM products WHERE id=?', [id]);
    const ok = res?.affectedRows > 0;
    logger.info(ok ? '🗑️ product deleted' : '🗑️ product delete: not found', { id });
    return ok;
  }
};
