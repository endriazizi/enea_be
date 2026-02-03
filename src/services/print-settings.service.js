// src/services/print-settings.service.js
// ============================================================================
// Print Settings — persistenza DB + normalizzazione (stile Endri, log emoji)
// ============================================================================

'use strict';

const logger = require('../logger');
const { query } = require('../db');

const PRINT_SETTINGS_DEFAULTS = {
  printer_enabled: true,
  printer_ip: '',
  printer_port: 9100,
  // === Comanda (takeaway) ===================================================
  comanda_layout: 'classic',            // classic | mcd
  takeaway_center: 'pizzeria',          // pizzeria | cucina
  takeaway_copies: 1,                   // 1..3
  takeaway_auto_print: true,
  // 🔙 compat: campo legacy (se presente in DB)
  takeaway_comanda_center: 'ALL',
};

function normalizePrintSettings(raw) {
  const src = raw || {};
  const enabled = typeof src.printer_enabled === 'boolean'
    ? src.printer_enabled
    : !!Number(src.printer_enabled ?? PRINT_SETTINGS_DEFAULTS.printer_enabled);

  const ip = String(
    src.printer_ip ?? PRINT_SETTINGS_DEFAULTS.printer_ip,
  ).trim();

  const portNum = Number(
    src.printer_port ?? PRINT_SETTINGS_DEFAULTS.printer_port,
  );
  const port =
    Number.isFinite(portNum) && portNum > 0 ? portNum : PRINT_SETTINGS_DEFAULTS.printer_port;

  const autoPrint = typeof src.takeaway_auto_print === 'boolean'
    ? src.takeaway_auto_print
    : !!Number(
      src.takeaway_auto_print ?? PRINT_SETTINGS_DEFAULTS.takeaway_auto_print,
    );

  // Layout comanda (classic | mcd)
  const layoutRaw = String(
    src.comanda_layout ?? PRINT_SETTINGS_DEFAULTS.comanda_layout,
  ).trim().toLowerCase();
  const comanda_layout =
    layoutRaw === 'mcd' ? 'mcd' : 'classic';

  // Centro comanda (nuovo)
  const centerRaw = String(
    src.takeaway_center ??
      src.takeaway_comanda_center ??
      PRINT_SETTINGS_DEFAULTS.takeaway_center,
  ).trim().toLowerCase();
  const takeaway_center =
    centerRaw === 'cucina' ? 'cucina' : 'pizzeria';

  // Copie comanda (1..3)
  const copiesNum = Number(
    src.takeaway_copies ?? PRINT_SETTINGS_DEFAULTS.takeaway_copies,
  );
  const takeaway_copies =
    Number.isFinite(copiesNum)
      ? Math.min(3, Math.max(1, Math.trunc(copiesNum)))
      : PRINT_SETTINGS_DEFAULTS.takeaway_copies;

  // 🔙 compat legacy (ALL/PIZZERIA/CUCINA)
  const legacyCenterRaw =
    src.takeaway_comanda_center != null
      ? String(src.takeaway_comanda_center).trim().toUpperCase()
      : '';
  const takeaway_comanda_center =
    legacyCenterRaw === 'PIZZERIA' || legacyCenterRaw === 'CUCINA' || legacyCenterRaw === 'ALL'
      ? legacyCenterRaw
      : String(takeaway_center || 'PIZZERIA').toUpperCase();

  return {
    printer_enabled: enabled,
    printer_ip: ip,
    printer_port: port,
    comanda_layout,
    takeaway_center,
    takeaway_copies,
    takeaway_auto_print: autoPrint,
    takeaway_comanda_center,
  };
}

async function getPrintSettings() {
  try {
    const rows = await query(
      `SELECT
         printer_enabled,
         printer_ip,
         printer_port,
         comanda_layout,
         takeaway_center,
         takeaway_copies,
         takeaway_auto_print,
         takeaway_comanda_center
       FROM print_settings
       ORDER BY id ASC
       LIMIT 1`,
    );
    const raw = rows && rows[0] ? rows[0] : null;
    return {
      ...normalizePrintSettings(raw || PRINT_SETTINGS_DEFAULTS),
      _source: 'db',
    };
  } catch (e) {
    logger.warn('⚠️ print_settings load KO', { error: String(e) });
    return {
      ...normalizePrintSettings(PRINT_SETTINGS_DEFAULTS),
      _source: 'env',
    };
  }
}

async function savePrintSettings(next) {
  const p = normalizePrintSettings(next);
  await query(
    `INSERT INTO print_settings (
       id,
       printer_enabled,
       printer_ip,
       printer_port,
       comanda_layout,
       takeaway_center,
       takeaway_copies,
       takeaway_auto_print,
       takeaway_comanda_center,
       updated_at
     ) VALUES (
       1, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP()
     )
     ON DUPLICATE KEY UPDATE
       printer_enabled = VALUES(printer_enabled),
       printer_ip = VALUES(printer_ip),
       printer_port = VALUES(printer_port),
       comanda_layout = VALUES(comanda_layout),
       takeaway_center = VALUES(takeaway_center),
       takeaway_copies = VALUES(takeaway_copies),
       takeaway_auto_print = VALUES(takeaway_auto_print),
       takeaway_comanda_center = VALUES(takeaway_comanda_center),
       updated_at = UTC_TIMESTAMP()`,
    [
      p.printer_enabled ? 1 : 0,
      p.printer_ip,
      p.printer_port,
      p.comanda_layout,
      p.takeaway_center,
      p.takeaway_copies,
      p.takeaway_auto_print ? 1 : 0,
      p.takeaway_comanda_center,
    ],
  );
  logger.info('🧾⚙️ [PrintSettings] saved', {
    comanda_layout: p.comanda_layout,
    takeaway_center: p.takeaway_center,
    takeaway_copies: p.takeaway_copies,
    takeaway_auto_print: p.takeaway_auto_print,
    printer_enabled: p.printer_enabled,
    printer_ip: p.printer_ip || null,
    printer_port: p.printer_port,
  });
  return { ...p, _source: 'db' };
}

module.exports = {
  PRINT_SETTINGS_DEFAULTS,
  normalizePrintSettings,
  getPrintSettings,
  savePrintSettings,
};
