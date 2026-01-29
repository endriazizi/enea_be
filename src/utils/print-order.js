// src/utils/print-order.js
// ============================================================================
// Stampa ESC/POS “Pizzeria/Cucina”. NIENTE simbolo € (codepage problemi).
// - legge env PRINTER_* e mapping categorie PIZZERIA_CATEGORIES / KITCHEN_CATEGORIES
// - se PRINTER_ENABLED=false → no-op (non blocca i flussi)
// - 🆕 per COMANDA (centro produzione): font più grande + bold, cliente/tavolo/sala evidenti,
//   raggruppamento per categoria (ANTIPASTI → PIZZE ROSSE → PIZZE BIANCHE → altre)
//   + spaziatura maggiore e wrapping note (leggibile per dislessia)
//   + prezzi per riga (in piccolo) e totale finale (senza simbolo €)
//   + orario “DOMENICA 10/11/2025  ore 04:42”
// ============================================================================
// Nota: manteniamo lo stile verboso con emoji nei log, come da progetto.
// ============================================================================

'use strict';

const net = require('net');
const logger = require('../logger');

const {
  PRINTER_ENABLED = 'true',
  PRINTER_IP = '127.0.0.1',
  PRINTER_PORT = '9100',
  PRINTER_CUT = 'true',
  PRINTER_HEADER = '',
  PRINTER_FOOTER = '',
  PRINTER_WIDTH_MM = '80',
  // mapping reparti
  PIZZERIA_CATEGORIES = 'PIZZE,PIZZE ROSSE,PIZZE BIANCHE',
  KITCHEN_CATEGORIES = 'ANTIPASTI,FRITTI,BEVANDE',
} = process.env;

function esc(...codes) { return Buffer.from(codes); }

// --- ESC/POS helpers (dimensioni/bold/alignment/spacing/font/codepage) ------
function init(sock) { sock.write(esc(0x1B,0x40)); }                    // ESC @
function alignLeft(sock){ sock.write(esc(0x1B,0x61,0x00)); }           // ESC a 0
function alignCenter(sock){ sock.write(esc(0x1B,0x61,0x01)); }         // ESC a 1
function boldOn(sock){ sock.write(esc(0x1B,0x45,0x01)); }              // ESC E 1
function boldOff(sock){ sock.write(esc(0x1B,0x45,0x00)); }             // ESC E 0
function sizeNormal(sock){ sock.write(esc(0x1D,0x21,0x00)); }          // GS ! 0 (1x)
function sizeTall(sock){ sock.write(esc(0x1D,0x21,0x01)); }            // GS ! 1 (2x altezza)
function sizeBig(sock){ sock.write(esc(0x1D,0x21,0x11)); }             // GS ! 17 (2x larghezza+altezza)
function fontA(sock){ sock.write(esc(0x1B,0x4D,0x00)); }               // ESC M 0 → Font A (leggibile)
function charSpacing(sock, n){ sock.write(esc(0x1B,0x20, Math.max(0,Math.min(255,n)))); } // ESC SP n
function setLineSpacing(sock, n){ sock.write(esc(0x1B,0x33, Math.max(0,Math.min(255,n)))); } // ESC 3 n
function resetLineSpacing(sock){ sock.write(esc(0x1B,0x32)); }         // ESC 2 (default)
function feedLines(sock, n){ sock.write(esc(0x1B,0x64, Math.max(0,Math.min(255,n)))); }     // ESC d n
function cutIfEnabled(sock){ if (PRINTER_CUT === 'true') sock.write(esc(0x1D,0x56,0x42,0x00)); } // GS V B n
function codepageCP1252(sock){ try{ sock.write(esc(0x1B,0x74,0x10)); }catch{} } // ESC t 16 → CP1252 (tipico Epson)

// --- Scrittura linea con sanificazione (accenti/apici/dash) -----------------
function sanitizeForEscpos(s) {
  return String(s || '')
    // apici/virgolette tipografiche → ASCII
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // em/en dash → trattino semplice
    .replace(/[\u2013\u2014]/g, '-')
    // simbolo euro → testuale
    .replace(/€+/g, 'EUR')
    // spazi multipli → singolo
    .replace(/\s+/g, ' ')
    .trim();
}
function writeLine(sock, s) {
  const line = sanitizeForEscpos(s) + '\n';
  // molti ESC/POS accettano latin1; con CP1252 selezionata gli accenti IT vanno ok
  sock.write(Buffer.from(line, 'latin1'));
}

