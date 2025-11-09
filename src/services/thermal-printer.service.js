// server/src/services/thermal-printer.service.js
// Stampa termica: daily, placecards multipli e singolo segnaposto.
// Mantengo lo stile e NON sovrascrivo la tua logica ordini: provo le API esistenti
// e, se mancano i metodi “placecard”, uso un fallback ESC/POS in solo testo
// (niente QR/immagini → massima compatibilità). Formattazione tipo utils/print.js.
// 🆕 Opzioni compatibili (ENV): PRINTER_CODEPAGE, PRINTER_WIDTH_MM / PRINTER_COLS,
// PRINTER_DAILY_GROUPED, PRINTER_LOGO_PATH (PNG), BIZ_TZ, DB_TIME_IS_UTC,
// PRINTER_QR_SIZE, PRINTER_QR_ECC, PRINTER_TOP_PAD_LINES, PRINTER_BOTTOM_PAD_LINES,
// PRINTER_HEADER_FEED_BEFORE, PRINTER_FOOTER_FEED_AFTER, PRINTER_DEBUG_HEX,
// PRINTER_QR_MODE (auto|escpos|raster), PRINTER_QR_SCALE, PRINTER_TIME_DATE_SEP.

'use strict';

const fs     = require('fs');
const path   = require('path');
const net    = require('net');
const logger = require('../logger');
const env    = require('../env');

// opzionali: codepage + PNG (fallback automatici se non installati)
let iconv;
try { iconv = require('iconv-lite'); } catch { iconv = null; }
let PNGjs;
try { ({ PNG: PNGjs } = require('pngjs')); } catch (e) { PNGjs = null; }
// opzionale per QR raster
let QRLib;
try { QRLib = require('qrcode'); } catch (e) { QRLib = null; }

// Se hai già un order-printer service, lo riuso:
let orderPrinter;
try { orderPrinter = require('./order-printer.service'); }
catch { orderPrinter = null; }

/* ───────────────────────────────── Helpers ───────────────────────────────── */

