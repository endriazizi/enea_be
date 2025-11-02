// src/utils/print-order.js
// ============================================================================
// Stampa termica: 2 copie (PIZZERIA / CUCINA) raggruppate per categoria.
// La categoria arriva già risolta dal service come: COALESCE(c.name,'Altro') AS category
// Se la stampante non è configurata → stampa “preview” su console.
// ENV supportate: PRINTER_IP, PRINTER_PORT (o PRINTER.ip/port in env.js)
// ============================================================================

'use strict';

const net = require('net');
const logger = require('../logger');
const env = require('../env');

function groupBy(list, keyFn) {
  const m = new Map();
  for (const it of list || []) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

function buildText(order, title, items) {
  const ln = (s = '') => s + '\n';
  let out = '';
  out += ln('==============================');
  out += ln(` ${title}`);
  out += ln('==============================');
  out += ln(`Ora: ${order.created_at}   #${order.id}`);
  out += ln(`Cliente: ${order.customer_name || '-'}`);
  if (order.phone) out += ln(`Tel: ${order.phone}`);
  if (order.note)  out += ln(`Note: ${order.note}`);
  out += ln('------------------------------');

  const byCat = groupBy(items, (it) => it.category || 'Altro');
  for (const [cat, rows] of byCat) {
    out += ln(`> ${cat}`);
    for (const r of rows) {
      const q = String(r.qty).padStart(2, ' ');
      const name = r.name;
      const price = Number(r.price || 0).toFixed(2);
      out += ln(` ${q} x ${name}   € ${price}`);
      if (r.notes) out += ln(`    * ${r.notes}`);
    }
    out += ln('------------------------------');
  }
  out += ln(`Totale: € ${(Number(order.total || 0)).toFixed(2)}`);
  out += ln('\n\n');
  return out;
}

async function sendRaw(text, which) {
  const ip = env.PRINTER?.ip || env.PRINTER_IP;
  const port = Number(env.PRINTER?.port || env.PRINTER_PORT || 9100);

  // comando ESC/POS taglio
  const CUT = Buffer.from([0x1D, 0x56, 0x00]);

  if (!ip) {
    logger.warn(`🖨️ [${which}] preview (no PRINTER_IP)`);
    console.log(text);
    return;
  }

  await new Promise((resolve, reject) => {
    const sock = new net.Socket();
    sock.connect(port, ip, () => {
      sock.write(text, 'utf8', () => {
        sock.write(CUT);
        sock.end();
      });
    });
    sock.on('close', resolve);
    sock.on('error', reject);
  });
  logger.info(`🖨️ [${which}] inviato a ${ip}:${port}`, { bytes: Buffer.byteLength(text) });
}

async function printOrderSplitByCategory(orderFull, { PIZZERIA_CATEGORIES = ['PIZZE'], KITCHEN_CATEGORIES = ['BEVANDE'] } = {}) {
  const isIn = (arr, v) => arr.includes(String(v || '').trim());
  const pizze  = orderFull.items.filter(it => isIn(PIZZERIA_CATEGORIES, it.category));
  const cucina = orderFull.items.filter(it => isIn(KITCHEN_CATEGORIES,  it.category));

  const txtP = buildText(orderFull, 'PIZZERIA', pizze);
  const txtC = buildText(orderFull, 'CUCINA',   cucina);

  await sendRaw(txtP, 'PIZZERIA');
  await sendRaw(txtC, 'CUCINA');
}

module.exports = { printOrderSplitByCategory };
