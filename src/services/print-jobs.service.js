// src/services/print-jobs.service.js
// ============================================================================
// Print Jobs — coda best-effort per stampe (log emoji + commenti lunghi)
// ============================================================================

'use strict';

const logger = require('../logger');
const { query } = require('../db');
const { getPrintSettings } = require('./print-settings.service');
const { printOrderForCenter } = require('../utils/print-order');

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_LIMIT = 5;

// =============================================================================
// Helper: normalizza payload + status
// =============================================================================

function normalizeStatus(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'queued' || v === 'printing' || v === 'done' || v === 'failed' || v === 'cancelled') {
    return v;
  }
  return null;
}

function computeBackoffSeconds(attempts) {
  const n = Math.max(1, Number(attempts || 1));
  const sec = 30 * Math.pow(2, n - 1);
  return Math.min(sec, 1800); // cap 30 minuti
}

// =============================================================================
// Caricamento ordine "minimo" per stampa comanda
// =============================================================================

async function loadOrderForPrint(orderId) {
  const rows = await query(
    `SELECT
       o.id,
       o.customer_name,
       o.phone,
       o.people,
       o.scheduled_at,
       o.created_at,
       o.total,
       o.note,
       o.fulfillment,
       o.table_id,
       o.delivery_name,
       o.delivery_phone,
       o.delivery_address,
       o.delivery_note,
       t.table_number,
       COALESCE(NULLIF(t.table_number, ''), CONCAT('T', t.id)) AS table_name,
       rm.id   AS room_id,
       rm.name AS room_name
     FROM orders o
     LEFT JOIN tables t ON t.id = o.table_id
     LEFT JOIN rooms  rm ON rm.id = t.room_id
     WHERE o.id = ?
     LIMIT 1`,
    [orderId],
  );
  const h = rows && rows[0];
  if (!h) return null;

  const items = await query(
    `SELECT i.id,
            i.order_id,
            i.product_id,
            i.name,
            i.qty,
            i.price,
            i.notes,
            COALESCE(c.name, 'Altro') AS category
     FROM order_items i
     LEFT JOIN products   p ON p.id = i.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE i.order_id = ?
     ORDER BY i.id ASC`,
    [orderId],
  );

  const opts = await query(
    `SELECT order_item_id, type, name
     FROM order_item_options
     WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)
     ORDER BY order_item_id, id ASC`,
    [orderId],
  );
  const optsByItem = new Map();
  for (const o of opts || []) {
    const id = Number(o.order_item_id);
    if (!optsByItem.has(id)) optsByItem.set(id, []);
    optsByItem.get(id).push({ type: o.type, name: o.name });
  }

  return {
    ...h,
    items: (items || []).map((r) => ({
      ...r,
      qty: Number(r.qty || 0),
      price: Number(r.price || 0),
      options: optsByItem.get(Number(r.id)) || [],
    })),
  };
}

// =============================================================================
// API principale
// =============================================================================

async function enqueuePrintJob({ kind, orderId, payload, reason } = {}) {
  const payloadJson = JSON.stringify(payload || {});
  const maxAttempts = DEFAULT_MAX_ATTEMPTS;
  const result = await query(
    `INSERT INTO print_jobs (
       kind,
       order_id,
       payload_json,
       status,
       attempts,
       max_attempts,
       next_run_at,
       last_error,
       created_at,
       updated_at
     )
     VALUES (?, ?, ?, 'queued', 0, ?, UTC_TIMESTAMP(), ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [
      String(kind || ''),
      orderId != null ? Number(orderId) : null,
      payloadJson,
      maxAttempts,
      reason ? String(reason) : null,
    ],
  );
  const jobId = result?.insertId || null;
  logger.info('🧾🧵 [print_jobs] enqueue', {
    id: jobId,
    kind,
    order_id: orderId || null,
  });
  return { id: jobId };
}

async function listPrintJobs({ status, limit } = {}) {
  const st = normalizeStatus(status);
  const lim = Math.min(Math.max(Number(limit || 50), 1), 200);
  const cond = st ? 'WHERE status = ?' : '';
  const params = st ? [st, lim] : [lim];
  const rows = await query(
    `SELECT
       id,
       kind,
       order_id,
       status,
       attempts,
       max_attempts,
       next_run_at,
       last_error,
       created_at,
       updated_at,
       printed_at
     FROM print_jobs
     ${cond}
     ORDER BY id DESC
     LIMIT ?`,
    params,
  );
  return rows || [];
}

async function retryPrintJob(id) {
  const jobId = Number(id || 0);
  if (!jobId) throw new Error('invalid_id');
  await query(
    `UPDATE print_jobs
       SET status = 'queued',
           next_run_at = UTC_TIMESTAMP(),
           last_error = NULL,
           updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [jobId],
  );
  logger.info('🔁🧾 [print_jobs] retry', { id: jobId });
  return { ok: true };
}

