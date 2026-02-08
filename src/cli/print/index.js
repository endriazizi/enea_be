#!/usr/bin/env node
// src/cli/print/index.js
// ============================================================================
// CLI stampa termica: test reale su TCP 9100 (kitchen | receipt | conto | fonts)
// Usa ENV (.env) — non tocca API runtime. Invia a chunk + throttle per stabilità.
// Stile: commenti ITA, log emoji, fallback best-effort.
// ============================================================================

'use strict';

const path = require('path');
const net = require('net');

// Carica .env dalla root del progetto (dove sta package.json)
try {
  require('dotenv').config({ path: path.join(process.cwd(), '.env') });
} catch (_) { /* dotenv opzionale */ }

// --- Config da ENV (CLI usa ENV, non DB) ------------------------------------
const PRINTER_IP = process.env.PRINTER_IP || process.env.PRINTER_HOST || '127.0.0.1';
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
const PRINTER_COLS = Number(process.env.PRINTER_COLS || (Number(process.env.PRINTER_WIDTH_MM || 80) >= 70 ? 48 : 42));
const CHUNK_SIZE = Number(process.env.PRINTER_CHUNK_SIZE || 2048);
const THROTTLE_MS = Number(process.env.PRINTER_THROTTLE_MS || 10);
const CODEPAGE = (process.env.PRINTER_CODEPAGE || 'cp858').toLowerCase();
const KITCHEN_SHOW_PHONE = String(process.env.KITCHEN_SHOW_PHONE || 'true').toLowerCase() === 'true';
const KITCHEN_SHOW_NOTES = String(process.env.KITCHEN_SHOW_NOTES || 'true').toLowerCase() === 'true';
const KITCHEN_SHOW_TABLE = String(process.env.KITCHEN_SHOW_TABLE || 'true').toLowerCase() === 'true';

// --- ESC/POS helpers --------------------------------------------------------
const ESC = 0x1b, GS = 0x1d;
function cmdInit() { return Buffer.from([ESC, 0x40]); }
function cmdAlign(n = 0) { return Buffer.from([ESC, 0x61, n]); }
function cmdMode(n = 0) { return Buffer.from([ESC, 0x21, n]); }
function cmdSize(w = 1, h = 1) {
  const W = Math.max(1, Math.min(8, w));
  const H = Math.max(1, Math.min(8, h));
  return Buffer.from([GS, 0x21, ((W - 1) << 4) | (H - 1)]);
}
function cmdCut() { return Buffer.from([GS, 0x56, 0x00]); }
function cmdLF(n = 1) { return Buffer.from(Array(n).fill(0x0a)); }
function cmdFeed(n = 0) { return Buffer.from([ESC, 0x64, Math.max(0, Math.min(255, n))]); }

function selectCodepage() {
  const map = { cp437: 0, cp850: 2, cp852: 18, cp858: 19, cp1252: 16 };
  const n = map[CODEPAGE] ?? 19;
  return Buffer.from([ESC, 0x74, n]);
}

let iconv;
try { iconv = require('iconv-lite'); } catch { iconv = null; }
function encodeText(s) {
  const plain = String(s || '').replace(/\r/g, '').replace(/€/g, 'EUR');
  if (!iconv) return Buffer.from(plain, 'latin1');
  try { return iconv.encode(plain, CODEPAGE, { addBOM: false }); }
  catch { return Buffer.from(plain, 'latin1'); }
}
function line(s = '') { return Buffer.concat([encodeText(s), Buffer.from([0x0a])]); }

