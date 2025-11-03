// server/src/api/product_ingredients.js
// ============================================================================
// API — Product Ingredients (by product)
// Restituisce gli ingredienti collegati ad un prodotto in forma "chips-ready":
//  - GET /api/product-ingredients/by-product/:productId
//    → [
//        { ingredient_id, name, is_default:1, is_extra:0, price_extra:null, allergen:0, sort_order:... },
//        ...
//      ]
// NOTE:
// - Per non "spaccare" lo schema esistente, qui torniamo SOLO gli ingredienti
//   BASE (quelli presenti in product_ingredients). Gli "extra" sono opzionali
//   e potranno essere introdotti in un secondo step (con colonne dedicate).
// - La tua UI gestisce bene anche solo i "base" (rimovibili); gli extra
//   resteranno semplicemente vuoti.
// ============================================================================

const express = require('express');
const router = express.Router();
const logger = require('../logger');

// 🔌 DB compat: il tuo progetto può esportare `pool` oppure direttamente `query`
let pool, query;
try {
  ({ pool, query } = require('../db'));
} catch (e) {
  logger.error('❌ Impossibile caricare ../db (pool/query)', { error: String(e) });
}

// Wrapper di compatibilità: usa `query(sql, params)` se presente, altrimenti `pool.query`
async function runQuery(sql, params = []) {
  if (typeof query === 'function') {
    // mysql2/promise → query(sql, params) → rows
    return await query(sql, params);
  }
  if (pool && typeof pool.query === 'function') {
    // mysql2/promise → pool.query(sql, params) → [rows, fields]
    const [rows] = await pool.query(sql, params);
    return rows;
  }
  throw new Error('DB not initialized');
}

// Ping di servizio (facoltativo)
router.get('/', (_req, res) => {
  res.json({ ok: true, hint: 'Use /by-product/:productId' });
});

// GET /api/product-ingredients/by-product/:productId
router.get('/by-product/:productId', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = Number(req.params.productId || 0);

  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ error: 'productId non valido' });
  }
  if (!query && !(pool && pool.query)) {
    logger.error('❌ DB non disponibile per /product-ingredients', { productId: id });
    return res.status(500).json({ error: 'DB non inizializzato' });
  }

  try {
    // Ingredienti BASE collegati al prodotto (tabella di join product_ingredients)
    // NB: non usiamo colonne che potrebbero non esistere nel tuo schema attuale.
    const sql = `
      SELECT
        i.id  AS ingredient_id,
        i.name AS name,
        1       AS is_default,           -- incluso di base
        0       AS is_extra,             -- nessun extra in questo step
        NULL    AS price_extra,          -- opzionale in futuro
        0       AS allergen,             -- opzionale in futuro (fallback)
        IFNULL(pi.sort_order, 0) AS sort_order
      FROM product_ingredients pi
      JOIN ingredients i ON i.id = pi.ingredient_id
      WHERE pi.product_id = ?
      ORDER BY pi.sort_order, i.name
    `;
    const rows = await runQuery(sql, [id]);

    logger.info('🧩 [API] by-product ✓', { productId: id, base_count: rows.length });
    return res.json(rows || []);
  } catch (err) {
    logger.error('🧩❌ [API] by-product query KO', { productId: id, error: String(err) });
    return res.status(500).json({ error: 'Query error' });
  }
});

module.exports = router;
