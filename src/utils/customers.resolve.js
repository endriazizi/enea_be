// server/src/utils/customers.resolve.js
// ============================================================================
// Risoluzione "customer_user_id" partendo da email/phone.
// - Normalizza il telefono rimuovendo TUTTO tranne le cifre (0-9)
// - Confronta l'email in maniera case-insensitive (LOWER(email))
// - Cerca il cliente nella tabella `users` (quella che usi per i "customers")
// - Ritorna l'id se trovato, altrimenti null
// ============================================================================

'use strict';

const log = require('../logger') || console;

// normalizza un telefono in modo conservativo → tengo solo le cifre
function normalizePhone(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, ''); // rimuove spazi, +, -, punti, ecc.
  return digits || null;
}

module.exports = async function resolveCustomerUserId(db, { email, phone }) {
  // email normalizzata a minuscole
  const emailNorm = (email || '').trim().toLowerCase() || null;
  const phoneNorm = normalizePhone(phone);

  // nessun dato utile → non cerco
  if (!emailNorm && !phoneNorm) {
    log.info('👥 resolveCustomerUserId: nessuna email/phone, skip');
    return null;
  }

  // --------------------------------------------------------------------------
  // Costruisco WHERE dinamico in base a cosa ho (email, phone o entrambi)
  // --------------------------------------------------------------------------
  const where = [];
  const params = [];

  if (emailNorm) {
    where.push('LOWER(email) = ?');
    params.push(emailNorm);
  }

  if (phoneNorm) {
    // lato DB tolgo gli stessi caratteri "rumorosi" dal telefono salvato
    where.push(`
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(phone, ' ', ''),
            '+', ''
          ),
          '-', ''
        ),
        '.', ''
      ) = ?
    `);
    params.push(phoneNorm);
  }

  const sql = `
    SELECT id
    FROM users
    WHERE ${where.join(' OR ')}
    ORDER BY id DESC
    LIMIT 1
  `;

  // Nota: mysql2/promise ritorna [rows, fields]; in alcuni punti puoi avere
  // direttamente rows. La normalizzazione sotto copre entrambi i casi.
  const rows = await db.query(sql, params);
  const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;

  const foundId = list?.[0]?.id || null;

  if (foundId) {
    log.info('👥 resolveCustomerUserId HIT', {
      id: foundId,
      email: emailNorm,
      phoneNorm,
    });
  } else {
    log.info('👥 resolveCustomerUserId MISS', {
      email: emailNorm,
      phoneNorm,
    });
  }

  return foundId;
};
