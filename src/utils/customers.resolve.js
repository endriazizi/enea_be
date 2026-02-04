// src/utils/customers.resolve.js
// -----------------------------------------------------------------------------
// resolveCustomerUserId(db, { email, phone, displayName? })
//
// - db: oggetto con .query (pool mysql2, conn mysql2 o wrapper { query }).
// - Se trova un utente per email/telefono → restituisce id.
// - Se non trova ma abbiamo almeno email/phone → crea un utente "cliente".
// - Non gestisce ancora OTP: phone_verified_at e verification_channel li useremo
//   nello STEP 2 (quando introdurremo la verifica).
// -----------------------------------------------------------------------------

'use strict';

const logger = require('../logger');

function trimOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

// Normalizzazione molto conservativa: togli spazi, trattini, punti
function normalizePhone(v) {
  const s = trimOrNull(v);
  if (!s) return null;
  return s.replace(/[\s\-\.]/g, '');
}

// Normalizza risultato di db.query():
// - mysql2/promise conn/pool → [rows, fields] → ritorniamo rows
// - wrapper { query }        → ritorna già rows
async function runQuery(db, sql, params = []) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('resolveCustomerUserId: db.query mancante');
  }
  const res = await db.query(sql, params);
  if (Array.isArray(res) && Array.isArray(res[0])) return res[0];
  return res;
}

async function resolveCustomerUserId(db, payload = {}) {
  const email       = trimOrNull(payload.email);
  const phone       = trimOrNull(payload.phone);
  const displayName = trimOrNull(payload.displayName);
  const phoneNorm   = normalizePhone(phone);

  if (!email && !phone) {
    logger.info('👥 resolveCustomerUserId: skip (no email/phone)');
    return null;
  }

  // 1) Tenta di trovare un utente esistente
  try {
    let row = null;

    if (email) {
      const rows = await runQuery(
        db,
        'SELECT id, email, phone FROM users WHERE email = ? LIMIT 1',
        [email],
      );
      row = rows?.[0] || null;
    }

    if (!row && phone) {
      const rows = await runQuery(
        db,
        `
          SELECT id, email, phone
          FROM users
          WHERE REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '.', '')
                = REPLACE(REPLACE(REPLACE(?, ' ', ''), '-', ''), '.', '')
          LIMIT 1
        `,
        [phone],
      );
      row = rows?.[0] || null;
    }

    if (row) {
      // Best-effort: aggiorna phone_normalized (se la colonna c'è, dopo migrazione 007)
      if (phoneNorm) {
        try {
          await runQuery(
            db,
            'UPDATE users SET phone = COALESCE(phone, ?), phone_normalized = ? WHERE id = ?',
            [phone, phoneNorm, row.id],
          );
        } catch (e) {
          logger.warn('👥 resolveCustomerUserId: update phone_normalized KO (continuo)', {
            id: row.id,
            error: String(e),
          });
        }
      }

      logger.info('👥 resolveCustomerUserId: hit existing user', {
        id   : row.id,
        email: row.email,
        phone: row.phone,
      });
      return row.id;
    }
  } catch (e) {
    logger.warn('👥 resolveCustomerUserId: lookup KO (continuo senza customer_user_id)', {
      error: String(e),
      email,
      phone,
    });
    return null;
  }

  // 2) Nessun utente trovato → creiamo un nuovo "cliente"
  try {
    let first = null;
    let last  = null;
    let full  = null;

    if (displayName) {
      const parts = displayName.split(/\s+/);
      first = parts[0] || null;
      if (parts.length > 1) {
        last = parts.slice(1).join(' ') || null;
      }
      full = displayName;
    }

    const now = new Date();

    const result = await runQuery(
      db,
      `
        INSERT INTO users
          (first_name, last_name, email, phone, phone_normalized, trust_score, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        first,
        last,
        email,
        phone,
        phoneNorm,
        50,    // trust_score di default (cliente "neutro")
        now,
        now,
      ],
    );

    const id = result && result.insertId ? result.insertId : null;

    // Best-effort: set full_name + name se disponibili (compat)
    if (id && full) {
      try {
        await runQuery(
          db,
          'UPDATE users SET full_name = COALESCE(full_name, ?), name = COALESCE(name, ?) WHERE id = ?',
          [full, full, id],
        );
      } catch (e) {
        logger.warn('👥 resolveCustomerUserId: update full_name/name KO (continuo)', {
          id,
          error: String(e),
        });
      }
    }

    logger.info('👥 resolveCustomerUserId: created new customer user', {
      id,
      email,
      phone,
      displayName,
    });

    return id;
  } catch (e) {
    logger.error('👥 resolveCustomerUserId: INSERT user KO, continuo senza customer_user_id', {
      error: String(e),
      email,
      phone,
      displayName,
    });
    return null;
  }
}

module.exports = resolveCustomerUserId;
