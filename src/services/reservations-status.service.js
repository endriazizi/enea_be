// === Servizio azioni stato (accept/reject/cancel) con audit + mail ===========
// Mantiene il tuo stile (commenti/emoji), ma abilita:
// - transizioni standard + override/backtrack (flag .env)
// - invio email su ogni cambio stato (se MAIL_ENABLED)
// - log dettagliati (from→to, utente, reason, config mail)

'use strict';

const db = require('../db');
const logger = require('../logger');
const env = require('../env');
const resvSvc = require('./reservations.service');

// Mailer opzionale: se manca, log warnings ma non blocco
let mailer = null;
try { mailer = require('./mailer.service'); }
catch { logger.warn('📧 mailer.service non disponibile: skip invio email'); }

/* Transazione con fallback: db.tx → pool.getConnection → db.query(callback) */
async function runTx(cb) {
  if (typeof db.tx === 'function') return db.tx(cb);

  if (db.pool && typeof db.pool.getConnection === 'function') {
    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await cb(conn);
      await conn.commit();
      return out;
    } catch (e) {
      try { await conn.rollback(); } catch {}
      throw e;
    } finally {
      conn.release();
    }
  }

  if (typeof db.query === 'function') {
    // opzionale: alcuni wrapper accettano una callback
    return db.query(cb);
  }

  throw new Error('Transazione non disponibile (servono db.tx o pool.getConnection)');
}

/* Mappa base delle transizioni consentite */
const BASE_ALLOWED = {
  pending  : new Set(['accepted', 'rejected', 'cancelled']),
  accepted : new Set(['cancelled', 'rejected']), // posso tornare indietro se abilitato
  rejected : new Set([]),
  cancelled: new Set([]),
};

function toNewStatus(action) {
  switch (action) {
    case 'accept': return 'accepted';
    case 'reject': return 'rejected';
    case 'cancel': return 'cancelled';
    default: return null;
  }
}

/* Flags runtime (env.js li espone già) */
function transitionsConfig() {
  return {
    allowBacktrack     : !!env.RESV?.allowBacktrack,
    allowAnyTransition : !!env.RESV?.allowAnyTransition,
    forceTransitions   : !!env.RESV?.forceTransitions,
    notifyAlways       : !!env.RESV?.notifyAlways,
  };
}

/**
 * Aggiorna lo stato in transazione e (se cambia davvero) invia email al cliente.
 * Input: { reservationId, action, reason?, user?, notify?, email?, replyTo? }
 */
async function updateStatus({ reservationId, action, reason, user, notify, email, replyTo }) {
  const wanted = toNewStatus(action);
  if (!wanted) {
    const e = new Error('Azione non valida. Usa: accept | reject | cancel');
    e.statusCode = 400; throw e;
  }
  const cfg = transitionsConfig();
  const trimmedReason = (typeof reason === 'string' ? reason.trim() : '') || null;

  // 1) Transazione: leggo stato attuale, valido, aggiorno, scrivo audit
  const txResult = await runTx(async (conn) => {
    // Stato attuale (FOR UPDATE)
    const [rows] = await conn.execute(
      'SELECT id, status FROM `reservations` WHERE id = ? FOR UPDATE', [reservationId]
    );
    if (!rows.length) {
      const e = new Error('not_found'); e.statusCode = 404; throw e;
    }
    const current = rows[0];
    let next = null;

    // Transizione standard
    const allowed = BASE_ALLOWED[current.status] || new Set();
    if (allowed.has(wanted)) next = wanted;

    // Override/backtrack/any
    if (!next && (cfg.allowAnyTransition || cfg.allowBacktrack || cfg.forceTransitions)) {
      next = wanted;
      logger.warn('🔁 RESV TRANSITION OVERRIDE', {
        service: 'server', id: reservationId, from: current.status, to: wanted, action
      });
    }

    if (!next) {
      const e = new Error(`Transizione non consentita: ${current.status} → ${wanted}`);
      e.statusCode = 409; throw e;
    }

    if (next === current.status) {
      // Niente da fare: no-op, non aggiorno DB né audit
      logger.info('⏸️ RESV status NO-OP', {
        service: 'server', id: reservationId, state: current.status, action
      });
      return { changed: false, snapshot: current };
    }

    // UPDATE principale
    await conn.execute(
      'UPDATE `reservations` SET status=?, status_note=?, status_changed_at=CURRENT_TIMESTAMP WHERE id=?',
      [next, trimmedReason, reservationId]
    );

    // AUDIT
    const userId = (user && user.id) || null;
    const userEmail = (user && user.email) || null;
    await conn.execute(
      'INSERT INTO `reservation_audit` (reservation_id, old_status, new_status, reason, user_id, user_email) VALUES (?,?,?,?,?,?)',
      [reservationId, current.status, next, trimmedReason, userId, userEmail]
    );

    logger.info('📝 RESV audit', {
      service: 'server',
      id: reservationId,
      from: current.status, to: next,
      by: userEmail || 'unknown',
      reason: trimmedReason || '-'
    });

    return { changed: true, from: current.status, to: next };
  });

  // 2) Snapshot aggiornato (JOIN ricca per avere email/display_name)
  const updated = await resvSvc.getById(reservationId);

  // 3) Notifica email (solo se c'è stato un cambio reale)
  if (txResult.changed && mailer && env.MAIL?.enabled) {
    const mustNotify = notify === true || cfg.notifyAlways;
    const to = (email && String(email).trim()) || (updated?.email || '').trim() || updated?.contact_email || '';
    if (mustNotify && to) {
      try {
        const info = await mailer.sendStatusChangeEmail({
          to,
          reservation: updated,
          action,
          reason: trimmedReason || undefined,
          replyTo
        });
        logger.info('📧 MAIL SENT', {
          service: 'server',
          id: reservationId,
          to,
          action,
          messageId: info?.messageId,
          env_mail: env._debugMailConfig?.()
        });
      } catch (e) {
        logger.error('📧 MAIL ERROR', {
          service: 'server',
          id: reservationId,
          error: String(e),
          env_mail: env._debugMailConfig?.()
        });
      }
    } else {
      logger.warn('📧 MAIL SKIPPED', {
        service: 'server',
        id: reservationId,
        reason: mustNotify ? 'no_recipient' : 'notify_disabled',
        env_mail: env._debugMailConfig?.()
      });
    }
  }

  return updated; // sempre lo snapshot finale
}

/** Restituisce l'audit (ultime N righe, default 50) */
async function getAudit({ reservationId, limit = 50 }) {
  const n = Number(limit) || 50;
  const [rows] = await db.query(
    'SELECT id, reservation_id, old_status, new_status, reason, user_email, created_at ' +
    'FROM `reservation_audit` WHERE reservation_id = ? ORDER BY created_at DESC LIMIT ?',
    [reservationId, n]
  );
  return rows;
}

module.exports = { updateStatus, getAudit };