function toISO(x) {
  if (!x) return '';
  if (x instanceof Date) return x.toISOString();
  if (typeof x === 'string') return x;
  if (typeof x === 'number') { const d = new Date(x); return isNaN(d) ? '' : d.toISOString(); }
  const s = x?.date || x?.day || x?.ymd || '';
  return typeof s === 'string' ? s : '';
}
function toYMD(x) {
  const iso = toISO(x) || new Date().toISOString();
  return String(iso).slice(0, 10); // YYYY-MM-DD
}
function timeHM(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${hh}:${mm}`;
}

// ASCII “safe”: rimpiazza caratteri fuori 0x20..0x7E (evita problemi codepage)
function asciiSafe(s) { return String(s || '').replace(/[^\x20-\x7E]/g, '?'); }

// Colonne: 80mm≈48, 58mm≈42/32 — override con PRINTER_COLS se vuoi forzare
const WIDTH_MM = Number(process.env.PRINTER_WIDTH_MM || 80);
const COLS = Number(process.env.PRINTER_COLS || (WIDTH_MM >= 70 ? 48 : 42));

// Padding a larghezza fissa (default 42/48 colonne)
function padLine(left, right, width = COLS) {
  let L = asciiSafe(String(left || ''));
  let R = asciiSafe(String(right || ''));
  const maxLeft = Math.max(0, width - (R.length + 1));
  if (L.length > maxLeft) {
    L = (maxLeft > 3) ? (L.slice(0, maxLeft - 3) + '...') : L.slice(0, maxLeft);
  }
  const spaces = Math.max(1, width - (L.length + R.length));
  return L + ' '.repeat(spaces) + R;
}

const ESC = 0x1b, GS = 0x1d;
function cmdInit()         { return Buffer.from([ESC, 0x40]); }            // ESC @
function cmdAlign(n=0)     { return Buffer.from([ESC, 0x61, n]); }         // 0=left 1=center 2=right
function cmdMode(n=0)      { return Buffer.from([ESC, 0x21, n]); }         // bitmask stile testo
function cmdLF(n=1)        { return Buffer.from(Array(n).fill(0x0a)); }
function cmdCut(full=true) { return Buffer.from([GS, 0x56, full ? 0x00 : 0x01]); }

// feed n righe (padding preciso)
function cmdFeed(n = 0) {
  const nn = Math.max(0, Math.min(255, Number(n)||0));
  return Buffer.from([ESC, 0x64, nn]);
}

// dimensione h/w 1..8 (GS ! v) — compat ampiezza/altezza
function cmdSize(w = 1, h = 1) {
  const W = Math.max(1, Math.min(8, w));
  const H = Math.max(1, Math.min(8, h));
  const v = ((W - 1) << 4) | (H - 1);
  return Buffer.from([GS, 0x21, v]);
}

// Codepage (default cp858) + encode
const CODEPAGE = (process.env.PRINTER_CODEPAGE || 'cp858').toLowerCase();
function selectCodepageBuffer() {
  const map = { cp437:0, cp850:2, cp852:18, cp858:19, cp1252:16 };
  const n = map[CODEPAGE] ?? 19;
  return Buffer.from([ESC, 0x74, n]);
}
function encodeText(s) {
  const plain = String(s || '').replace(/\r/g, '');
  // ➜ fallback latin1: così caratteri base restano stampabili (niente bullet)
  if (!iconv) return Buffer.from(plain, 'latin1');
  try { return iconv.encode(plain, CODEPAGE, { addBOM:false }); }
  catch { return Buffer.from(plain, 'latin1'); }
}
function line(s='') { return Buffer.concat([ encodeText(s), Buffer.from([0x0a]) ]); }
// testo senza newline (per comporre righe miste con grandezze diverse)
function text(s='') { return encodeText(s); }

// Intestazioni/piedi da ENV o env.PRINTER
function readHeaderLines() {
  const raw = env.PRINTER?.header ?? process.env.PRINTER_HEADER ?? '';
  return String(raw).split('|').filter(Boolean);
}
function readFooterLines() {
  const raw = env.PRINTER?.footer ?? process.env.PRINTER_FOOTER ?? '';
  return String(raw).split('|').filter(Boolean);
}

function socketWrite(sock, chunk) {
  return new Promise((res, rej) => sock.write(chunk, (err) => err ? rej(err) : res()));
}

/**
 * withPrinter: gestisce connessione + header/footer + cut.
 * NB: header/footer via ENV; imposta anche codepage se disponibile.
 * 🆕: feed configurabili prima dell'header e dopo il footer (prima del cut).
 */
async function withPrinter(io, fn) {
  if (!env.PRINTER?.enabled && String(process.env.PRINTER_ENABLED).toLowerCase()!=='true') {
    logger.warn('🖨️ PRINTER disabled by env'); return { jobId:`noop-${Date.now()}`, printedCount:0 };
  }
  const ip   = env.PRINTER?.ip   || process.env.PRINTER_IP;
  const port = Number(env.PRINTER?.port || process.env.PRINTER_PORT || 9100);
  if (!ip || !port) { logger.warn('🖨️ PRINTER not configured'); return { jobId:`noop-${Date.now()}`, printedCount:0 }; }

  const sock = new net.Socket();
  await new Promise((res, rej) => {
    sock.once('error', rej);
    sock.connect(port, ip, () => { sock.off('error', rej); res(); });
  });

  const HEADER_FEED_BEFORE = Number(process.env.PRINTER_HEADER_FEED_BEFORE || 0);
  const FOOTER_FEED_AFTER  = Number(process.env.PRINTER_FOOTER_FEED_AFTER  || 4);

  try {
    await socketWrite(sock, cmdInit());
    await socketWrite(sock, selectCodepageBuffer());

    // Header (centrato)
    const headerLines = readHeaderLines();
    if (headerLines.length) {
      if (HEADER_FEED_BEFORE > 0) await socketWrite(sock, cmdFeed(HEADER_FEED_BEFORE));
      await socketWrite(sock, cmdAlign(1));
      for (const l of headerLines) { await socketWrite(sock, line(l)); }
      await socketWrite(sock, cmdLF(1));
      await socketWrite(sock, cmdAlign(0));
    }

    const out = await fn(sock);

    // Footer (centrato)
    const footerLines = readFooterLines();
    if (footerLines.length) {
      await socketWrite(sock, cmdLF(1));
      await socketWrite(sock, cmdAlign(1));
      for (const l of footerLines) { await socketWrite(sock, line(l)); }
      await socketWrite(sock, cmdAlign(0));
    }

    // 🆕 extra feed sotto il footer prima del taglio (evita che "salga" sul successivo)
    if (FOOTER_FEED_AFTER > 0) await socketWrite(sock, cmdFeed(FOOTER_FEED_AFTER));

    const doCut = (env.PRINTER?.cut ?? String(process.env.PRINTER_CUT||'true').toLowerCase()==='true');
    if (doCut) { await socketWrite(sock, cmdCut(true)); }
    sock.end();
    return out || { jobId:`job-${Date.now()}`, printedCount:0 };
  } catch (e) {
    try { sock.end(); } catch {}
    throw e;
  }
}

/* ─────────────── Opzioni avanzate opzionali (TZ, QR, PNG) ─────────────── */

const DISPLAY_TZ     = process.env.BIZ_TZ || 'Europe/Rome';
const DB_TIME_IS_UTC = String(process.env.DB_TIME_IS_UTC || 'false') === 'true';
const DAILY_GROUPED  = String(process.env.PRINTER_DAILY_GROUPED ?? 'true') !== 'false'; // default true

const TOP_PAD_LINES    = Number(process.env.PRINTER_TOP_PAD_LINES || 2);
const BOTTOM_PAD_LINES = Number(process.env.PRINTER_BOTTOM_PAD_LINES || 4);

// QR
const QR_BASE_URL     = (process.env.QR_BASE_URL || '').trim();
const QR_SIZE_ENV     = Number(process.env.PRINTER_QR_SIZE || 5);
// ✅ ECC corretto: L=48, M=49, Q=50, H=51
const QR_ECC_ENV      = String(process.env.PRINTER_QR_ECC || 'H').toUpperCase();
const QR_CAPTION_GAP  = Number(process.env.PRINTER_QR_CAPTION_GAP_LINES || 1);
const DEBUG_HEX       = String(process.env.PRINTER_DEBUG_HEX || '').toLowerCase() === 'true';
// 🆕: di default imposto raster (più compatibile sulle stampanti economiche)
const QR_MODE         = String(process.env.PRINTER_QR_MODE || 'raster').toLowerCase(); // auto|escpos|raster
const QR_SCALE        = Math.max(1, Math.min(12, Number(process.env.PRINTER_QR_SCALE || 4)));
const TIME_DATE_SEP   = (process.env.PRINTER_TIME_DATE_SEP ?? '  -  '); // ← niente bullet ‘•’

const MAX_DOTS = WIDTH_MM >= 70 ? 576 : 384; // raster approx

function parseDbDate(s) {
  const str = String(s || '').trim();
  if (!str) return new Date(NaN);
  if (str.includes('T')) return new Date(str);
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

// Raster PNG (opzionale)
function buildRasterFromPNG(png, maxWidthDots = MAX_DOTS, threshold = 200) {
  const targetW = Math.min(maxWidthDots, png.width);
  const ratio   = targetW / png.width;
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
  return Buffer.concat([Buffer.from([GS, 0x76, 0x30, m, xL, xH, yL, yH]), bmp, Buffer.from([0x0a])]);
}

let LOGO_RASTER = null;
(function preloadLogo() {
  try {
    const logoPath = process.env.PRINTER_LOGO_PATH || 'assets/logo.png';
    const abs = path.resolve(process.cwd(), logoPath);
    if (PNGjs && fs.existsSync(abs)) {
      const buf = fs.readFileSync(abs);
      const png = PNGjs.sync.read(buf);
      const raster = buildRasterFromPNG(png, Math.floor(MAX_DOTS * 0.85), 190);
      LOGO_RASTER = Buffer.concat([cmdAlign(1), raster, cmdLF(1)]);
      logger.info(`🖼️ Logo caricato: ${abs}`);
    }
  } catch (e) {
    logger.warn('Logo PNG non caricabile', { msg: String(e?.message || e) });
  }
})();

// ──────────────────────── QR ESC/POS (Model 2) ──────────────────────────────
function qrSelectModel2() { return Buffer.from([GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]); }
function qrStoreData(data) {
  const payload = Buffer.from(String(data || ''), 'ascii'); // URL → ASCII puro
  const len = payload.length + 3;
  const pL = len & 0xff, pH = (len >> 8) & 0xff;
  return Buffer.from([GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30, ...payload]);
}
function qrSetModuleSize(size = 6) {
  const s = Math.max(1, Math.min(16, size));
  return Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, s]);
}
function qrSetECCFromEnv() {
  const map = { L: 48, M: 49, Q: 50, H: 51 };
  const lv = map[QR_ECC_ENV] ?? 51;
  return Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, lv]);
}
function qrPrint() { return Buffer.from([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]); }

// Nome adattivo su una riga (cartellini)
function printAdaptiveName(buffers, name, maxCols = COLS) {
  const txt = up(name || '');
  const widths = [3, 2, 1]; // prova 3x → 2x → 1x (altezza fissa 2)
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
  buffers.push(cmdSize(chosenW, H), cmdAlign(1), line(shown), cmdAlign(0), cmdSize(1,1));
}

/* ─────────────── FUNZIONI ADEGUATE ALLO STILE “VECCHIO” ─────────────── */

/**
 * 🗒️ Stampa giornaliera prenotazioni (formato testo tipo print.js)
 * - intestazione "Prenotazioni <giorno umano>"
 * - separatori a COLS colonne
 * - modalità:
 *   • grouped (default): blocchi per HH:mm con titolo grande centrato
 *   • flat: tabellare con ORA/TAV/PAX/NOME (+ phone/notes su righe successive)
 * - niente simbolo euro (compat codepage)
 */
async function printDailyReservations(args) {
  // (1) Riuso modulo esterno se disponibile (non tocco la tua logica)
  if (orderPrinter?.printDailyReservations) {
    return await orderPrinter.printDailyReservations(args);
  }

  const date = toYMD(args?.date);
  const rows = Array.isArray(args?.rows) ? args.rows : [];

  return await withPrinter({}, async (sock) => {
    const sep = '-'.repeat(COLS);

    // Titolo
    await socketWrite(sock, cmdAlign(1));
    await socketWrite(sock, cmdMode(0x08)); // bold
    await socketWrite(sock, line('PRENOTAZIONI'));
    await socketWrite(sock, cmdMode(0x00));
    await socketWrite(sock, line(formatYmdHuman(date).toUpperCase()));
    await socketWrite(sock, cmdAlign(0));
    await socketWrite(sock, line(sep));

    let printed = 0;

    if (DAILY_GROUPED) {
      // Raggruppo per orario (nel fuso DISPLAY_TZ)
      const groups = new Map();
      for (const r of rows) {
        const t = formatTimeHHmm(r.start_at);
        if (!groups.has(t)) groups.set(t, []);
        groups.get(t).push(r);
      }
      const keys = Array.from(groups.keys()).sort((a,b) => a.localeCompare(b));

      for (const k of keys) {
        const list = groups.get(k) || [];
        await socketWrite(sock, cmdAlign(1));
        await socketWrite(sock, cmdSize(2,2));
        await socketWrite(sock, line(k));
        await socketWrite(sock, cmdSize(1,1));
        await socketWrite(sock, cmdAlign(0));
        await socketWrite(sock, line(sep));

        list.sort((a,b) => (a.table_number ?? a.table_id ?? 0) - (b.table_number ?? b.table_id ?? 0));

        for (const r of list) {
          const tavNum = (r.table_number ?? r.table_id ?? '').toString();
          const pax    = (r.party_size || '-').toString();
          const name   = ((r.customer_first || '') + ' ' + (r.customer_last || '')).trim() || '—';

          // Blocco sinistro: "T" normale + numero grande (2x2 bold) + due spazi
          const leftVisualCols = 2 /*"T "*/ + 2 /*num 2x width*/ + 2 /*gap*/;

          // Prima riga: T + numero grande + prima parte nome
          await socketWrite(sock, text('T '));
          await socketWrite(sock, cmdMode(0x08));
          await socketWrite(sock, cmdSize(2,2));
          await socketWrite(sock, text(tavNum || '-'));
          await socketWrite(sock, cmdSize(1,1));
          await socketWrite(sock, cmdMode(0x00));
          await socketWrite(sock, text('  ')); // gap visivo

          const w1 = Math.max(1, COLS - leftVisualCols);
          const first = name.slice(0, w1);
          await socketWrite(sock, line(first));

          // Seconda riga: rientro e resto del nome / info
          const remain = name.slice(w1).trim();
          if (remain) await socketWrite(sock, line(' '.repeat(leftVisualCols) + remain));
          if (r.phone) await socketWrite(sock, line(' '.repeat(leftVisualCols) + String(r.phone)));
          if (r.notes) await socketWrite(sock, line(' '.repeat(leftVisualCols) + ('NOTE: ' + r.notes)));
          await socketWrite(sock, cmdLF(1));
          printed++;
        }
        await socketWrite(sock, line(sep));
      }
    } else {
      // Flat tabellare
      const head =
        'ORA  ' + 'TAV  ' + 'PAX ' + 'NOME'.padEnd(Math.max(4, COLS - ('ORA  TAV  PAX '.length)));
      await socketWrite(sock, cmdMode(0x08));
      await socketWrite(sock, line(head));
      await socketWrite(sock, cmdMode(0x00));
      await socketWrite(sock, line(sep));

      rows.sort((a,b) => String(a.start_at).localeCompare(String(b.start_at)));

      for (const r of rows) {
        const time = formatTimeHHmm(r.start_at);
        const tav  = (r.table_number ?? r.table_id ?? '-').toString().padEnd(4, ' ');
        const pax  = (r.party_size || '-').toString().padEnd(3, ' ');
        const name = ((r.customer_first || '') + ' ' + (r.customer_last || '')).trim() || '—';

        const left = `${time}  ${tav} ${pax}`;
        const width = Math.max(1, COLS - left.length - 1);
        const first = name.slice(0, width);
        await socketWrite(sock, line(left + ' ' + first));

        const remain = name.slice(width).trim();
        if (remain) await socketWrite(sock, line(' '.repeat(left.length + 1) + remain));
        if (r.phone) await socketWrite(sock, line(' '.repeat(left.length + 1) + String(r.phone)));
        if (r.notes) await socketWrite(sock, line(' '.repeat(left.length + 1) + ('NOTE: ' + r.notes)));
        await socketWrite(sock, cmdLF(1));
        printed++;
      }
      await socketWrite(sock, line(sep));
    }

    await socketWrite(sock, cmdAlign(1));
    await socketWrite(sock, line(`Operatore: ${args?.user?.email || 'sistema'}`));
    await socketWrite(sock, cmdAlign(0));
    return { jobId: `daily-${Date.now()}`, printedCount: printed };
  });
}

/**
 * 🪪 Stampa segnaposti in batch (formato testo vecchio)
 * - Prova riuso modulo esterno; se non c'è, chiama printSinglePlaceCard per ogni riga
 * - Ritorna jobId di batch + printedCount
 */
async function printPlaceCards(args) {
  // (1) Riuso modulo esterno, se presente
  if (orderPrinter?.printPlaceCards) {
    return await orderPrinter.printPlaceCards(args);
  }

  // (2) Se esiste solo il “singolo”, vado in batch manuale
  if (orderPrinter?.printSinglePlaceCard || orderPrinter?.printPlacecardOne || orderPrinter?.printPlaceCardOne) {
    const rows = Array.isArray(args?.rows) ? args.rows : [];
    let count = 0;
    for (const r of rows) {
      await printSinglePlaceCard({ reservation: r, user: args?.user, logoText: args?.logoText, qrBaseUrl: args?.qrBaseUrl });
      count++;
    }
    return { jobId: `placecards-${Date.now()}`, printedCount: count };
  }

  // (3) Fallback: batch tramite singolo “nostro”
  const rows = Array.isArray(args?.rows) ? args.rows : [];
  let count = 0;
  for (const r of rows) {
    await printSinglePlaceCard({ reservation: r, user: args?.user, logoText: args?.logoText, qrBaseUrl: args?.qrBaseUrl });
    count++;
  }
  return { jobId: `placecards-${Date.now()}`, printedCount: count };
}

/**
 * 🎴 Singolo segnaposto (fallback stile vecchio)
 * - Nome centrato in grande (doppia altezza, adattivo 3x/2x/1x + ellissi)
 * - Riga sotto: "(coperti)  Sala" se presente
 * - Logo PNG centrato (se PRINTER_LOGO_PATH presente e pngjs disponibile)
 * - QR opzionale: usa qrBaseUrl oppure QR_BASE_URL (ENV)
 * - Usa top/bottom pad da env: PRINTER_TOP_PAD_LINES / PRINTER_BOTTOM_PAD_LINES
 * - 🆕 Log di debug delle variabili interpolate (tavolo/qr/etc.)
 */
async function printSinglePlaceCard({ reservation, user, logoText, qrBaseUrl }) {
  // (1) Metodi nativi esistenti: non tocco la tua logica
  if (orderPrinter?.printSinglePlaceCard) {
    const out = await orderPrinter.printSinglePlaceCard({ reservation, user, logoText, qrBaseUrl });
    return { jobId: out?.jobId || `placecard-${reservation?.id}-${Date.now()}` };
  }
  if (orderPrinter?.printPlacecardOne) {
    const out = await orderPrinter.printPlacecardOne({ reservation, user, logoText, qrBaseUrl });
    return { jobId: out?.jobId || `placecard-${reservation?.id}-${Date.now()}` };
  }
  if (orderPrinter?.printPlaceCardOne) {
    const out = await orderPrinter.printPlaceCardOne({ reservation, user, logoText, qrBaseUrl });
    return { jobId: out?.jobId || `placecard-${reservation?.id}-${Date.now()}` };
  }

  // (2) Fallback testuale con formattazione tipo utils/print.js
  const name = (reservation?.display_name || `${reservation?.customer_first||''} ${reservation?.customer_last||''}` || 'Cliente').trim();
  const cov  = Number(reservation?.party_size || reservation?.covers || 0) || 1;

  // Tavolo robusto: primo definito
  const tableNum  = (reservation?.table_number ?? reservation?.table_id ?? null);
  const tableName = reservation?.table_name || null;
  const tavNumberOnly = (tableNum !== null && tableNum !== '') ? String(tableNum) : (tableName || '');

  const sala = reservation?.room_name || reservation?.room || reservation?.room_id || '';

  // Log dettagliato dei valori interpolati
  logger.info('🧩 placecard vars', {
    id: reservation?.id || null,
    name, cov,
    table_number: reservation?.table_number ?? null,
    table_id: reservation?.table_id ?? null,
    table_name: reservation?.table_name ?? null,
    tavNumberOnly: tavNumberOnly,
    room_name: reservation?.room_name ?? null,
    qr_base_env: QR_BASE_URL || '',
    qr_base_arg: qrBaseUrl || '',
    cols: COLS
  });

  return await withPrinter({}, async (sock) => {
    await socketWrite(sock, cmdAlign(1));
    if (TOP_PAD_LINES > 0) await socketWrite(sock, cmdFeed(TOP_PAD_LINES));

    if (LOGO_RASTER) { await socketWrite(sock, LOGO_RASTER); }

    // 🆕 SOLO NUMERO TAVOLO — enorme e bold (8x8). Se non c'è, non stampo nulla qui.
    if (tavNumberOnly) {
      await socketWrite(sock, cmdMode(0x08));       // bold
      await socketWrite(sock, cmdSize(8,8));        // enorme
      await socketWrite(sock, line(up(String(tavNumberOnly))));
      await socketWrite(sock, cmdSize(1,1));
      await socketWrite(sock, cmdMode(0x00));
    }

    // Nome grande adattivo
    const buffers = [];
    printAdaptiveName(buffers, name, COLS);
    for (const b of buffers) await socketWrite(sock, b);

    // Sotto-riga informativa
    const infoParts = [`(${cov})`];
    if (sala) infoParts.push(`SALA ${sala}`);
    await socketWrite(sock, line(infoParts.join('  ')));

    // Data/ora (in TZ)  — separatore ASCII, niente “•”
    const startAt = String(reservation?.start_at || '');
    const d = parseDbDate(startAt);
    await socketWrite(sock, line(formatTimeHHmm(startAt) + TIME_DATE_SEP + formatDateHuman(d)));

    // QR opzionale
    const base = (qrBaseUrl || QR_BASE_URL || '').replace(/\/+$/,'');
    if (!base) {
      logger.warn('🔳 QR skipped: base URL vuota (QR_BASE_URL o qrBaseUrl non impostati)');
    } else {
      const url = base + '/';
      logger.info('🔳 QR params', { mode: QR_MODE, size: QR_SIZE_ENV, scale: QR_SCALE, ecc: QR_ECC_ENV, url });

      const wantRaster = (QR_MODE === 'raster') || (QR_MODE === 'auto' && QRLib && PNGjs);
      let didRaster = false;

      if (wantRaster) didRaster = await tryPrintQrAsRaster(sock, url);

      if (!didRaster && QR_MODE !== 'raster') {
        // Provo ESC/POS model 2 (alcune stampanti non lo supportano)
        const seq = [
          cmdAlign(1),
          (QR_CAPTION_GAP > 0 ? cmdFeed(QR_CAPTION_GAP) : Buffer.alloc(0)),
          qrSelectModel2(),
          qrSetModuleSize(QR_SIZE_ENV),
          qrSetECCFromEnv(),
          qrStoreData(url),
          qrPrint(),
          cmdAlign(0),
          cmdLF(1),
        ];
        if (DEBUG_HEX) {
          const hex = Buffer.concat(seq).toString('hex').slice(0, 200);
          logger.info('🔬 QR bytes (head)', { hex });
        }
        for (const part of seq) await socketWrite(sock, part);
      }

      if (!didRaster && QR_MODE === 'raster') {
        // raster richiesto ma non disponibile
        logger.warn('🔳 QR raster non disponibile: installa "qrcode" (npm i qrcode)');
        await socketWrite(sock, line(url)); // almeno l’URL in chiaro
      } else if (didRaster) {
        await socketWrite(sock, cmdLF(1));
      }
    }

    if (BOTTOM_PAD_LINES > 0) await socketWrite(sock, cmdFeed(BOTTOM_PAD_LINES));
    return { jobId: `placecard-${reservation?.id || 'na'}-${Date.now()}` };
  });
}

// Rasterizza un QR usando la lib "qrcode" + stampa come immagine (ESC/POS raster).
async function tryPrintQrAsRaster(sock, url) {
  if (!QRLib || !PNGjs) return false;
  try {
    const eccMap = { L:'L', M:'M', Q:'Q', H:'H' };
    const ecc = eccMap[QR_ECC_ENV] || 'H';
    const pngBuf = await QRLib.toBuffer(url, {
      errorCorrectionLevel: ecc,
      margin: 0,
      scale: QR_SCALE, // dimensione modulare
      type: 'png',
    });
    const png = PNGjs.sync.read(pngBuf);
    const raster = buildRasterFromPNG(png, Math.floor(MAX_DOTS * 0.7), 160);
    await socketWrite(sock, cmdAlign(1));
    await socketWrite(sock, raster);
    await socketWrite(sock, cmdAlign(0));
    return true;
  } catch (e) {
    logger.warn('🔳 QR raster generation failed', { msg: String(e?.message || e) });
    return false;
  }
}

/* ─────────────────────────────── EXPORTS ─────────────────────────────── */

module.exports = {
  printDailyReservations,
  printPlaceCards,
  printSinglePlaceCard,
};