// --- Layout/Wrap COMANDA -----------------------------------------------------
const COMANDA_MAX_COLS = 42;        // stima sicura per 80mm con Font A
const COMANDA_LINE_SP  = 48;        // spaziatura righe “larga” per leggibilità

function wrapText(s, max = COMANDA_MAX_COLS) {
  const text = sanitizeForEscpos(s);
  if (!text) return [];
  const words = text.split(' ');
  const out = []; let cur = '';
  for (const w of words) {
    const candidate = cur ? cur + ' ' + w : w;
    if (candidate.length <= max) cur = candidate;
    else { if (cur) out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

function qtyStr(q) { return String(Math.max(1, Number(q) || 1)).padStart(2,' '); }
function money(n){ return Number(n || 0).toFixed(2); }

// ----------------------------------------------------------------------------
function openSocket() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(
      { host: PRINTER_IP, port: Number(PRINTER_PORT || 9100) },
      () => resolve(socket)
    );
    socket.on('error', reject);
  });
}

function splitByDept(items) {
  const piz = new Set(PIZZERIA_CATEGORIES.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  const kit = new Set(KITCHEN_CATEGORIES.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));

  const pizzeria = [];
  const kitchen  = [];
  for (const it of items) {
    const cat = (it.category || 'Altro').toString().toUpperCase();
    if (piz.has(cat)) pizzeria.push(it);
    else if (kit.has(cat)) kitchen.push(it);
    else pizzeria.push(it); // default
  }
  return { pizzeria, kitchen };
}

// --- Ordinamento categorie per COMANDA (centro produzione) -------------------
const COMANDA_CATEGORY_ORDER = [
  'ANTIPASTI',
  'PIZZE ROSSE',
  'PIZZE BIANCHE',
];
function categoryRank(name) {
  const up = (name || 'Altro').toString().toUpperCase().trim();
  const idx = COMANDA_CATEGORY_ORDER.indexOf(up);
  return idx === -1 ? 100 + up.charCodeAt(0) : idx; // sconosciute dopo, ma stabili
}

// --- Estrai "Sala ..." e "Tavolo ..." ---------------------------------------
function extractTableLabel(order) {
  const direct = order.table_name || order.table_number || order.table_label || order.table_id;
  if (direct) return `Tavolo ${direct}`;
  const note = (order.note || '').toString();
  const m = note.match(/Tavolo\s+([A-Za-z0-9\-_]+)/i);
  return m ? `Tavolo ${m[1]}` : null;
}
function extractRoomLabel(order) {
  const direct = order.room_name || order.room_label || order.room;
  if (direct) return `Sala ${direct}`;
  if (order.room_id) return `Sala ${order.room_id}`;
  return null;
}

// --- Modalità ordine (fulfillment) -------------------------------------------
function resolveFulfillment(order) {
  const v = (order.fulfillment || '').toString().trim().toLowerCase();
  if (v === 'table' || v === 'takeaway' || v === 'delivery') return v;
  // Fallback compat: se ho table_id considero "table", altrimenti "takeaway".
  return order.table_id ? 'table' : 'takeaway';
}

function extractDeliveryAddressLine(order) {
  const addr = order.delivery_address || order.deliveryAddress || null;
  if (addr) return String(addr).trim();
  // Fallback minimo: provo ad usare note o telefono se mancano i campi dedicati.
  const note = order.delivery_note || order.note || null;
  if (note) return String(note).trim();
  const phone = order.delivery_phone || order.phone || null;
  if (phone) return `Tel: ${String(phone).trim()}`;
  return null;
}

