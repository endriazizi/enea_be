// src/services/gift-voucher-printer.service.js
// ============================================================================
// Stampa termica "Buono Regalo" (ESC/POS su TCP 9100)
// - Reuse pattern print (orders/print & thermal-printer)
// - Header/Footer da ENV, logo PNG opzionale
// - QR opzionale: usa QR_BASE_URL se presente, altrimenti stampa solo codice
// - Niente simbolo “€” (compat codepage) → uso "EUR"
// ============================================================================
// Stile: commenti lunghi in italiano + log con emoji.
// ============================================================================

'use strict';

const net    = require('net');
const fs     = require('fs');
const path   = require('path');
const logger = require('../logger');
const env    = require('../env');

let PNGjs;
try { ({ PNG: PNGjs } = require('pngjs')); } catch { PNGjs = null; }
let QRLib;
try { QRLib = require('qrcode'); } catch { QRLib = null; }

const ESC = 0x1b, GS = 0x1d;
const WIDTH_MM = Number(process.env.PRINTER_WIDTH_MM || 80);
const COLS = Number(process.env.PRINTER_COLS || (WIDTH_MM >= 70 ? 48 : 42));

const QR_BASE_URL = (process.env.QR_BASE_URL || '').trim();
const QR_SIZE_ENV = Number(process.env.PRINTER_QR_SIZE || 5);
const QR_ECC_ENV  = String(process.env.PRINTER_QR_ECC || 'H').toUpperCase();
const QR_MODE     = String(process.env.PRINTER_QR_MODE || 'raster').toLowerCase(); // auto|escpos|raster
const QR_SCALE    = Math.max(1, Math.min(12, Number(process.env.PRINTER_QR_SCALE || 4)));

const PRINT_TIMEOUT_MS = Math.max(1500, Number(process.env.PRINTER_TIMEOUT_MS || 6000));

function cmdInit()     { return Buffer.from([ESC, 0x40]); }
function cmdAlign(n=0) { return Buffer.from([ESC, 0x61, n]); }
function cmdMode(n=0)  { return Buffer.from([ESC, 0x21, n]); }
function cmdLF(n=1)    { return Buffer.from(Array(n).fill(0x0a)); }
function cmdCut()      { return Buffer.from([GS, 0x56, 0x00]); }
function cmdSize(w=1, h=1) {
  const W = Math.max(1, Math.min(8, w));
  const H = Math.max(1, Math.min(8, h));
  const v = ((W - 1) << 4) | (H - 1);
  return Buffer.from([GS, 0x21, v]);
}

function sanitizeForEscpos(s) {
  return String(s || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/€+/g, 'EUR')
    .replace(/\s+/g, ' ')
    .trim();
}

function line(s='') {
  return Buffer.concat([Buffer.from(sanitizeForEscpos(s), 'latin1'), Buffer.from([0x0a])]);
}

function wrapText(s, maxCols = COLS) {
  const text = sanitizeForEscpos(s);
  if (!text) return [];
  const words = text.split(' ');
  const out = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length <= maxCols) cur = cand;
    else { if (cur) out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

function formatDateIt(isoLike) {
  try {
    const d = isoLike ? new Date(isoLike) : new Date();
    if (Number.isNaN(d.getTime())) return String(isoLike || '');
    return new Intl.DateTimeFormat('it-IT', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return String(isoLike || '');
  }
}

function readHeaderLines() {
  const raw = env.PRINTER?.header ?? process.env.PRINTER_HEADER ?? '';
  return String(raw).split('|').filter(Boolean);
}
function readFooterLines() {
  const raw = env.PRINTER?.footer ?? process.env.PRINTER_FOOTER ?? '';
  return String(raw).split('|').filter(Boolean);
}

// ─────────────────────────── LOGO PNG (opzionale) ───────────────────────────
const MAX_DOTS = WIDTH_MM >= 70 ? 576 : 384;
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
      if (gray < threshold) bmp[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
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
      logger.info(`🖼️ [GiftVoucher] Logo caricato: ${abs}`);
    }
  } catch (e) {
    logger.warn('🖼️ [GiftVoucher] Logo PNG non caricabile', { msg: String(e?.message || e) });
  }
})();

// ────────────────────────────── QR ESC/POS ─────────────────────────────────
function qrSelectModel2() { return Buffer.from([GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]); }
function qrStoreData(data) {
  const payload = Buffer.from(String(data || ''), 'ascii');
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

async function tryPrintQrAsRaster(sock, url) {
  if (!QRLib || !PNGjs) return false;
  try {
    const eccMap = { L:'L', M:'M', Q:'Q', H:'H' };
    const ecc = eccMap[QR_ECC_ENV] || 'H';
    const pngBuf = await QRLib.toBuffer(url, {
      errorCorrectionLevel: ecc,
      margin: 0,
      scale: QR_SCALE,
      type: 'png',
    });
    const png = PNGjs.sync.read(pngBuf);
    const raster = buildRasterFromPNG(png, Math.floor(MAX_DOTS * 0.7), 160);
    sock.write(cmdAlign(1));
    sock.write(raster);
    sock.write(cmdAlign(0));
    return true;
  } catch (e) {
    logger.warn('🔳 [GiftVoucher] QR raster failed', { msg: String(e?.message || e) });
    return false;
  }
}

function buildQrText(code) {
  const base = (QR_BASE_URL || '').replace(/\/+$/,'');
  if (!base) return String(code || '').trim();
  const q = new URLSearchParams({
    code: String(code || '').trim(),
    utm_source: 'gift_voucher_qr',
    utm_medium: 'qr',
    utm_campaign: 'gift_voucher',
  });
  return `${base}/voucher?${q.toString()}`;
}

function openSocket() {
  const ip   = env.PRINTER?.ip || process.env.PRINTER_IP;
  const port = Number(env.PRINTER?.port || process.env.PRINTER_PORT || 9100);
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    const timer = setTimeout(() => {
      try { sock.destroy(); } catch {}
      reject(new Error('printer_timeout'));
    }, PRINT_TIMEOUT_MS);
    sock.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    sock.connect(port, ip, () => {
      clearTimeout(timer);
      resolve({ sock, ip, port });
    });
  });
}

