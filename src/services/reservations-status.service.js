// src/services/reservations-status.service.js
// ----------------------------------------------------------------------------
// State machine per le prenotazioni + persistenza su DB.
// Fix robusta: rileva le colonne realmente presenti in `reservations` e
// costruisce la UPDATE senza toccare campi mancanti (es. updated_at).
// - Interfaccia: updateStatus({ id, action, reason?, user_email? })
// - Mappa azioni "umane" → stato DB (accept → accepted, ecc.)
// ----------------------------------------------------------------------------

'use strict';

const { query } = require('../db');      // ✅ path corretto
const logger    = require('../logger');  // ✅ path corretto

// Azioni consentite (accettiamo sia verbi sia stati finali)
const ALLOWED = new Set([
  'accept','accepted',
  'confirm','confirmed',
  'arrive','arrived',
  'reject','rejected',
  'cancel','canceled','cancelled',
  'prepare','preparing',
  'ready',
  'complete','completed',
  'no_show','noshow'
]);

// Normalizzazione: azione → stato DB
const MAP = {
  accept     : 'accepted',
  confirm    : 'confirmed',
  arrive     : 'arrived',
  reject     : 'rejected',
  cancel     : 'canceled',
  cancelled  : 'canceled',
  prepare    : 'preparing',
  complete   : 'completed',
  no_show    : 'no_show',
  noshow     : 'no_show'
};

function toStatus(action) {
  const a = String(action || '').trim().toLowerCase();
  if (!ALLOWED.has(a)) throw new Error('invalid_action');
  return MAP[a] || a; // se è già "accepted/confirmed/..." lo lasciamo così
}

// Cache delle colonne per evitare query ripetute su information_schema
const _colsCache = new Map();
/** Ritorna Set di colonne presenti per la tabella richiesta */
async function columnsOf(table = 'reservations') {
  if (_colsCache.has(table)) return _colsCache.get(table);
  const rows = await query(
    `SELECT COLUMN_NAME AS name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [table]
  );
  const set = new Set(rows.map(r => r.name));
  _colsCache.set(table, set);
  return set;
}

/**
 * Aggiorna lo stato in modo atomico e ritorna la prenotazione aggiornata.
 * - Scrive la nota in "status_note" se esiste (fallback su "reason" se presente).
 * - Aggiorna "status_changed_at" solo se la colonna esiste.
 * - Aggiorna "updated_at"/"updated_by" solo se esistono.
 */
async function updateStatus({ id, action, reason = null, user_email = 'system' }) {
  const rid = Number(id);
  if (!rid || !action) throw new Error('missing_id_or_action');

  const newStatus = toStatus(action);
  const cols = await columnsOf('reservations');

  // Costruzione dinamica della UPDATE sicura rispetto allo schema reale
  const set = [];
  const params = [];

  // stato (sempre esiste)
  set.push('status = ?'); params.push(newStatus);

  // nota stato: preferisci status_note, fallback su reason (se presente)
  if (reason !== null && reason !== undefined && reason !== '') {
    if (cols.has('status_note')) {
      set.push('status_note = COALESCE(?, status_note)'); params.push(reason);
    } else if (cols.has('reason')) {
      set.push('reason = COALESCE(?, reason)'); params.push(reason);
    }
  }

  // timestamp cambio-stato (se esiste)
  if (cols.has('status_changed_at')) {
    set.push('status_changed_at = CURRENT_TIMESTAMP');
  }

  // audit "updated_*" solo se le colonne esistono
  if (cols.has('updated_at')) {
    set.push('updated_at = CURRENT_TIMESTAMP');
  }
  if (cols.has('updated_by')) {
    set.push('updated_by = ?'); params.push(user_email);
  }

  // Safety: almeno lo status deve essere aggiornato
  if (!set.length) throw new Error('no_fields_to_update');

  params.push(rid);
  const sql = `UPDATE reservations SET ${set.join(', ')} WHERE id = ? LIMIT 1`;
  const res = await query(sql, params);

  if (!res?.affectedRows) throw new Error('reservation_not_found');

  logger.info('🧾 RESV.status ✅ updated', {
    id: rid,
    newStatus,
    usedCols: set.map(s => s.split('=')[0].trim())
  });

  const rows = await query('SELECT * FROM reservations WHERE id = ?', [rid]);
  return rows[0] || null;
}

module.exports = { updateStatus };