// --- Formattazione orario stile “DOMENICA 10/11/2025  ore 04:42” -------------
function fmtComandaDate(iso) {
  try{
    const d = iso ? new Date(iso) : new Date();
    const gg = d.toLocaleDateString('it-IT', { weekday: 'long' }).toUpperCase();
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2,'0');
    const mn = String(d.getMinutes()).padStart(2,'0');
    return `${gg} ${dd}/${mm}/${yy}  ore ${hh}:${mn}`;
  }catch{ return String(iso || ''); }
}

// --- Stampa standard (CONTO) -------------------------------------------------
async function printSlip(title, order) {
  const sock = await openSocket();
  const write = (buf) => sock.write(buf);

  init(sock);
  // Titolo alto (come prima)
  write(esc(0x1B,0x21,0x20));       // double height (compat classic)
  write(Buffer.from(String(title)+'\n','latin1'));
  write(esc(0x1B,0x21,0x00));       // normal

  const headerLines = (PRINTER_HEADER || '').split('|').filter(Boolean);
  for (const h of headerLines) write(Buffer.from(sanitizeForEscpos(h)+'\n','latin1'));

  write(Buffer.from('------------------------------\n','latin1'));
  write(Buffer.from(`#${order.id}  ${sanitizeForEscpos(order.customer_name)}\n`,'latin1'));
  if (order.phone) write(Buffer.from(`${sanitizeForEscpos(order.phone)}\n`,'latin1'));
  if (order.people) write(Buffer.from(`Coperti: ${order.people}\n`,'latin1'));
  if (order.scheduled_at) write(Buffer.from(`Orario: ${fmtComandaDate(order.scheduled_at)}\n`,'latin1'));
  // Modalità ordine (senza cambiare le logiche esistenti: aggiungo solo righe info)
  const fulfillment = resolveFulfillment(order);
  if (fulfillment === 'table') {
    const room = extractRoomLabel(order);
    const table = extractTableLabel(order);
    if (room)  write(Buffer.from(`${sanitizeForEscpos(room)}\n`, 'latin1'));
    if (table) write(Buffer.from(`${sanitizeForEscpos(table)}\n`, 'latin1'));
  } else if (fulfillment === 'takeaway') {
    write(Buffer.from('ASPORTO\n', 'latin1'));
  } else if (fulfillment === 'delivery') {
    write(Buffer.from('DOMICILIO\n', 'latin1'));
    const line = extractDeliveryAddressLine(order);
    if (line) write(Buffer.from(`${sanitizeForEscpos(line)}\n`, 'latin1'));
  }
  write(Buffer.from('------------------------------\n','latin1'));

  for (const it of order.items) {
    write(Buffer.from(`${it.qty} x ${sanitizeForEscpos(it.name)}  ${money(it.price)}\n`,'latin1'));
    if (it.notes) write(Buffer.from(`  NOTE: ${sanitizeForEscpos(it.notes)}\n`,'latin1'));
  }

  write(Buffer.from('------------------------------\n','latin1'));
  write(Buffer.from(`Totale: ${money(order.total || 0)}\n`,'latin1'));
  if (PRINTER_FOOTER) {
    write(Buffer.from('\n','latin1'));
    for (const f of (PRINTER_FOOTER || '').split('|')) write(Buffer.from(sanitizeForEscpos(f)+'\n','latin1'));
  }
  write(Buffer.from('\n','latin1'));
  cutIfEnabled(sock);
  sock.end();
}

// --- Normalizzazione NOTE prodotto → “SENZA: …\nAGGIUNGI: …” -----------------
function normalizeNotesForKitchen(raw) {
  if (!raw) return null;
  let s = String(raw);
  // separatore “—” → newline; EXTRA → AGGIUNGI
  s = s.replace(/—/g, '\n'); // em-dash → newline
  s = s.replace(/\bEXTRA:/gi, 'AGGIUNGI:');
  // se qualcuno scrive “SENZA: … AGGIUNGI: …” su 1 sola riga con trattini → forza newline
  s = s.replace(/\s*[-–—]\s*AGGIUNGI:/gi, '\nAGGIUNGI:');
  // pulizia
  s = sanitizeForEscpos(s);
  return s;
}

