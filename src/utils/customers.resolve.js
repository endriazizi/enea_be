// server/src/utils/customers.resolve.js
// ============================================================================
// Risoluzione "customer_user_id" partendo da email/phone.
// - Normalizza il telefono rimuovendo spazi, + e -
// - Cerca l'utente per email OR telefono
// - Ritorna l'id se trovato, altrimenti null
// ============================================================================

'use strict';

module.exports = async function resolveCustomerUserId(db, { email, phone }) {
  // normalizza un telefono in modo conservativo
  const norm = (v) => String(v || '').replace(/\s+/g, '').replace(/^\+|-/g, '');
  const p = norm(phone);

  // Nota: mysql2/promise ritorna [rows, fields]; in alcuni punti puoi avere
  // direttamente rows. La normalizzazione sotto copre entrambi i casi.
  const rows = await db.query(`
    SELECT id
    FROM users
    WHERE (email IS NOT NULL AND email = ?)
       OR (phone IS NOT NULL AND REPLACE(REPLACE(REPLACE(phone,' ',''), '+',''), '-','') = ?)
    ORDER BY id DESC
    LIMIT 1
  `, [email || null, p || null]);

  const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
  return list?.[0]?.id || null;
};
