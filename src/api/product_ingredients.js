// server/src/api/product_ingredients.js
// ============================================================================
// REST: GET /api/product-ingredients?product_id=ID
//       GET /api/product-ingredients/:id
// Ritorna un ARRAY di ingredienti per il prodotto (utile per chips):
//   [{ id, name, price_delta, is_default, sort_order, product_id }]
// Nota: se non hai price_delta/is_default/sort_order in tabella, i valori
//       verranno 0/false/null automaticamente (COALESCE).
// ============================================================================
const express = require('express');
const router = express.Router();
const db = require('../db');          // mysql2/promise pool
const log = require('../logger')||console;

const BASE_SQL = `
  SELECT
    i.id,
    i.name,
    COALESCE(pi.price_delta, 0) AS price_delta,
    COALESCE(pi.is_default, 0)  AS is_default,
    COALESCE(pi.sort_order, 0)  AS sort_order,
    ? AS product_id
  FROM ingredients i
  LEFT JOIN product_ingredients pi
         ON pi.ingredient_id = i.id AND pi.product_id = ?
  WHERE i.is_active = 1
  ORDER BY COALESCE(pi.sort_order, 0), i.name
`;

async function listByProductId(productId){
  const [rows] = await db.query(BASE_SQL, [productId, productId]);
  return rows.map(r => ({
    id: Number(r.id),
    name: r.name,
    price_delta: Number(r.price_delta || 0),
    is_default: !!r.is_default,
    sort_order: r.sort_order == null ? null : Number(r.sort_order),
    product_id: Number(productId),
  }));
}

// /api/product-ingredients?product_id=ID
router.get('/', async (req,res) => {
  try{
    const id = Number(req.query.product_id || 0);
    if(!id) return res.status(400).json({ ok:false, error:'product_id richiesto' });
    const items = await listByProductId(id);
    return res.json({ ok:true, items });
  }catch(err){
    log.error('🥫 [/product-ingredients] KO', err);
    return res.status(500).json({ ok:false, error:String(err?.message||err) });
  }
});

// /api/product-ingredients/:id
router.get('/:id', async (req,res) => {
  try{
    const id = Number(req.params.id || 0);
    if(!id) return res.status(400).json({ ok:false, error:'id non valido' });
    const items = await listByProductId(id);
    return res.json({ ok:true, items });
  }catch(err){
    log.error('🥫 [/product-ingredients/:id] KO', err);
    return res.status(500).json({ ok:false, error:String(err?.message||err) });
  }
});

module.exports = router;
