const productService = require('../services/product.service');

module.exports = {
  getAll: async (req, res) => {
    try {
      const products = await productService.getAll();
      res.json(products);
    } catch (err) {
      res.status(500).json({ message: "Errore recupero prodotti" });
    }
  },

  getById: async (req, res) => {
    try {
      const product = await productService.getById(Number(req.params.id));
      if (!product) return res.status(404).json({ message: "Prodotto non trovato" });
      res.json(product);
    } catch (err) {
      res.status(500).json({ message: "Errore recupero prodotto" });
    }
  },

  create: async (req, res) => {
    try {
      const newProduct = await productService.create(req.body);
      res.status(201).json(newProduct);
    } catch (err) {
      res.status(500).json({ message: "Errore creazione prodotto" });
    }
  },

  update: async (req, res) => {
    try {
      const updatedProduct = await productService.update(Number(req.params.id), req.body);
      if (!updatedProduct) return res.status(404).json({ message: "Prodotto non trovato" });
      res.json(updatedProduct);
    } catch (err) {
      res.status(500).json({ message: "Errore aggiornamento prodotto" });
    }
  },

  remove: async (req, res) => {
    try {
      const deleted = await productService.remove(Number(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Prodotto non trovato" });
      res.json({ message: "Prodotto eliminato" });
    } catch (err) {
      res.status(500).json({ message: "Errore eliminazione prodotto" });
    }
  }
};
