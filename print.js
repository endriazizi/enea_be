const escpos = require('escpos');
escpos.Network = require('escpos-network');
const logger = require('./logger');


async function printOrder(order, printerIp) {
logger.info({ msg: 'PRINT start', printerIp, orderId: order.id });
return new Promise((resolve, reject) => {
const device = new escpos.Network(printerIp);
const printer = new escpos.Printer(device);


device.open(() => {
try {
printer
.align('CT')
.style('B')
.text('NUOVO ORDINE')
.style('NORMAL')
.align('LT')
.text(`Cliente: ${order.customer_first} ${order.customer_last}`)
.text(`Telefono: ${order.phone || ''}`)
.text(order.delivery_address ? `Indirizzo: ${order.delivery_address}` : '')
.text('------------------------------');


(order.items || []).forEach((i) => {
printer.text(`${i.qty}x ${i.product_name} €${Number(i.price).toFixed(2)}`);
if (i.notes) printer.text(` Note: ${i.notes}`);
if (i.ingredients) printer.text(` + ${i.ingredients}`);
});


printer
.text('------------------------------')
.style('B')
.text(`TOTALE: €${Number(order.total).toFixed(2)}`)
.style('NORMAL')
.cut()
.close();


logger.info({ msg: 'PRINT done', orderId: order.id });
resolve();
} catch (err) {
logger.error({ msg: 'PRINT error', error: String(err) });
try { printer.close(); } catch {}
reject(err);
}
});
});
}


module.exports = { printOrder };