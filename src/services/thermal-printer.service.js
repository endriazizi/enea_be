'use strict';

/**
 * Stampa termica (ESC/POS) - daily e placecards.
 * - DAILY: supporto “flat” (tabella classica) e “grouped by time” (blocchi con titolo orario).
 * - Nome cartellino adattivo (una riga, riduzione orizzontale, ellissi).
 * - Padding gestito per evitare tagli dei QR.
 * - Logo PNG centrato.
 * - Date/ora rese in BIZ_TZ (indipendenti dal fuso del server).
 * - Supporto DB utc vs naive (DB_TIME_IS_UTC).
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const iconv = require('iconv-lite');
const { PNG } = require('pngjs');
const logger = require('../logger');

// ─────────────────────────────────────────────────────────────────────────────
// ENV
// ─────────────────────────────────────────────────────────────────────────────
const RESOLVED_HOST = process.env.PRINTER_IP || process.env.PRINTER_HOST || '127.0.0.1';
const RESOLVED_PORT = Number(process.env.PRINTER_PORT || 9100);
const WIDTH_MM      = Number(process.env.PRINTER_WIDTH_MM || 80);
const CODEPAGE      = (process.env.PRINTER_CODEPAGE || 'cp858').toLowerCase();

const DISPLAY_TZ     = process.env.BIZ_TZ || 'Europe/Rome';
const QR_BASE_URL    = (process.env.QR_BASE_URL || '').trim();
const LOGO_PATH      = process.env.PRINTER_LOGO_PATH || 'assets/logo.png';
const DB_TIME_IS_UTC = String(process.env.DB_TIME_IS_UTC || 'false') === 'true';

// DAILY → grouped?
const DAILY_GROUPED  = String(process.env.PRINTER_DAILY_GROUPED ?? 'true') !== 'false';
// Aspetto titolo del blocco orario
const GROUP_T_W = Math.max(1, Math.min(8, Number(process.env.PRINTER_GROUP_TITLE_W || 2)));
const GROUP_T_H = Math.max(1, Math.min(8, Number(process.env.PRINTER_GROUP_TITLE_H || 2)));

// QR config (cartellini)
const QR_SIZE_ENV   = Number(process.env.PRINTER_QR_SIZE || 5);
const QR_ECC_ENV    = String(process.env.PRINTER_QR_ECC || 'H').toUpperCase();
const QR_CAPTION_GAP= Number(process.env.PRINTER_QR_CAPTION_GAP_LINES || 1);

// Padding per separare i cartellini
const TOP_PAD_LINES    = Number(process.env.PRINTER_TOP_PAD_LINES || 2);
const BOTTOM_PAD_LINES = Number(process.env.PRINTER_BOTTOM_PAD_LINES || 4);

// Colonne / dot disponibili
const COLS     = WIDTH_MM >= 70 ? 48 : 32;   // 80mm≈48 col, 58mm≈32 col
const MAX_DOTS = WIDTH_MM >= 70 ? 576 : 384; // indicativo per raster PNG

// ───────────────── ESC/POS helpers ──────────────────────────────────────────
const ESC = Buffer.from([0x1B]);
const GS  = Buffer.from([0x1D]);
const LF  = Buffer.from([0x0A]);

const INIT         = Buffer.concat([ESC, Buffer.from('@')]);      // ESC @
const ALIGN_LEFT   = Buffer.concat([ESC, Buffer.from('a'), Buffer.from([0])]);
const ALIGN_CENTER = Buffer.concat([ESC, Buffer.from('a'), Buffer.from([1])]);
const BOLD_ON      = Buffer.concat([ESC, Buffer.from('E'), Buffer.from([1])]);
const BOLD_OFF     = Buffer.concat([ESC, Buffer.from('E'), Buffer.from([0])]);
const DOUBLE_ON    = Buffer.concat([GS,  Buffer.from('!'), Buffer.from([0x11])]); // h/w 2x
const DOUBLE_OFF   = Buffer.concat([GS,  Buffer.from('!'), Buffer.from([0x00])]);
const CUT_FULL     = Buffer.concat([GS,  Buffer.from('V'), Buffer.from([0])]);

// feed n righe (padding preciso)
function FEED(n = 0) {
  const nn = Math.max(0, Math.min(255, Number(n)||0));
  return Buffer.concat([ESC, Buffer.from('d'), Buffer.from([nn])]);
}

// Dimensione font fine-grained (1..8)
function SIZE(w = 1, h = 1) {
  const W = Math.max(1, Math.min(8, w));
  const H = Math.max(1, Math.min(8, h));
  const v = ((W - 1) << 4) | (H - 1);
  return Buffer.concat([GS, Buffer.from('!'), Buffer.from([v])]);
}

function selectCodepageBuffer() {
  const map = { cp437:0, cp850:2, cp858:19, cp852:18, cp1252:16 };
  const n = map[CODEPAGE] ?? 19;
  return Buffer.concat([ESC, Buffer.from('t'), Buffer.from([n])]);
}
function encode(text) { return iconv.encode(String(text || '').replace(/\r/g, ''), CODEPAGE, { addBOM:false }); }
function line(text='') { return Buffer.concat([ encode(text), LF ]); }

function wrap(text, width = COLS) {
  const words = String(text || '').split(/\s+/);
  const rows = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= width) cur += ' ' + w;
    else { rows.push(cur); cur = w; }
  }
  if (cur) rows.push(cur);
  return rows;
}
function padRight(s, n) { return String(s || '').padEnd(n, ' '); }

function sendToPrinter(buffers) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: RESOLVED_HOST, port: RESOLVED_PORT }, () => {
      for (const b of buffers) socket.write(b);
      socket.end();
    });
    socket.setTimeout(8000);
    socket.on('timeout', () => { socket.destroy(new Error('timeout')); });
    socket.on('error', reject);
    socket.on('close', (hadErr) => hadErr ? reject(new Error('printer socket closed with error'))
                                          : resolve(true));
  });
}

// ─────────────── Date/ora sicure (DB UTC vs naive) ──────────────────────────
function parseDbDate(s) {
  const str = String(s || '').trim();
  if (!str) return new Date(NaN);
  if (str.includes('T')) return new Date(str); // ISO ready
  const base = str.replace(' ', 'T');
  return DB_TIME_IS_UTC ? new Date(base + 'Z') : new Date(base);
}

function formatTimeHHmm(start_at) {
  const d = parseDbDate(start_at);
  return new Intl.DateTimeFormat('it-IT', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DISPLAY_TZ,
  }).format(d);
}
function formatDateHuman(d) {
  return new Intl.DateTimeFormat('it-IT', {
    weekday:'long', day:'2-digit', month:'2-digit', year:'numeric', timeZone: DISPLAY_TZ,
  }).format(d);
}
function formatYmdHuman(ymd) {
  const d = DB_TIME_IS_UTC
    ? new Date(String(ymd||'').trim() + 'T00:00:00Z')
    : new Date(String(ymd||'').trim() + 'T00:00:00');
  return formatDateHuman(d);
}
function up(s) { return (s || '').toString().toUpperCase(); }

// ─────────────────────── Raster PNG (logo) ──────────────────────────────────
function buildRasterFromPNG(png, maxWidthDots = MAX_DOTS, threshold = 200) {
  let targetW = Math.min(maxWidthDots, png.width);
  const ratio = targetW / png.width;
  const targetH = Math.max(1, Math.round(png.height * ratio));
  const bytesPerRow = Math.ceil(targetW / 8);
  const bmp = Buffer.alloc(bytesPerRow * targetH, 0x00);

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(png.width - 1, Math.round(x / ratio));
      const sy = Math.min(png.height - 1, Math.round(y / ratio));
      const idx = (sy * png.width + sx) << 2;
      const r = png.data[idx], g = png.data[idx+1], b = png.data[idx+2], a = png.data[idx+3];
      const gray = a === 0 ? 255 : Math.round(0.2126*r + 0.7152*g + 0.0722*b);
      const bit = gray < threshold ? 1 : 0;
      if (bit) bmp[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
    }
  }

  const m  = 0;
  const xL = bytesPerRow & 0xff, xH = (bytesPerRow >> 8) & 0xff;
  const yL = targetH & 0xff,      yH = (targetH >> 8) & 0xff;

  return Buffer.concat([GS, Buffer.from('v0', 'ascii'), Buffer.from([m, xL, xH, yL, yH]), bmp, LF]);
}

let LOGO_RASTER = null;
(function preloadLogo() {
  try {
    const abs = path.resolve(process.cwd(), LOGO_PATH);
    if (fs.existsSync(abs)) {
      const buf = fs.readFileSync(abs);
      const png = PNG.sync.read(buf);
      const raster = buildRasterFromPNG(png, Math.floor(MAX_DOTS * 0.85), 190);
      LOGO_RASTER = Buffer.concat([ALIGN_CENTER, raster, LF]);
      logger.info(`🖼️ Logo caricato: ${abs}`);
    } else {
      logger.warn(`Logo non trovato: ${abs}`);
    }
  } catch (e) {
    logger.warn('Logo PNG non caricabile', e);
  }
})();

// ──────────────────────── QR ESC/POS (Model 2) ──────────────────────────────
function qrStoreData(data) {
  const payload = encode(data);
  const len = payload.length + 3;
  const pL = len & 0xff, pH = (len >> 8) & 0xff;
  return Buffer.concat([GS, Buffer.from('('), Buffer.from('k'), Buffer.from([pL, pH, 0x31, 0x50, 0x30]), payload]);
}
function qrSetModuleSize(size = 6) {
  const s = Math.max(1, Math.min(16, size));
  return Buffer.concat([GS, Buffer.from('('), Buffer.from('k'), Buffer.from([0x03,0x00,0x31,0x43,s])]);
}
function qrSetECCFromEnv() {
  const map = { L: 48, M: 48, Q: 49, H: 51 };
  const lv = map[QR_ECC_ENV] ?? 51;
  return Buffer.concat([GS, Buffer.from('('), Buffer.from('k'), Buffer.from([0x03,0x00,0x31,0x45, lv])]);
}
function qrPrint() { return Buffer.concat([GS, Buffer.from('('), Buffer.from('k'), Buffer.from([0x03,0x00,0x31,0x51,0x30])]); }

// ───────────────────── Nome adattivo su una riga (cartellini) ───────────────
function printAdaptiveName(buffers, name, maxCols = COLS) {
  const txt = up(name || '');
  const widths = [3, 2, 1];
  const H = 2;
  let chosenW = 1;

  for (const w of widths) {
    const maxLen = Math.floor(maxCols / w);
    if (txt.length <= maxLen) { chosenW = w; break; }
  }
  const maxLenAtChosen = Math.floor(maxCols / chosenW);
  const shown = txt.length > maxLenAtChosen
    ? txt.slice(0, Math.max(0, maxLenAtChosen - 1)) + '…'
    : txt;

  buffers.push(SIZE(chosenW, H), BOLD_ON, ALIGN_CENTER, line(shown), BOLD_OFF, SIZE(1,1));
}

// ─────────────────────────── DAILY (flat) ───────────────────────────────────
function buildDailyFlat(out, rows) {
  // intestazione colonne
  out.push(ALIGN_LEFT, BOLD_ON);
  out.push(line(
    padRight('ORA',5) + ' ' +
    padRight('TAV',4) + ' ' +
    padRight('PAX',3) + ' ' +
    padRight('NOME', COLS-5-1-4-1-3-1)
  ));
  out.push(BOLD_OFF, line('-'.repeat(COLS)));

  rows.sort((a,b) => String(a.start_at).localeCompare(String(b.start_at)));

  for (const r of rows) {
    const time = formatTimeHHmm(r.start_at);
    const tav  = (r.table_number || r.table_id || '-').toString();
    const pax  = (r.party_size || '-').toString();
    const name = ((r.customer_first || '') + ' ' + (r.customer_last || '')).trim() || '—';

    const left = `${padRight(time,5)} ${padRight(tav,4)} ${padRight(pax,3)} `;
    const nameWidth = COLS - left.length;
    const nameRows = wrap(name, nameWidth);
    out.push(line(left + padRight(nameRows[0] || '', nameWidth)));
    for (let i=1;i<nameRows.length;i++) out.push(line(' '.repeat(left.length) + nameRows[i]));

    if (r.phone) out.push(line(' '.repeat(left.length) + String(r.phone)));
    if (r.notes) {
      const notesRows = wrap('NOTE: ' + r.notes, COLS - left.length);
      for (const rr of notesRows) out.push(line(' '.repeat(left.length) + rr));
    }
    out.push(line(' '.repeat(COLS)));
  }
}

// ───────────────────── DAILY (grouped by time) ──────────────────────────────
function buildDailyGroupedBlocks(out, rows) {
  // 1) raggruppo per HH:mm già nel fuso di stampa
  const groups = new Map(); // key: 'HH:mm' → array di rows
  for (const r of rows) {
    const t = formatTimeHHmm(r.start_at);
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(r);
  }
  // 2) ordino le chiavi orarie (numericamente 00..23:59)
  const keys = Array.from(groups.keys()).sort((a, b) => {
    const [ah, am] = a.split(':').map(Number);
    const [bh, bm] = b.split(':').map(Number);
    return ah !== bh ? ah - bh : am - bm;
  });

  // 3) per ogni gruppo → titolo grande centrato + elenco senza ora
  for (const k of keys) {
    const list = groups.get(k) || [];
    // Titolo del gruppo (orario), ben visibile
    out.push(ALIGN_CENTER, SIZE(GROUP_T_W, GROUP_T_H), BOLD_ON, line(k), BOLD_OFF, SIZE(1,1));
    out.push(line('-'.repeat(COLS)));

    // Righe: TAV  PAX  NOME (+ phone/notes)
    list.sort((a,b) => (a.table_number ?? a.table_id ?? 0) - (b.table_number ?? b.table_id ?? 0));

    for (const r of list) {
      const tav  = (r.table_number || r.table_id || '-').toString();
      const pax  = (r.party_size || '-').toString();
      const name = ((r.customer_first || '') + ' ' + (r.customer_last || '')).trim() || '—';

      const left = `${padRight(tav,4)} ${padRight(pax,3)} `;
      const nameWidth = COLS - left.length;
      const nameRows = wrap(name, nameWidth);
      out.push(ALIGN_LEFT, line(left + padRight(nameRows[0] || '', nameWidth)));
      for (let i=1;i<nameRows.length;i++) out.push(line(' '.repeat(left.length) + nameRows[i]));

      if (r.phone) out.push(line(' '.repeat(left.length) + String(r.phone)));
      if (r.notes) {
        const notesRows = wrap('NOTE: ' + r.notes, COLS - left.length);
        for (const rr of notesRows) out.push(line(' '.repeat(left.length) + rr));
      }
      out.push(line(' '.repeat(COLS)));
    }

    // separatore tra blocchi
    out.push(line('-'.repeat(COLS)));
  }
}

// ───────────────────────────── DAILY main ───────────────────────────────────
async function printDailyReservations({ date, rows, user }) {
  logger.info('🖨️ DAILY begin', {
    date, rows: rows?.length || 0, host: RESOLVED_HOST, port: RESOLVED_PORT,
    cols: COLS, codepage: CODEPAGE, tz: DISPLAY_TZ, utc: DB_TIME_IS_UTC, grouped: DAILY_GROUPED
  });

  const out = [];
  out.push(INIT, selectCodepageBuffer(), ALIGN_CENTER, BOLD_ON, DOUBLE_ON);
  out.push(line('PRENOTAZIONI'));
  out.push(DOUBLE_OFF, BOLD_OFF);

  const header = formatYmdHuman(date).toUpperCase();
  out.push(line(header));
  out.push(line('-'.repeat(COLS)));

  if (DAILY_GROUPED) buildDailyGroupedBlocks(out, rows);
  else               buildDailyFlat(out, rows);

  out.push(ALIGN_CENTER, line(`Operatore: ${user?.email || 'sistema'}`));
  out.push(line(''), line(''), CUT_FULL);

  await sendToPrinter(out);
  return { jobId: `daily_${Date.now()}`, printedCount: rows.length };
}

// ─────────────────────────── PLACE CARDS ────────────────────────────────────
function buildOnePlaceCardBuffers(r, opts = {}) {
  const out = [];

  const time = formatTimeHHmm(r.start_at);
  const dateObj = parseDbDate(String(r.start_at || ''));
  const dateHuman = formatDateHuman(dateObj);

  const tav  = (r.table_number || r.table_id || '-').toString();
  const pax  = (r.party_size || '-').toString();
  const sala = r.room_name || r.room || r.room_id || '-';
  const name = ((r.customer_last || '') + ' ' + (r.customer_first || '')).trim() || 'OSPITE';

  out.push(INIT, selectCodepageBuffer(), ALIGN_CENTER);

  if (TOP_PAD_LINES > 0) out.push(FEED(TOP_PAD_LINES));
  if (LOGO_RASTER) out.push(LOGO_RASTER);

  out.push(SIZE(2,1), BOLD_ON, line(`TAVOLO ${tav}`), BOLD_OFF, SIZE(1,1));
  printAdaptiveName(out, name, COLS);

  out.push(BOLD_ON, line(`${time}  •  ${dateHuman}`), BOLD_OFF);
  out.push(line(`SALA:  ${sala}   •   COPERTI: ${pax}`));
  out.push(line(''));

  const qrUrl = opts.qrUrl || (QR_BASE_URL ? `${QR_BASE_URL.replace(/\/+$/,'')}/` : null);
  if (qrUrl) {
    out.push(line('Scansiona il QR del locale'));
    if (QR_CAPTION_GAP > 0) out.push(FEED(QR_CAPTION_GAP));
    out.push(ALIGN_CENTER, qrSetModuleSize(QR_SIZE_ENV), qrSetECCFromEnv(), qrStoreData(qrUrl), qrPrint());
    out.push(line(''));
  }

  if (BOTTOM_PAD_LINES > 0) out.push(FEED(BOTTOM_PAD_LINES));
  out.push(CUT_FULL);
  return out;
}

async function printPlaceCards({ date, rows, user, logoText, qrBaseUrl }) {
  logger.info('🖨️ PLACECARDS begin', {
    date, rows: rows?.length || 0, host: RESOLVED_HOST, port: RESOLVED_PORT,
    cols: COLS, codepage: CODEPAGE, tz: DISPLAY_TZ, utc: DB_TIME_IS_UTC
  });

  const buffers = [];
  for (const r of rows) {
    buffers.push(...buildOnePlaceCardBuffers(r, {
      qrUrl: qrBaseUrl || (QR_BASE_URL || null),
    }));
  }

  await sendToPrinter(buffers);
  return { jobId: `placecards_${Date.now()}`, printedCount: rows.length };
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  printDailyReservations,
  printPlaceCards,
};
