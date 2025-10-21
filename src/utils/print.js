// server/src/utils/print.js
// 🖨️ Stampa ESC/POS su TCP 9100 con fallback su file .txt in /receipts
// Include: log dettagliati, init ESC/POS, cut opzionale, timeout chiaro

const net = require('net');
const fs = require('fs');
const path = require('path');
const logger = require('../logger'); // ✅ tua istanza

// === INIZIO MODIFICA (helper config + log) ===
// ✅ Converte process.env in config pulita e logga all'avvio della stampa
function loadPrinterCfg() {
  const header = (process.env.PRINTER_HEADER || '').split('|').filter(Boolean);
  return {
    enabled: String(process.env.PRINTER_ENABLED).toLowerCase() === 'true',
    ip: process.env.PRINTER_IP || process.env.PRINTER_HOST || '127.0.0.1',
    port: Number(process.env.PRINTER_PORT || 9100),
    cut: String(process.env.PRINTER_CUT || 'true').toLowerCase() === 'true',
    header,
    footer: process.env.PRINTER_FOOTER || '',
    codepage: process.env.PRINTER_CODEPAGE || 'cp858',
  };
}
// === FINE MODIFICA ===

function format(order, cfg) {
  const L = [];
  const pad = (l, r, w = 42) => {
    l = String(l);
    r = String(r);
    const s = Math.max(1, w - (l.length + r.length));
    return l + ' '.repeat(s) + r;
  };

  (cfg.header || []).forEach(h => L.push(h));
  L.push('-'.repeat(42));
  if (order.id) L.push(pad('Ordine #', order.id));
  if (order.created_at) L.push(pad('Data', String(order.created_at)));
  L.push('-'.repeat(42));

  (order.items || []).forEach(it => {
    const left = `${it.qty || 1}x ${it.product_name || it.name || 'Item'}`;
    const right = `€ ${(Number(it.price || 0) * (it.qty || 1)).toFixed(2)}`;
    L.push(pad(left, right));
    if (it.notes) L.push('  Note: ' + it.notes);
  });

  L.push('-'.repeat(42));
  L.push(pad('TOTALE', `€ ${Number(order.total || 0).toFixed(2)}`));
  if (cfg.footer) { L.push(''); L.push(cfg.footer); }
  L.push(''); L.push('');

  return L.join('\n');
}

function fallback(order, text, err) {
  const dir = path.join(process.cwd(), 'receipts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `receipt-${order.id || 'na'}-${Date.now()}.txt`);
  fs.writeFileSync(file, text);
  logger.error('🖨️ PRINT fallback', { file, error: String(err && err.message || err) });
}

// === INIZIO MODIFICA (ESC/POS init + log estesi) ===
function buildPayload(text, cut = true) {
  // ESC @ (init) + testo + taglio opzionale
  const ESC = '\x1B';
  const GS  = '\x1D';
  let payload = ESC + '@' + text + '\n\n';
  if (cut) payload += GS + 'V' + '\x00';
  return Buffer.from(payload, 'binary'); // inviamo come binario
}

async function printOrder(order, cfgInput) {
  const cfg = cfgInput || loadPrinterCfg();
  const text = format(order, cfg);

  logger.info('🖨️ PRINT begin', {
    enabled: cfg.enabled, ip: cfg.ip, port: cfg.port, cut: cfg.cut,
    headerLines: (cfg.header || []).length, footerLen: (cfg.footer || '').length,
    textLen: text.length
  });

  if (!cfg.enabled) {
    logger.warn('🖨️ PRINT disabled → fallback su file');
    fallback(order, text, 'disabled');
    return;
  }

  const payload = buildPayload(text, cfg.cut);

  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let settled = false;

    const doneOk = () => {
      if (settled) return;
      settled = true;
      logger.info('✅ PRINT ok', { ip: cfg.ip, port: cfg.port, bytes: payload.length });
      resolve();
    };
    const doneErr = (e) => {
      if (settled) return;
      settled = true;
      fallback(order, text, e);
      logger.error('❌ PRINT error', { ip: cfg.ip, port: cfg.port, code: e && e.code, msg: String(e && e.message || e) });
      reject(e);
    };

    sock.setTimeout(5000); // ⏱️ un filo più alto
    logger.info('🔌 PRINT connect...', { ip: cfg.ip, port: cfg.port });

    sock.once('connect', () => {
      logger.info('🔐 PRINT connected, sending...');
      sock.write(payload, (err) => {
        if (err) return doneErr(err);
        logger.info('📤 PRINT payload sent, ending socket...');
        sock.end(); // chiudiamo subito (raw)
      });
    });

    sock.once('close', (hadErr) => {
      logger.info('🔚 PRINT socket closed', { hadErr });
      if (!hadErr) doneOk();
    });

    sock.once('timeout', () => doneErr(new Error('timeout')));
    sock.once('error', doneErr);

    try {
      sock.connect(cfg.port, cfg.ip);
    } catch (e) {
      doneErr(e);
    }
  });
}
// === FINE MODIFICA ===

module.exports = { printOrder, loadPrinterCfg };
