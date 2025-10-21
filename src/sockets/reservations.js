// 📡 Socket.IO — Prenotazioni tavolo (realtime) + creazione anche da Admin
const logger = require('../logger'); // ✅ istanza diretta
const {
  createReservation,
  updateReservationStatus,
  assignReservationTable,
  listReservations
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
      const r = await updateReservationStatus(id, status);
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    socket.on('reservation-assign-table', async ({ id, table_id }) => {
      logger.info('📡 [RES] reservation-assign-table ▶️', { id, table_id });
      const r = await assignReservationTable(id, table_id);
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    socket.on('disconnect', (reason) => {
      logger.info('📡 [RES] SOCKET disconnected', { id: socket.id, reason });
    });
  });
};