// --- Invio a chunk + throttle ------------------------------------------------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendToPrinter(data) {
  const sock = new net.Socket();
  await new Promise((res, rej) => {
    sock.once('error', rej);
    sock.connect(PRINTER_PORT, PRINTER_IP, () => { sock.off('error', rej); res(); });
  });

  const buf = Buffer.isBuffer(data) ? data : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]);
  const chunks = [];
  for (let i = 0; i < buf.length; i += CHUNK_SIZE) {
    chunks.push(buf.slice(i, i + CHUNK_SIZE));
  }
  for (let i = 0; i < chunks.length; i++) {
    await new Promise((res, rej) => sock.write(chunks[i], err => err ? rej(err) : res()));
    if (THROTTLE_MS > 0) await sleep(THROTTLE_MS);
  }
  sock.end();
}

// --- Checklist diagnostica (in caso di errore) -------------------------------
function printChecklist(err) {
  console.error('\n❌ 🖨️ CLI PRINT FAILED');
  console.error('   Errore:', String(err?.message || err));
  console.error('\n📋 Checklist diagnostica:');
  console.error('   [ ] PRINTER_IP / PRINTER_HOST:', PRINTER_IP);
  console.error('   [ ] PRINTER_PORT:', PRINTER_PORT);
  console.error('   [ ] Stampante accesa e collegata alla rete?');
  console.error('   [ ] Firewall permette TCP sulla porta', PRINTER_PORT, '?');
  console.error('   [ ] ping', PRINTER_IP, 'va a buon fine?');
  console.error('   [ ] .env presente nella root del progetto?');
  console.error('   [ ] PRINTER_ENABLED=true (se usato dalla CLI)?');
  console.error('\n');
}

// --- Layout: FONTS (test dimensioni/stili) -----------------------------------
function buildFontsBuffer() {
  const parts = [
    cmdInit(),
    selectCodepage(),
    cmdAlign(1),
    line(''),
    line('=== TEST FONT/STILI ==='),
    line(''),
    cmdAlign(0),
    line('Normale 1x1: ABC abc 012'),
    cmdMode(0x08),
    line('Bold: ABC abc 012'),
    cmdMode(0x00),
    cmdSize(2, 1),
    line('2x altezza: ABC abc'),
    cmdSize(1, 2),
    line('2x larghezza: ABC'),
    cmdSize(1, 1),
    line('Ritorno 1x1'),
    line('-'.repeat(Math.min(PRINTER_COLS, 48))),
    cmdSize(2, 2),
    line('2x2 GRANDE'),
    cmdSize(1, 1),
    line('-'.repeat(Math.min(PRINTER_COLS, 48))),
    cmdSize(3, 3),
    line('3x3'),
    cmdSize(1, 1),
    line(''),
    line('EUR 12.50 (no simbolo)'),
    line(''),
    cmdAlign(1),
    line('Centrato OK'),
    cmdAlign(0),
    cmdLF(2),
    cmdCut(),
  ];
  return Buffer.concat(parts);
}

// --- Layout: KITCHEN (slip cucina demo) --------------------------------------
function buildKitchenBuffer() {
  const sep = '-'.repeat(Math.min(PRINTER_COLS, 48));
  const parts = [
    cmdInit(),
    selectCodepage(),
    cmdAlign(1),
    cmdSize(2, 2),
    line('CUCINA'),
    cmdSize(1, 1),
    line(''),
    cmdAlign(0),
    line(sep),
    line('#42  Cliente Demo'),
  ];
  if (KITCHEN_SHOW_PHONE) parts.push(line('Tel: 333 1234567'));
  if (KITCHEN_SHOW_TABLE) parts.push(line('Sala Principale  Tavolo 5'));
  parts.push(line(sep));

  // Categorie
  const cats = [
    { name: 'PIZZE ROSSE', items: ['2x Margherita', '1x Diavola'] },
    { name: 'PIZZE BIANCHE', items: ['1x Quattro formaggi'] },
    { name: 'ANTIPASTI', items: ['2x Bruschetta'] },
  ];
  for (const cat of cats) {
    parts.push(line(''));
    parts.push(cmdMode(0x08), cmdSize(2, 1), line(cat.name), cmdSize(1, 1), cmdMode(0x00));
    parts.push(line(sep));
    for (const it of cat.items) {
      parts.push(line(it));
      if (KITCHEN_SHOW_NOTES) parts.push(line('  NOTE: SENZA cipolla'));
    }
  }
  parts.push(line(sep));
  parts.push(cmdAlign(1), line('TOTALE: 24.50'), cmdAlign(0));
  parts.push(line(''));
  parts.push(line('COMANDA CLI TEST'));
  parts.push(cmdLF(2), cmdCut());
  return Buffer.concat(parts);
}