async function cancelPrintJob(id) {
  const jobId = Number(id || 0);
  if (!jobId) throw new Error('invalid_id');
  await query(
    `UPDATE print_jobs
       SET status = 'cancelled',
           updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [jobId],
  );
  logger.info('⛔🧾 [print_jobs] cancel', { id: jobId });
  return { ok: true };
}

async function markDone(id) {
  await query(
    `UPDATE print_jobs
       SET status = 'done',
           printed_at = UTC_TIMESTAMP(),
           updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [id],
  );
}

async function markFailed(id, err, nextRunAt, attempts, maxAttempts) {
  const errMsg = err ? String(err) : 'print_error';
  if (attempts >= maxAttempts) {
    await query(
      `UPDATE print_jobs
         SET status = 'failed',
             last_error = ?,
             updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [errMsg, id],
    );
    return;
  }
  await query(
    `UPDATE print_jobs
       SET status = 'queued',
           last_error = ?,
           next_run_at = ?,
           updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [errMsg, nextRunAt, id],
  );
}

async function processPrintQueueOnce({ limit } = {}) {
  const lim = Math.min(Math.max(Number(limit || DEFAULT_LIMIT), 1), 20);
  const jobs = await query(
    `SELECT
       id,
       kind,
       order_id,
       payload_json,
       attempts,
       max_attempts
     FROM print_jobs
     WHERE status = 'queued'
       AND next_run_at <= UTC_TIMESTAMP()
     ORDER BY next_run_at ASC, id ASC
     LIMIT ?`,
    [lim],
  );
  if (!jobs || !jobs.length) return { ok: true, processed: 0 };

  const settings = await getPrintSettings();
  const printerSettings = {
    PRINTER_ENABLED: settings.printer_enabled ? 'true' : 'false',
    PRINTER_IP: settings.printer_ip || undefined,
    PRINTER_PORT: settings.printer_port || undefined,
  };

  let processed = 0;

  for (const job of jobs) {
    const claim = await query(
      `UPDATE print_jobs
         SET status = 'printing',
             attempts = attempts + 1,
             updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND status = 'queued'`,
      [job.id],
    );
    if (!claim || claim.affectedRows === 0) continue;

    const attempts = Number(job.attempts || 0) + 1;
    const maxAttempts = Number(job.max_attempts || DEFAULT_MAX_ATTEMPTS);

    try {
      if (!settings.printer_enabled) {
        throw new Error('printer_disabled');
      }
      if (String(job.kind) === 'order_comanda') {
        const orderId = Number(job.order_id || 0);
        const full = await loadOrderForPrint(orderId);
        if (!full) {
          throw new Error('order_not_found');
        }

        const payload = job.payload_json
          ? JSON.parse(String(job.payload_json))
          : {};
        const centerRaw = String(payload?.center || 'ALL').toUpperCase();
        const copies = Math.max(1, Number(payload?.copies || 1));
        let layoutKey = String(payload?.layoutKey || 'classic')
          .trim()
          .toLowerCase();
        // Fallback: ordine asporto → layout dedicato (caratteri grandi 80mm)
        if (layoutKey === 'classic' && String(full.fulfillment || '').toLowerCase() === 'takeaway') {
          layoutKey = 'asporto';
        }

        for (let i = 0; i < copies; i += 1) {
          if (centerRaw === 'ALL') {
            await printOrderForCenter(full, 'PIZZERIA', {
              printerSettings,
              layoutKey,
            });
            await printOrderForCenter(full, 'CUCINA', {
              printerSettings,
              layoutKey,
            });
          } else {
            await printOrderForCenter(full, centerRaw, {
              printerSettings,
              layoutKey,
            });
          }
        }
      } else {
        throw new Error('unsupported_kind');
      }

      await markDone(job.id);
      processed += 1;
      logger.info('🧾🟢 [print_jobs] done', { id: job.id });
    } catch (e) {
      const backoffSec = computeBackoffSeconds(attempts);
      const nextRun = new Date(Date.now() + backoffSec * 1000);
      await markFailed(job.id, e, nextRun, attempts, maxAttempts);
      logger.warn('🧾🔁 [print_jobs] fail', {
        id: job.id,
        attempts,
        maxAttempts,
        error: String((e && e.message) || e),
      });
    }
  }

  return { ok: true, processed };
}

module.exports = {
  enqueuePrintJob,
  listPrintJobs,
  retryPrintJob,
  cancelPrintJob,
  processPrintQueueOnce,
};
