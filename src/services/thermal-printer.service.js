// thermal-printer.service.js 
// Stampa termica: daily, placecards multipli e 🆕 singolo segnaposto.
// Mantengo lo stile e NON sovrascrivo la tua logica ordini: provo le API esistenti
// e, se mancano i metodi “placecard”, uso un fallback ESC/POS in solo testo
// (niente QR/immagini → evita caratteri “strani” su alcuni modelli).

'use strict';

const net    = require('net');
const env    = require('../env');
const logger = require('../logger');

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
  // oggetti tipo {date:'...'} ecc.
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

// ESC/POS minimal (solo testo)
const ESC = 0x1b, GS = 0x1d;
function cmdInit()         { return Buffer.from([ESC, 0x40]); }            // ESC @
function cmdAlign(n=0)     { return Buffer.from([ESC, 0x61, n]); }         // 0=left 1=center 2=right
function cmdMode(n=0)      { return Buffer.from([ESC, 0x21, n]); }         // testo scale/weight
function cmdLF(n=1)        { return Buffer.from(Array(n).fill(0x0a)); }
function cmdCut(full=true) { return Buffer.from([GS, 0x56, full ? 0x00 : 0x01]); }

function socketWrite(sock, chunk) {
  return new Promise((res, rej) => sock.write(chunk, (err) => err ? rej(err) : res()));
}
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

  try {
    await socketWrite(sock, cmdInit());
    if (env.PRINTER?.header || process.env.PRINTER_HEADER) {
      const lines = String(env.PRINTER?.header || process.env.PRINTER_HEADER).split('|');
      await socketWrite(sock, cmdAlign(1));
      for (const l of lines) { await socketWrite(sock, Buffer.from(l + '\n', 'ascii')); }
      await socketWrite(sock, cmdLF(1));
      await socketWrite(sock, cmdAlign(0));
    }
    const out = await fn(sock);
    if (env.PRINTER?.footer || process.env.PRINTER_FOOTER) {
      await socketWrite(sock, cmdLF(1));
      await socketWrite(sock, cmdAlign(1));
      const linesF = String(env.PRINTER?.footer || process.env.PRINTER_FOOTER).split('|');
      for (const l of linesF) { await socketWrite(sock, Buffer.from(l + '\n', 'ascii')); }
      await socketWrite(sock, cmdAlign(0));
    }
    const doCut = (env.PRINTER?.cut ?? String(process.env.PRINTER_CUT||'true').toLowerCase()==='true');
    if (doCut) { await socketWrite(sock, cmdLF(2)); await socketWrite(sock, cmdCut(true)); }
    sock.end();
    return out || { jobId:`job-${Date.now()}`, printedCount:0 };
  } catch (e) {
    try { sock.end(); } catch {}
    throw e;
  }
}

/* ─────────────── API “ufficiali” se già esistono nel tuo modulo ──────────── */

async function printDailyReservations(args) {
  // 1) Riuso metodo del modulo ordini se disponibile
  if (orderPrinter?.printDailyReservations) {
    return await orderPrinter.printDailyReservations(args);
  }
  // 2) Fallback ESC/POS “solo testo” (niente QR)
  const date = toYMD(args?.date);
  const rows = Array.isArray(args?.rows) ? args.rows : [];

  return await withPrinter({}, async (sock) => {
    await socketWrite(sock, cmdAlign(1));
    await socketWrite(sock, cmdMode(0x08)); // bold
    await socketWrite(sock, Buffer.from((process.env.BIZ_NAME || 'Prenotazioni') + '\n', 'ascii'));
    await socketWrite(sock, cmdMode(0x00));
    await socketWrite(sock, Buffer.from(`Prenotazioni ${date}\n`, 'ascii'));
    await socketWrite(sock, cmdAlign(0));
    await socketWrite(sock, cmdLF(1));

    let printed = 0;
    for (const r of rows) {
      const hhmm = timeHM(r.start_at);
      const name = (r.display_name || `${r.customer_first||''} ${r.customer_last||''}`).trim() || 'Cliente';
      const cov  = Number(r.party_size || r.covers || 0) || 1;
      const tav  = r.table_number ? `  Tav ${r.table_number}` : '';
      const line = `${hhmm}  ${name} (${cov})${tav}\n`;
      await socketWrite(sock, Buffer.from(line.replace(/[^\x20-\x7E]/g, '?'), 'ascii'));
      printed++;
    }
    await socketWrite(sock, cmdLF(1));
    return { jobId: `daily-${Date.now()}`, printedCount: printed };
  });
}

async function printPlaceCards(args) {
  // 1) Riuso metodo batch del modulo ordini se disponibile
  if (orderPrinter?.printPlaceCards) {
    return await orderPrinter.printPlaceCards(args);
  }
  // 2) Se esiste solo il “singolo”, vado in batch manuale
  if (orderPrinter?.printSinglePlaceCard || orderPrinter?.printPlacecardOne || orderPrinter?.printPlaceCardOne) {
    const rows = Array.isArray(args?.rows) ? args.rows : [];
    let count = 0;
    for (const r of rows) { await printSinglePlaceCard({ reservation: r, user: args?.user, logoText: args?.logoText, qrBaseUrl: args?.qrBaseUrl }); count++; }
    return { jobId: `placecards-${Date.now()}`, printedCount: count };
  }
  // 3) Fallback ESC/POS testuale: stampo 1 cartellino per riga
  const rows = Array.isArray(args?.rows) ? args.rows : [];
  let count = 0;
  for (const r of rows) { await printSinglePlaceCard({ reservation: r, user: args?.user, logoText: args?.logoText, qrBaseUrl: args?.qrBaseUrl }); count++; }
  return { jobId: `placecards-${Date.now()}`, printedCount: count };
}

/**
 * 🆕 singolo segnaposto (compat intelligente):
 * 1) orderPrinter.printSinglePlaceCard / printPlacecardOne / printPlaceCardOne  ✅ se esiste
 * 2) Fallback ESC/POS “solo testo”: nome grande centrato + coperti + tavolo   ✅ sempre
 */
async function printSinglePlaceCard({ reservation, user, logoText, qrBaseUrl }) {
  // 1) metodi nativi
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

  // 2) Fallback testuale (niente QR): compat universale
  const name = (reservation?.display_name || `${reservation?.customer_first||''} ${reservation?.customer_last||''}` || 'Cliente').trim();
  const cov  = Number(reservation?.party_size || reservation?.covers || 0) || 1;
  const tav  = reservation?.table_number ? `Tavolo ${reservation.table_number}` : (reservation?.table_name || '');

  return await withPrinter({}, async (sock) => {
    const topPad = Number(process.env.PRINTER_TOP_PAD_LINES || 2);
    const bottomPad = Number(process.env.PRINTER_BOTTOM_PAD_LINES || 4);

    await socketWrite(sock, cmdAlign(1));
    await socketWrite(sock, cmdLF(topPad));

    // Titolo grande
    await socketWrite(sock, cmdMode(0x20 /* doppia altezza */));
    await socketWrite(sock, Buffer.from((name || 'Cliente').substring(0, 24) + '\n', 'ascii'));
    await socketWrite(sock, cmdMode(0x00));

    // Coperti / Tavolo
    const sub = [`(${cov})`];
    if (tav) sub.push(tav);
    await socketWrite(sock, Buffer.from(sub.join('  ') + '\n', 'ascii'));

    await socketWrite(sock, cmdLF(bottomPad));
    return { jobId: `placecard-${reservation?.id || 'na'}-${Date.now()}` };
  });
}

module.exports = {
  printDailyReservations,
  printPlaceCards,
  printSinglePlaceCard,
};