async function withPrinter(fn) {
  if (!env.PRINTER?.enabled && String(process.env.PRINTER_ENABLED).toLowerCase() !== 'true') {
    logger.warn('🖨️ [GiftVoucher] PRINTER disabled (no-op)');
    return { jobId: `noop-${Date.now()}`, printedCount: 0, printer: null };
  }
  const { sock, ip, port } = await openSocket();
  try {
    sock.write(cmdInit());

    const headerLines = readHeaderLines();
    if (headerLines.length) {
      sock.write(cmdAlign(1));
      for (const h of headerLines) sock.write(line(h));
      sock.write(cmdLF(1));
      sock.write(cmdAlign(0));
    }

    const out = await fn(sock);

    const footerLines = readFooterLines();
    if (footerLines.length) {
      sock.write(cmdLF(1));
      sock.write(cmdAlign(1));
      for (const f of footerLines) sock.write(line(f));
      sock.write(cmdAlign(0));
    }

    sock.write(cmdLF(2));
    sock.write(cmdCut());
    sock.end();
    return { ...(out || {}), printer: { ip, port } };
  } catch (e) {
    try { sock.end(); } catch {}
    throw e;
  }
}

async function printGiftVoucherSlip({ voucher, qrText }) {
  const v = voucher || {};
  const code = String(v.code || '').trim();
  const valueEUR = (Number(v.value_cents || 0) / 100).toFixed(2);
  const eventTitle = v.event_title || '—';
  const desc = v.description || '';
  const validUntil = v.valid_until ? formatDateIt(v.valid_until) : '';

  return await withPrinter(async (sock) => {
    // Logo (opzionale) centrato
    if (LOGO_RASTER) sock.write(LOGO_RASTER);

    // Titolo (leggermente più grande)
    sock.write(cmdAlign(1));
    sock.write(cmdMode(0x08));
    sock.write(cmdSize(2, 3));
    sock.write(line('BUONO REGALO'));
    sock.write(cmdSize(1, 1));
    sock.write(cmdMode(0x00));
    sock.write(cmdAlign(0));

    sock.write(line('-'.repeat(COLS)));
    sock.write(line(`Valore: ${valueEUR} EUR`));
    sock.write(line(`Evento: ${eventTitle}`));
    sock.write(line(''));

    if (desc) {
      const wrapped = wrapText(`Descrizione: ${desc}`, COLS);
      for (const ln of wrapped) sock.write(line(ln));
    }

    sock.write(line(`Codice: ${code || '-'}`));
    if (validUntil) sock.write(line(`Valido fino al: ${validUntil}`));
    sock.write(line('-'.repeat(COLS)));

    // QR (best-effort) → se fallisce, stampo il codice grande
    if (qrText) {
      // Un po' di spazio prima del QR per evitare tagli
      sock.write(cmdLF(1));
      let printedQr = false;
      const wantRaster = (QR_MODE === 'raster') || (QR_MODE === 'auto' && QRLib && PNGjs);
      if (wantRaster) printedQr = await tryPrintQrAsRaster(sock, qrText);

      if (!printedQr && QR_MODE !== 'raster') {
        try {
          const seq = [
            cmdAlign(1),
            qrSelectModel2(),
            qrSetModuleSize(QR_SIZE_ENV),
            qrSetECCFromEnv(),
            qrStoreData(qrText),
            qrPrint(),
            cmdAlign(0),
            cmdLF(1),
          ];
          for (const part of seq) sock.write(part);
          printedQr = true;
        } catch {
          printedQr = false;
        }
      }

      if (!printedQr) {
        sock.write(cmdAlign(1));
        sock.write(cmdMode(0x08));
        sock.write(cmdSize(2, 2));
        sock.write(line(code || '-'));
        sock.write(cmdSize(1, 1));
        sock.write(cmdMode(0x00));
        sock.write(cmdAlign(0));
      }
      // Un po' di spazio dopo il QR
      sock.write(cmdLF(1));
    }

    // Footer statico brand (come da richiesta)
    sock.write(cmdAlign(1));
    sock.write(line('Largo della Liberta 4'));
    sock.write(line('62022, Castelraimondo (MC)'));
    sock.write(line('Tel. 0737642142'));
    sock.write(cmdAlign(0));
    return { jobId: `gift-${v.id || 'na'}-${Date.now()}`, printedCount: 1 };
  });
}

module.exports = {
  printGiftVoucherSlip,
  buildQrText,
};