// --- Stampa COMANDA (centro produzione) — font grande/bold + spacing ---------
async function printComandaSlip(title, order) {
  const sock = await openSocket();

  // init + set leggibilità (Font A, spaziatura righe, leggera spaziatura caratteri, codepage)
  init(sock);
  codepageCP1252(sock);
  fontA(sock);
  setLineSpacing(sock, COMANDA_LINE_SP);
  charSpacing(sock, 1);

  // Intestazione centrale
  alignCenter(sock);
  sizeBig(sock); boldOn(sock); writeLine(sock, title); boldOff(sock);

  const client = (order.customer_name || 'Cliente').toString().trim();
  sizeBig(sock); boldOn(sock); writeLine(sock, client); boldOff(sock);

  const room = extractRoomLabel(order);
  const table = extractTableLabel(order);
  if (room) { sizeBig(sock); boldOn(sock); writeLine(sock, room); boldOff(sock); }
  if (table){ sizeBig(sock); boldOn(sock); writeLine(sock, table); boldOff(sock); }

  // Modalità ordine: per asporto/domicilio aggiungo una riga grande e leggibile
  const fulfillment = resolveFulfillment(order);
  if (fulfillment === 'takeaway') {
    sizeBig(sock); boldOn(sock); writeLine(sock, 'ASPORTO'); boldOff(sock);
  } else if (fulfillment === 'delivery') {
    sizeBig(sock); boldOn(sock); writeLine(sock, 'DOMICILIO'); boldOff(sock);
    const line = extractDeliveryAddressLine(order);
    if (line) {
      const lines = wrapText(line, COMANDA_MAX_COLS);
      for (const ln of lines) writeLine(sock, ln);
    }
  }

  // Sub-intestazione compatta
  sizeNormal(sock);
  writeLine(sock, '==============================');
  alignLeft(sock);
  writeLine(sock, `#${order.id}`);
  if (order.people) writeLine(sock, `Coperti: ${order.people}`);
  if (order.scheduled_at) writeLine(sock, `Orario: ${fmtComandaDate(order.scheduled_at)}`);
  if (order.phone) writeLine(sock, `Tel: ${order.phone}`);
  if (order.note) {
    const nlines = wrapText(`Note: ${order.note}`, COMANDA_MAX_COLS);
    for (const ln of nlines) writeLine(sock, ln);
  }
  writeLine(sock, '------------------------------');

  // Raggruppa per categoria con ordinamento desiderato
  const groups = new Map(); // cat -> items[]
  for (const it of (order.items || [])) {
    const cat = (it.category || 'Altro').toString();
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(it);
  }
  const categories = Array.from(groups.keys()).sort((a,b) => {
    const ra = categoryRank(a), rb = categoryRank(b);
    return ra === rb ? a.localeCompare(b, 'it') : ra - rb;
  });

  // Stampa per categoria
  let grand = 0;
  for (const cat of categories) {
    const list = groups.get(cat) || [];

    // Header categoria in bold (un pelo più grande)
    writeLine(sock, ''); // riga vuota
    boldOn(sock); sizeTall(sock); writeLine(sock, cat.toUpperCase()); boldOff(sock); sizeNormal(sock);
    writeLine(sock, '------------------------------');

    // Prodotto: qty ben visibile + nome in bold (UPPER), con spaziatura verticale extra
    for (const it of list) {
      const qty = Math.max(1, Number(it.qty) || 1);
      const qtyTxt = qtyStr(qty);
      const name = (it.name || '').toString().trim().toUpperCase();

      // Riga principale (grande)
      boldOn(sock); sizeTall(sock);
      writeLine(sock, `${qtyTxt} x ${name}`);
      boldOff(sock); sizeNormal(sock);

      // NOTE (normalizzate: SENZA → newline → AGGIUNGI)
      if (it.notes) {
        const norm = normalizeNotesForKitchen(it.notes);
        const lines = wrapText(`NOTE: ${norm}`, COMANDA_MAX_COLS);
        boldOn(sock);
        for (const ln of lines) writeLine(sock, '  ' + ln);
        boldOff(sock);
      }

      // Prezzi in piccolo (unitario e totale riga)
      const unit = Number(it.price || 0);
      const rowTot = unit * qty;
      if (unit > 0) {
        writeLine(sock, `  prezzo: ${money(unit)}  •  riga: ${money(rowTot)}`);
      }
      grand += rowTot;

      // aria tra righe prodotto
      feedLines(sock, 1);
    }
  }

  // Totale COMANDA (solo numerico, niente €)
  alignCenter(sock);
  writeLine(sock, '==============================');
  boldOn(sock); writeLine(sock, `TOTALE: ${money(grand)}`); boldOff(sock);

  // Footer tecnico + reset spacing + taglio
  writeLine(sock, '');
  writeLine(sock, 'COMANDA');
  writeLine(sock, '');

  resetLineSpacing(sock);
  charSpacing(sock, 0);
  cutIfEnabled(sock);
  sock.end();
}

