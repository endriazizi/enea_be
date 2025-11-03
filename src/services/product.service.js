'use strict';

/**
 * Product Service
 * ----------------
 * - Query centralizzate su `products` (+ join categorie)
 * - Restituisce SEMPRE array "puliti" (query wrapper torna already rows)
 * - Log verbosi con emoji, in linea con il tuo stile
 */

const logger = require('../logger');

// ✅ Importa la funzione `query` già "wrapped" dal nostro db/index.js
//    (evita di usare `const db = require('../db')` → poi `db.query(...)`,
//     perché se il require fallisce `db` diventa undefined e scoppia)
const { query } = require('../db');

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
};

// GET all (opz. solo attivi)
async function getAll({ active = false } = {}) {
  logger.debug('🧾 products.getAll', { active });

  const sql = `
    SELECT
      p.id, p.name, p.description, p.price, p.is_active, p.sort_order,
      p.category_id, c.name AS category
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ${active ? 'WHERE p.is_active = 1' : ''}
    ORDER BY c.name, p.sort_order, p.id
  `;
  // il nostro wrapper ritorna direttamente `rows`
  const rows = await query(sql, []);
  return rows || [];
}

// GET by id
async function getById(id) {
  logger.debug('🧾 products.getById', { id });
  const rows = await query(
    `SELECT p.id, p.name, p.description, p.price, p.is_active, p.sort_order,
            p.category_id, c.name AS category
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ?`,
    [id]
  );
  return rows?.[0] || null;
}

// CREATE (campi minimi)
async function create(payload) {
  logger.debug('🧾 products.create', { payload });

  const {
    name,
    description = null,
    price = 0,
    is_active = 1,
    sort_order = 100,
    category_id = null,
  } = payload || {};

  if (!name) throw new Error('name_required');

  const result = await query(
    `INSERT INTO products
       (name, description, price, is_active, sort_order, category_id)
     VALUES (?,?,?,?,?,?)`,
    [name, description, price, is_active ? 1 : 0, sort_order, category_id]
  );

  // mysql2.execute() nel nostro wrapper torna rows, ma per INSERT usiamo affectedRows/insertId
  // il wrapper già restituisce rows, quindi per coerenza facciamo una GET by id
  // (così garantiamo stesso shape della read)
  const rows = await query('SELECT LAST_INSERT_ID() AS id');
  const id = rows?.[0]?.id;
  return getById(id);
}

// UPDATE
async function update(id, payload) {
  logger.debug('🧾 products.update', { id, payload });

  const cur = await getById(id);
  if (!cur) return null;

  const next = {
    name: payload?.name ?? cur.name,
    description: payload?.description ?? cur.description,
    price: payload?.price ?? cur.price,
    is_active: (payload?.is_active ?? cur.is_active) ? 1 : 0,
    sort_order: payload?.sort_order ?? cur.sort_order,
    category_id: payload?.category_id ?? cur.category_id,
  };

  await query(
    `UPDATE products
       SET name=?, description=?, price=?, is_active=?, sort_order=?, category_id=?
     WHERE id=?`,
    [
      next.name, next.description, next.price, next.is_active,
      next.sort_order, next.category_id, id
    ]
  );

  return getById(id);
}

// DELETE
async function remove(id) {
  logger.debug('🧾 products.remove', { id });
  const rows = await query(`DELETE FROM products WHERE id = ?`, [id]);
  // Se il wrapper ritorna oggetto "OkPacket", potremmo non avere affectedRows qui;
  // in ogni caso, una seconda read conferma la rimozione.
  const check = await getById(id);
  return !check;
}
