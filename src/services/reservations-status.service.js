// 📡 Socket.IO — Prenotazioni tavolo (realtime) + creazione anche da Admin
// - Mantiene i canali esistenti (reservations-get/new/update-status/assign-table)
// - 🆕 Aggiunge eventi di comodo per check-in / check-out (opzionali dal client)
//   • 'reservation-checkin'  { id, at? }   → svc.checkIn()
//   • 'reservation-checkout' { id, at? }   → svc.checkOut()
const logger = require('../logger'); // ✅ istanza diretta
const {
  createReservation,
  updateReservationStatus,
  assignReservationTable,
  listReservations,
  checkInReservation,   // 🆕 alias nel service
  checkOutReservation   // 🆕 alias nel service
} = require('../services/reservations.service');

module.exports = (io) => {
  io.on('connection', (socket) => {
    logger.info('📡 [RES] SOCKET connected', { id: socket.id });

    socket.on('register-admin', () => socket.join('admins'));
    socket.on('register-customer', (token) => token && socket.join(`c:${token}`));

    socket.on('reservations-get', async (filter = {}) => {
      logger.info('📡 [RES] reservations-get ▶️', { from: socket.id, filter });
      const rows = await listReservations(filter);
      socket.emit('reservations-list', rows);
    });

    socket.on('reservation-new', async (dto) => {
      logger.info('📡 [RES] reservation-new ▶️', { origin: 'customer', body: dto });
      const r = await createReservation(dto);
      io.to('admins').emit('reservation-created', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-created', r);
      logger.info('📡 [RES] reservation-created ✅ broadcast', { id: r.id });
    });

    socket.on('reservation-admin-new', async (dto) => {
      logger.info('📡 [RES] reservation-admin-new ▶️', { origin: 'admin', body: dto });
      const r = await createReservation(dto);
      io.to('admins').emit('reservation-created', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-created', r);
      logger.info('📡 [RES] reservation-created ✅ (admin)', { id: r.id });
    });

    socket.on('reservation-update-status', async ({ id, status }) => {
      logger.info('📡 [RES] reservation-update-status ▶️', { id, status });
      const r = await updateReservationStatus({ id, action: status });
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    socket.on('reservation-assign-table', async ({ id, table_id }) => {
      logger.info('📡 [RES] reservation-assign-table ▶️', { id, table_id });
      const r = await assignReservationTable(id, table_id);
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    // 🆕 CHECK-IN
    socket.on('reservation-checkin', async ({ id, at = null }) => {
      logger.info('📡 [RES] reservation-checkin ▶️', { id, at });
      const r = await checkInReservation(id, at, { user: { email: 'socket@server' } });
      io.to('admins').emit('reservation-checkin', { id: r.id, checkin_at: r.checkin_at });
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    // 🆕 CHECK-OUT
    socket.on('reservation-checkout', async ({ id, at = null }) => {
      logger.info('📡 [RES] reservation-checkout ▶️', { id, at });
      const r = await checkOutReservation(id, at, { user: { email: 'socket@server' } });
      io.to('admins').emit('reservation-checkout', { id: r.id, checkout_at: r.checkout_at, dwell_sec: r.dwell_sec });
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    socket.on('disconnect', (reason) => {
      logger.info('📡 [RES] SOCKET disconnected', { id: socket.id, reason });
    });
  });
};
