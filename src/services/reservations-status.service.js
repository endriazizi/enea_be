// src/services/reservations-status.service.js
// === Servizio azioni stato (accept/reject/cancel) con audit ==================
// Patch NON distruttiva: file completo pronto da incollare.
// - Usa transazione DB (db.tx) con fallback auto a pool.getConnection()
// - Valida transizioni consentite
// - Aggiorna reservations (status, status_note, status_changed_at)
// - Inserisce riga in reservation_audit (storico)
// - Ritorna lo snapshot aggiornato della prenotazione

'use strict';

const db = require('../db');
const logger = require('../logger');

/**
 * Esegue una callback in transazione.
 * Priorità: db.tx → pool.getConnection() → (fallback estremo) db.query(callback)
 */
async function runTx(callback) {
    if (typeof db.tx === 'function') {
        return db.tx(callback);
    }
    if (db.pool && typeof db.pool.getConnection === 'function') {
        const conn = await db.pool.getConnection();
        try {
            await conn.beginTransaction();
            const result = await callback(conn);
            await conn.commit();
            return result;
        } catch (err) {
            try { await conn.rollback(); } catch { /* ignore */ }
            throw err;
        } finally {
            conn.release();
        }
    }
    if (typeof db.query === 'function') {
        // Se hai implementato l’overload db.query(callback), funziona anche così.
        return db.query(callback);
    }
    throw new Error('Transazione non disponibile: aggiungi db.tx o esporta pool.getConnection()');
}

// Mappa transizioni consentite.
const ALLOWED_TRANSITIONS = {
    pending: new Set(['accepted', 'rejected', 'cancelled']),
    accepted: new Set(['cancelled']),
    rejected: new Set([]),
    cancelled: new Set([]),
};

function resolveNewStatus(action) {
    switch (action) {
        case 'accept': return 'accepted';
        case 'reject': return 'rejected';
        case 'cancel': return 'cancelled';
        default: return null;
    }
}

/**
 * Esegue la transizione di stato in transazione:
 * - Legge stato attuale (FOR UPDATE)
 * - Valida transizione
 * - Aggiorna reservations (status, status_note, status_changed_at)
 * - Inserisce riga in reservation_audit
 * - Ritorna lo snapshot aggiornato della prenotazione
 */
async function updateStatus({ reservationId, action, reason, user }) {
    const newStatus = resolveNewStatus(action);
    if (!newStatus) {
        const err = new Error('Azione non valida. Usa: accept | reject | cancel');
        err.statusCode = 400; throw err;
    }

    const trimmedReason = (typeof reason === 'string' ? reason.trim() : '') || null;

    return runTx(async (conn) => {
        // 1) Stato attuale
        const [rows] = await conn.execute(
            'SELECT id, status FROM `reservations` WHERE id = ? FOR UPDATE',
            [reservationId]
        );
        if (!rows.length) {
            const err = new Error('Prenotazione non trovata');
            err.statusCode = 404; throw err;
        }
        const current = rows[0];

        // 2) Validazione transizione
        const allowed = ALLOWED_TRANSITIONS[current.status] || new Set();
        if (!allowed.has(newStatus)) {
            const err = new Error(`Transizione non consentita: ${current.status} → ${newStatus}`);
            err.statusCode = 409; throw err; // 409 Conflict
        }

        // 3) Aggiorna record principale
        const nowSql = { toSqlString: () => 'CURRENT_TIMESTAMP' };


        await conn.execute(
            'UPDATE `reservations` SET status = ?, status_note = ?, status_changed_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newStatus, trimmedReason, reservationId]
        );

        // 4) Audit
        const userId = (user && user.id) ? user.id : null;
        const userEmail = (user && user.email) ? user.email : null;
        await conn.execute(
            'INSERT INTO `reservation_audit`\n' +
            ' (reservation_id, old_status, new_status, reason, user_id, user_email)\n' +
            ' VALUES (?,?,?,?,?,?)',
            [reservationId, current.status, newStatus, trimmedReason, userId, userEmail]
        );

        logger.info(`📝 [RESV] audit  #${reservationId}: ${current.status} → ${newStatus}  👤 ${userEmail || 'unknown'}  🗒️ ${trimmedReason || '-'}`);

        // 5) Ritorna lo snapshot aggiornato
        const [out] = await conn.execute(
            'SELECT * FROM `reservations` WHERE id = ?',
            [reservationId]
        );
        return out[0];
    });
}

/** Restituisce l'audit (ultime N righe, default 50) */
async function getAudit({ reservationId, limit = 50 }) {
    const n = Number(limit) || 50;
    const [rows] = await db.query(
        'SELECT id, reservation_id, old_status, new_status, reason, user_email, created_at\n' +
        '  FROM `reservation_audit` WHERE reservation_id = ?\n' +
        '  ORDER BY created_at DESC LIMIT ?',
        [reservationId, n]
    );
    return rows;
}

module.exports = {
    updateStatus,
    getAudit,
};