// --- Layout: RECEIPT (scontrino semplice) -----------------------------------
function buildReceiptBuffer() {
  const sep = '-'.repeat(Math.min(PRINTER_COLS, 48));
  const parts = [
    cmdInit(),
    selectCodepage(),
    cmdAlign(1),
    line('PIZZERIA LA LANTERNA'),
    line(''),
    cmdAlign(0),
    line(sep),
    line('Ordine #99'),
    line('Data: 07/02/2025 12:30'),
    line(sep),
    line('2x Margherita         EUR 14.00'),
    line('1x Coca Cola 33cl     EUR 3.00'),
    line('1x Tiramisu           EUR 5.00'),
    line(sep),
    line('TOTALE                EUR 22.00'),
    line(''),
    line('Grazie e arrivederci!'),
    line(''),
    cmdLF(2),
    cmdCut(),
  ];
  return Buffer.concat(parts);
}

// --- Layout: CONTO (preconto tavolo) ----------------------------------------
function buildContoBuffer() {
  const sep = '-'.repeat(Math.min(PRINTER_COLS, 48));
  const parts = [
    cmdInit(),
    selectCodepage(),
    cmdAlign(1),
    cmdSize(2, 2),
    line('PRECONTO'),
    cmdSize(1, 1),
    line(''),
    cmdAlign(0),
    line(sep),
    line('Tavolo 7 - Sala Principale'),
    line('4 coperti'),
    line(sep),
    line('2x Margherita         EUR 14.00'),
    line('2x Pizza al tonno     EUR 18.00'),
    line('4x Acqua 1L           EUR 8.00'),
    line('2x Vino rosso         EUR 12.00'),
    line(sep),
    line('Subtotale             EUR 52.00'),
    line('Servizio 10%           EUR 5.20'),
    line(sep),
    cmdMode(0x08),
    line('TOTALE                EUR 57.20'),
    cmdMode(0x00),
    line(''),
    line('La preghiamo di passare in cassa'),
    line(''),
    cmdLF(2),
    cmdCut(),
  ];
  return Buffer.concat(parts);
}

// --- Main --------------------------------------------------------------------
async function main() {
  const mode = (process.argv[2] || 'fonts').toLowerCase().trim();
  const valid = ['kitchen', 'receipt', 'conto', 'fonts'];
  if (!valid.includes(mode)) {
    console.error('⚠️ Uso: node src/cli/print/index.js <kitchen|receipt|conto|fonts>');
    console.error('   Argomento ricevuto:', mode || '(vuoto)');
    process.exit(1);
  }

  console.log(`🖨️ CLI print:${mode}`);
  console.log(`   IP:porta = ${PRINTER_IP}:${PRINTER_PORT}`);
  console.log(`   Chunk: ${CHUNK_SIZE}  Throttle: ${THROTTLE_MS}ms`);
  console.log(`   Layout: ${mode}`);

  let buf;
  switch (mode) {
    case 'kitchen': buf = buildKitchenBuffer(); break;
    case 'receipt': buf = buildReceiptBuffer(); break;
    case 'conto': buf = buildContoBuffer(); break;
    default: buf = buildFontsBuffer();
  }

  try {
    await sendToPrinter(buf);
    console.log('🖨️🟢 OK stampa completata');
    process.exit(0);
  } catch (err) {
    printChecklist(err);
    process.exit(1);
  }
}

main();
