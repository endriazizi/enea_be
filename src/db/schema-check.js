// src/db/schema-check.js
// 🔎 Verifica schema DB all'avvio: stampa colonne reali e confronta con "atteso".
// Utile per beccare subito mismatch (es. colonne mancanti o tipi diversi) prima che esplodano le query.
//
// NOTE:
// - L'oggetto EXPECTED qui sotto è già allineato a quanto hai nel DB reale (dai log che hai condiviso).
// - Se in futuro cambi lo schema (tipi, nullabilità, enum, nuove colonne), aggiorna SOLO EXPECTED.
// - I log mostreranno:
//     🧩 SCHEMA ▶️ <tabella> (elenco colonne reali)
//     ⚠️ SCHEMA <tabella>: difformità rilevate  → se c'è mismatch
//     ✅ SCHEMA <tabella>: OK (match atteso)     → se è tutto in regola

const { query } = require('./index');
const logger = require('../logger');

// 🔁 Schema atteso (allineato al tuo DB reale dai log dell'ultimo avvio)
const EXPECTED = {
  rooms: {
    // DB reale: id = BIGINT NOT NULL
    id: { data_type: 'bigint', nullable: 'NO' },
    name: { data_type: 'varchar', nullable: 'NO' },
    is_active: { data_type: 'tinyint', nullable: 'YES' },
    // DB reale: sort_order = int NOT NULL
    sort_order: { data_type: 'int', nullable: 'NO' },
    // DB reale: created_at = timestamp NOT NULL
    created_at: { data_type: 'timestamp', nullable: 'NO' },
  },

  tables: {
    id: { data_type: 'int', nullable: 'NO' },
    // Abbiamo normalizzato: room_id = BIGINT per matchare rooms.id, NULLABLE
    room_id: { data_type: 'bigint', nullable: 'YES' },
    // DB reale: table_number = int NOT NULL
    table_number: { data_type: 'int', nullable: 'NO' },
    seats: { data_type: 'int', nullable: 'YES' },
    status: {
      data_type: 'enum', nullable: 'YES',
      column_type: "enum('free','reserved','occupied')"
    },
    // DB reale: updated_at = timestamp NOT NULL
    updated_at: { data_type: 'timestamp', nullable: 'NO' },
  },

  users: {
  id:         { data_type: 'bigint',   nullable: 'NO'  },
  first_name: { data_type: 'varchar',  nullable: 'YES' },
  last_name:  { data_type: 'varchar',  nullable: 'YES' },
  email:      { data_type: 'varchar',  nullable: 'YES' },
  phone:      { data_type: 'varchar',  nullable: 'YES' },
  created_at: { data_type: 'timestamp',nullable: 'NO'  },
  updated_at: { data_type: 'timestamp',nullable: 'YES' },
},

  reservations: {
    id: { data_type: 'bigint', nullable: 'NO' },
    customer_first: { data_type: 'varchar', nullable: 'YES' },
    customer_last: { data_type: 'varchar', nullable: 'YES' },
    phone: { data_type: 'varchar', nullable: 'YES' },
    email: { data_type: 'varchar', nullable: 'YES' },
    user_id: { data_type: 'bigint', nullable: 'YES' }, // 👈 aggiungi
    party_size: { data_type: 'int', nullable: 'NO' },
    start_at: { data_type: 'datetime', nullable: 'NO' },
    end_at: { data_type: 'datetime', nullable: 'NO' },
    notes: { data_type: 'varchar', nullable: 'YES' },
    status: {
      data_type: 'enum', nullable: 'YES',
      column_type: "enum('pending','accepted','rejected','cancelled')"
    },
    status_note: { data_type: 'text', nullable: 'YES' }, // 👈 aggiungi
    status_changed_at: { data_type: 'timestamp', nullable: 'YES' }, // 👈 aggiungi
    client_token: { data_type: 'varchar', nullable: 'YES' },
    table_id: { data_type: 'int', nullable: 'YES' },
    created_at: { data_type: 'timestamp', nullable: 'NO' },
  }

};

async function fetchColumns(table) {
  const rows = await query(`
    SELECT
      COLUMN_NAME        AS name,
      DATA_TYPE          AS data_type,
      IS_NULLABLE        AS nullable,
      COLUMN_TYPE        AS column_type,
      COLUMN_KEY         AS column_key,
      ORDINAL_POSITION   AS pos
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = ?
    ORDER BY ORDINAL_POSITION
  `, [table]);

  // Map normalizzato (chiavi lowercase) per robustezza
  const map = {};
  for (const r of rows) {
    map[String(r.name).toLowerCase()] = {
      data_type: String(r.data_type).toLowerCase(),
      nullable: String(r.nullable).toUpperCase(),
      column_type: r.column_type ? String(r.column_type).toLowerCase() : null,
      column_key: r.column_key || '',
      pos: r.pos
    };
  }
  return { list: rows, map };
}

function diffTable(_table, got, exp) {
  const diffs = { missing: [], extra: [], typeMismatch: [] };

  // Colonne attese ma mancanti
  Object.keys(exp).forEach(k => {
    if (!got.map[k]) diffs.missing.push(k);
  });

  // Colonne “extra” nel DB reale (non previste)
  Object.keys(got.map).forEach(k => {
    if (!exp[k]) diffs.extra.push(k);
  });

  // Differenze su tipo / nullabilità / enum
  Object.keys(exp).forEach(k => {
    const g = got.map[k];
    if (!g) return;
    const e = exp[k];
    const mismatch = [];
    if (e.data_type && g.data_type !== e.data_type) mismatch.push(`type: ${g.data_type} ≠ ${e.data_type}`);
    if (e.nullable && g.nullable !== e.nullable) mismatch.push(`null: ${g.nullable} ≠ ${e.nullable}`);
    if (e.column_type && g.column_type !== e.column_type) mismatch.push(`column_type: ${g.column_type} ≠ ${e.column_type}`);
    if (mismatch.length) diffs.typeMismatch.push({ column: k, details: mismatch.join(', ') });
  });

  return diffs;
}

async function checkOne(table) {
  try {
    const got = await fetchColumns(table);
    const exp = EXPECTED[table] || {};
    const diffs = diffTable(table, got, exp);

    // 📋 Dump “reale” leggibile (ordine naturale)
    logger.info(`🧩 SCHEMA ▶️ ${table} (reale)`, {
      columns: got.list.map(c => ({
        pos: c.pos,
        name: c.name,
        data_type: c.data_type,
        nullable: c.nullable,
        column_type: c.column_type,
        key: c.column_key
      }))
    });

    if (!Object.keys(exp).length) {
      logger.warn(`⚠️ SCHEMA ${table}: non ho un "atteso" definito, mi limito a stampare le colonne reali.`);
      return;
    }

    // Diff sintetico
    if (diffs.missing.length || diffs.extra.length || diffs.typeMismatch.length) {
      logger.warn(`⚠️ SCHEMA ${table}: difformità rilevate`, diffs);
    } else {
      logger.info(`✅ SCHEMA ${table}: OK (match atteso)`);
    }
  } catch (err) {
    logger.error(`❌ SCHEMA ${table}: errore durante il check`, { error: String(err) });
  }
}

async function runSchemaCheck() {
  logger.info('🔎 SCHEMA CHECK ▶️ start');
  const tables = Object.keys(EXPECTED);
  for (const t of tables) {
    // sequenziale per log ordinati
    // eslint-disable-next-line no-await-in-loop
    await checkOne(t);
  }
  logger.info('🔎 SCHEMA CHECK ✅ done');
}

module.exports = { runSchemaCheck };
