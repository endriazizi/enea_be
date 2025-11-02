// src/utils/print-order.js
// ============================================================================
// Stampa ESC/POS “Pizzeria/Cucina”. NIENTE simbolo € (codepage problemi).
// - legge env PRINTER_* e mapping categorie PIZZERIA_CATEGORIES / KITCHEN_CATEGORIES
// - se PRINTER_ENABLED=false → no-op (non blocca i flussi)
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
const TXT = s => Buffer.from(String(s) + '\n', 'utf8');

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

async function printSlip(title, order) {
  const sock = await openSocket();

  const write = (buf) => sock.write(buf);
  const cut   = () => { if (PRINTER_CUT === 'true') write(esc(0x1D, 0x56, 0x42, 0x00)); };

  const headerLines = (PRINTER_HEADER || '').split('|').filter(Boolean);
  write(esc(0x1B,0x40));            // init
  write(esc(0x1B,0x21,0x20));       // double height
  write(TXT(title));
  write(esc(0x1B,0x21,0x00));       // normal

  for (const h of headerLines) write(TXT(h));

  write(TXT('------------------------------'));
  write(TXT(`#${order.id}  ${order.customer_name}`));
  if (order.phone) write(TXT(order.phone));
  if (order.people) write(TXT(`Coperti: ${order.people}`));
  if (order.scheduled_at) write(TXT(`Orario: ${order.scheduled_at}`));
  write(TXT('------------------------------'));

  for (const it of order.items) {
    // NO simbolo euro: stampa “prezzo” semplice
    write(TXT(`${it.qty} x ${it.name}  ${Number(it.price).toFixed(2)}`));
    if (it.notes) write(TXT(`  NOTE: ${it.notes}`));
  }

  write(TXT('------------------------------'));
  write(TXT(`Totale: ${Number(order.total || 0).toFixed(2)}`));
  if (PRINTER_FOOTER) {
    write(TXT(''));
    for (const f of (PRINTER_FOOTER || '').split('|')) write(TXT(f));
  }
  write(TXT(''));
  cut();
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
  };

  // stampa PIZZERIA
  if (pizzeria.length) {
    await printSlip('PIZZERIA', { ...head, items: pizzeria });
    logger.info('🖨️  PIZZERIA printed', { id: orderFull.id, items: pizzeria.length });
  }
  // stampa CUCINA
  if (kitchen.length) {
    await printSlip('CUCINA', { ...head, items: kitchen });
    logger.info('🖨️  CUCINA printed', { id: orderFull.id, items: kitchen.length });
  }
}

module.exports = { printOrderDual };