async function printOrderDual(orderFull) {
  if (PRINTER_ENABLED !== 'true') {
    logger.warn('🖨️  PRINT disabled (PRINTER_ENABLED=false)');
    return;
  }
  const { pizzeria, kitchen } = splitByDept(orderFull.items || []);
  const head = {
    id: orderFull.id,
    customer_name: orderFull.customer_name,
    phone: orderFull.phone,
    people: orderFull.people,
    scheduled_at: orderFull.scheduled_at,
    total: orderFull.total,
    note: orderFull.note,                 // per eventuale 'Tavolo ...'
    fulfillment: orderFull.fulfillment,
    delivery_name: orderFull.delivery_name,
    delivery_phone: orderFull.delivery_phone,
    delivery_address: orderFull.delivery_address,
    delivery_note: orderFull.delivery_note,
    table_name: orderFull.table_name,     // se forniti dal chiamante
    table_number: orderFull.table_number, // idem
    table_id: orderFull.table_id,         // idem
    room_name: orderFull.room_name,       // 🆕 sala se disponibile
    room_id: orderFull.room_id,           // 🆕 id sala come fallback
  };

  if (pizzeria.length) {
    await printSlip('PIZZERIA', { ...head, items: pizzeria });
    logger.info('🖨️  PIZZERIA printed', { id: orderFull.id, items: pizzeria.length });
  }
  if (kitchen.length) {
    await printSlip('CUCINA', { ...head, items: kitchen });
    logger.info('🖨️  CUCINA printed', { id: orderFull.id, items: kitchen.length });
  }
}

// 🆕 Stampa SOLO un centro (PIZZERIA | CUCINA) — usa la formattazione COMANDA
async function printOrderForCenter(orderFull, center = 'PIZZERIA') {
  if (PRINTER_ENABLED !== 'true') {
    logger.warn('🧾 PRINT(comanda) disabled (PRINTER_ENABLED=false)');
    return;
  }
  const { pizzeria, kitchen } = splitByDept(orderFull.items || []);
  const head = {
    id: orderFull.id,
    customer_name: orderFull.customer_name,
    phone: orderFull.phone,
    people: orderFull.people,
    scheduled_at: orderFull.scheduled_at,
    total: orderFull.total,
    note: orderFull.note,
    fulfillment: orderFull.fulfillment,
    delivery_name: orderFull.delivery_name,
    delivery_phone: orderFull.delivery_phone,
    delivery_address: orderFull.delivery_address,
    delivery_note: orderFull.delivery_note,
    table_name: orderFull.table_name,
    table_number: orderFull.table_number,
    table_id: orderFull.table_id,
    room_name: orderFull.room_name,   // 🆕
    room_id: orderFull.room_id,       // 🆕
  };

  const which = String(center || 'PIZZERIA').toUpperCase();
  const payload = which === 'CUCINA' ? kitchen : pizzeria;
  const title   = which === 'CUCINA' ? 'CUCINA' : 'PIZZERIA';

  if (!payload.length) {
    logger.info('🧾 comanda skip (no items per centro)', { id: orderFull.id, center: which });
    return;
  }
  await printComandaSlip(title, { ...head, items: payload }); // 👈 stile COMANDA
  logger.info('🧾 comanda printed', { id: orderFull.id, center: which, items: payload.length });
}

module.exports = { printOrderDual, printOrderForCenter };
