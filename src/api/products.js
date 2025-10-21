// 🌐 REST: lista prodotti attivi
const router = require('express').Router();                 // istanzia router
const { query } = require('../db');                         // query wrapper con log

router.get('/', async (req, res, next) => {                 // GET /api/products
  try {
    const rows = await query('SELECT * FROM products WHERE is_active=1 ORDER BY category, name'); // query
    res.json(rows);                                         // risponde con JSON
  } catch (e) {
    next(e);                                                // passa all'error handler globale
  }
});

module.exports = router;                                    // esporta router
