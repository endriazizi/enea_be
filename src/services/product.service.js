const { query } = require('../db'); // ✅ usa wrapper unico

module.exports = {
  getAll: async () => {
    const rows = await query("SELECT * FROM products ORDER BY created_at DESC");
    return rows;
  },

  getById: async (id) => {
    const rows = await query("SELECT * FROM products WHERE id = ?", [id]);
    return rows[0];
  },

  create: async (data) => {
    const { name, description, price, category } = data;
    const res = await query(
      "INSERT INTO products (name, description, price, category) VALUES (?, ?, ?, ?)",
      [name, description, price, category]
    );
    return { id: res.insertId, ...data };
  },

  update: async (id, data) => {
    const { name, description, price, category } = data;
    const res = await query(
      "UPDATE products SET name=?, description=?, price=?, category=? WHERE id=?",
      [name, description, price, category, id]
    );
    return res.affectedRows > 0 ? { id, ...data } : null;
  },

  remove: async (id) => {
    const res = await query("DELETE FROM products WHERE id=?", [id]);
    return res.affectedRows > 0;
  }
};
