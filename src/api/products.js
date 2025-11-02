// src/api/products.js
'use strict';

/**
 * /api/products
 * --------------
 * Elenco prodotti con JOIN categorie + CRUD.
 * Mantiene lo stile: log chiari, errori espliciti, wrapper service.
 */

const express = require('express');
const router  = express.Router();

const logger  = require('../logger');
const svc     = require('../services/product.service');

// GET /api/products?active=1
router.get('/', async (req, res) => {
  try {
    const activeParam = String(req.query.active ?? '').trim().toLowerCase();
    const onlyActive = activeParam === '1' || activeParam === 'true' || activeParam === 'yes';
    const rows = await svc.getAll({ active: onlyActive });
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/products', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// Alias "menu"
router.get('/menu', async (req, res) => {
  try {
    const rows = await svc.getAll({ active: true });
    res.json(rows);
  } catch (err) {
    logger.error('❌ [GET] /api/products/menu', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/products/:id
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await svc.getById(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (err) {
    logger.error('❌ [GET] /api/products/:id', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/products
router.post('/', async (req, res) => {
  try {
    const created = await svc.create(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    logger.error('❌ [POST] /api/products', { error: String(err) });
    res.status(400).json({ error: err.message || 'bad_request' });
  }
});

// PUT /api/products/:id
router.put('/:id(\\d+)', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const updated = await svc.update(id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'not_found' });
    res.json(updated);
  } catch (err) {
    logger.error('❌ [PUT] /api/products/:id', { error: String(err) });
    res.status(400).json({ error: err.message || 'bad_request' });
  }
});

// DELETE /api/products/:id
router.delete('/:id(\\d+)', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await svc.remove(id);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, id });
  } catch (err) {
    logger.error('❌ [DELETE] /api/products/:id', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
