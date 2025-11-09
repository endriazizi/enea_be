// src/services/reservations-status.service.js
// ----------------------------------------------------------------------------
// State machine per le prenotazioni + persistenza su DB.
// - Interfaccia: updateStatus({ id, action, reason?, user_email? })
// - Compat FE: confirm/confirmed → accepted (badge verde); cancel/* → cancelled (badge visibile)
// - UPDATE dinamica solo su colonne realmente presenti (status_note / reason, status_changed_at, updated_*)
// - Alias compat: updateReservationStatus(...) → updateStatus(...)
// ----------------------------------------------------------------------------

'use strict';

const { query } = require('../db');
const logger    = require('../logger');

// Azioni consentite (accettiamo sia verbi sia stati finali)
const ALLOWED = new Set([
  'accept','accepted',
  'confirm','confirmed',       // → accepted
  'arrive','arrived',
  'reject','rejected',
  'cancel','canceled','cancelled', // → cancelled (UK) per compat FE badge
  'prepare','preparing',
  'ready',
  'complete','completed',
  'no_show','noshow'
]);

// Normalizzazione: azione → stato DB
const MAP = {
  accept     : 'accepted',
  confirm    : 'accepted',
  confirmed  : 'accepted',
  arrive     : 'arrived',
  reject     : 'rejected',
  cancel     : 'cancelled',
  cancelled  : 'cancelled',
  canceled   : 'cancelled',
  prepare    : 'preparing',
  complete   : 'completed',
  no_show    : 'no_show',
  noshow     : 'no_show'
};

function toStatus(action) {
  const a = String(action || '').trim().toLowerCase();
  if (!ALLOWED.has(a)) throw new Error('invalid_action');
  return MAP[a] || a;
}

// Cache colonne
const _colsCache = new Map();
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
 * Aggiorna lo stato e ritorna la riga aggiornata.
 * - Scrive status_note (se esiste) o reason (fallback) solo se reason è valorizzato.
 * - Aggiorna status_changed_at/updated_* solo se esistono.
 */
async function updateStatus({ id, action, reason = null, user_email = 'system' }) {
  const rid = Number(id);
  if (!rid || !action) throw new Error('missing_id_or_action');

  const newStatus = toStatus(action);
  const cols = await columnsOf('reservations');

  const set = [];
  const pr  = [];

  set.push('status = ?'); pr.push(newStatus);

  const hasReason = reason !== null && reason !== undefined && String(reason).trim() !== '';
  if (hasReason) {
    if (cols.has('status_note')) {
      set.push('status_note = COALESCE(?, status_note)'); pr.push(reason);
    } else if (cols.has('reason')) {
      set.push('reason = COALESCE(?, reason)');           pr.push(reason);
    }
  }

  if (cols.has('status_changed_at')) set.push('status_changed_at = CURRENT_TIMESTAMP');
  if (cols.has('updated_at'))        set.push('updated_at = CURRENT_TIMESTAMP');
  if (cols.has('updated_by'))       { set.push('updated_by = ?'); pr.push(user_email); }

  if (!set.length) throw new Error('no_fields_to_update');

  pr.push(rid);
  const sql = `UPDATE reservations SET ${set.join(', ')} WHERE id = ? LIMIT 1`;
  const res = await query(sql, pr);
  if (!res?.affectedRows) throw new Error('reservation_not_found');

  logger.info('🧾 RESV.status ✅ updated', { id: rid, newStatus, usedCols: set.map(s => s.split('=')[0].trim()) });

  const rows = await query('SELECT * FROM reservations WHERE id = ?', [rid]);
  return rows[0] || null;
}

// Alias compat per vecchi import
const updateReservationStatus = (args) => updateStatus(args);

module.exports = { updateStatus, updateReservationStatus };
