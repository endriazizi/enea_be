// 📡 Socket.IO: gestione ordini (lista/nuovo/update)
const { query } = require('../db');                         // query wrapper
const logger = require('../logger');                        // ✅ istanza diretta
const { printOrder } = require('../utils/print');           // stampa (fallback su file se KO)
const env = require('../env');                              // config

module.exports = (io) => {
  io.on('connection', (socket) => {
    logger.info('📡 SOCKET connected', { id: socket.id });

    socket.on('get-orders', async () => {
      logger.info('📡 get-orders ▶️', { from: socket.id });
      const rows = await query('SELECT * FROM orders ORDER BY created_at DESC');
      for (const r of rows) {
        r.items = await query('SELECT * FROM order_items WHERE order_id=?', [r.id]);
      }
      socket.emit('orders-list', rows);
    });

    socket.on('new-order', async (order) => {
      logger.info('📡 new-order ▶️', { body: order });
      const res = await query(
        `INSERT INTO orders (total, currency, customer_first, customer_last, phone, email, delivery_address, status)
         VALUES (?,?,?,?,?,?,?, 'pending')`,
        [
          order.total, order.currency,
          order.customer?.firstName || null,
          order.customer?.lastName  || null,
          order.customer?.phone     || null,
          order.customer?.email     || null,
          order.customer?.deliveryAddress || null
        ]
      );
      const orderId = res.insertId;

      for (const it of (order.items || [])) {
        await query(
          `INSERT INTO order_items (order_id, product_name, qty, price, notes, ingredients)
           VALUES (?,?,?,?,?,?)`,
          [orderId, it.name, it.qty, it.price, it.notes || '', (it.chosenIngredients||[]).join(',')]
        );
      }

      const [o] = await query('SELECT * FROM orders WHERE id=?', [orderId]);
      o.items = await query('SELECT * FROM order_items WHERE order_id=?', [orderId]);

      io.emit('order-created', o);
      logger.info('📡 order-created ✅ broadcast', { orderId });

      // stampa non bloccante
      const printerCfg = { enabled: !!env.PRINTER?.ip, ip: env.PRINTER?.ip || '127.0.0.1', port: env.PRINTER?.port || 9100 };
      printOrder(o, printerCfg).catch(e => logger.error('🖨️ PRINT ❌', { error: String(e), orderId }));
    });

    socket.on('update-status', async ({ id, status }) => {
      logger.info('📡 update-status ▶️', { id, status });
      await query('UPDATE orders SET status=? WHERE id=?', [status, id]);
      io.emit('order-updated', { id, status });
    });

    socket.on('disconnect', (reason) => {
      logger.info('📡 SOCKET disconnected', { id: socket.id, reason });
    });
  });
};
