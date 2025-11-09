// 📡 Socket.IO — Prenotazioni tavolo (realtime) + creazione anche da Admin
// - Mantiene i canali esistenti (reservations-get/new/update-status/assign-table)
// - 🆕 Aggiunge eventi di comodo per check-in / check-out (opzionali dal client)
//   • 'reservation-checkin'  { id, at? }   → svc.checkInReservation(...)
//   • 'reservation-checkout' { id, at? }   → svc.checkOutReservation(...)
// - 🧼 Al check-out, emette anche { table_id, cleaning_until } per attivare la “Pulizia 5:00” sui FE passivi.

'use strict';

const logger = require('../logger'); // ✅ istanza diretta
const env    = require('../env');

const {
  create: createReservation,
  updateStatus: updateReservationStatus,
  update: assignReservationTable_RAW,       // useremo helper sotto
  list: listReservations,
  checkInReservation,                        // 🆕 service idempotente
  checkOutReservation                        // 🆕 service idempotente (calcola dwell_sec)
} = require('../services/reservations.service');

// piccolo helper per compat: assegna tavolo
async function assignReservationTable(id, table_id) {
  return await assignReservationTable_RAW(id, { table_id });
}

// finestra pulizia (default 5 minuti) → configurabile via ENV
const CLEAN_SEC =
  Number(process.env.CLEAN_SECONDS || (env.RESV && env.RESV.cleanSeconds) || 300);

module.exports = (io) => {
  io.on('connection', (socket) => {
    logger.info('📡 [RES] SOCKET connected', { id: socket.id });

    // registrazione canali
    socket.on('register-admin',   () => socket.join('admins'));
    socket.on('register-customer', (token) => token && socket.join(`c:${token}`));

    // LIST
    socket.on('reservations-get', async (filter = {}) => {
      logger.info('📡 [RES] reservations-get ▶️', { from: socket.id, filter });
      const rows = await listReservations(filter);
      socket.emit('reservations-list', rows);
    });

    // CREATE (cliente)
    socket.on('reservation-new', async (dto) => {
      logger.info('📡 [RES] reservation-new ▶️', { origin: 'customer', body: dto });
      const r = await createReservation(dto);
      io.to('admins').emit('reservation-created', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-created', r);
      logger.info('📡 [RES] reservation-created ✅ broadcast', { id: r.id });
    });

    // CREATE (admin)
    socket.on('reservation-admin-new', async (dto) => {
      logger.info('📡 [RES] reservation-admin-new ▶️', { origin: 'admin', body: dto });
      const r = await createReservation(dto);
      io.to('admins').emit('reservation-created', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-created', r);
      logger.info('📡 [RES] reservation-created ✅ (admin)', { id: r.id });
    });

    // CAMBIO STATO (compat con FE storico)
    socket.on('reservation-update-status', async ({ id, status }) => {
      logger.info('📡 [RES] reservation-update-status ▶️', { id, status });
      const r = await updateReservationStatus({ id, action: status });
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
    });

    // ASSEGNAZIONE TAVOLO
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
      io.to('admins').emit('reservation-checkin', { id: r.id, checkin_at: r.checkin_at, table_id: r.table_id || null });
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
      logger.info('📡 [RES] reservation-checkin ✅ broadcast', { id: r.id });
    });

    // 🆕 CHECK-OUT
    socket.on('reservation-checkout', async ({ id, at = null }) => {
      logger.info('📡 [RES] reservation-checkout ▶️', { id, at });
      const r = await checkOutReservation(id, at, { user: { email: 'socket@server' } });

      // calcolo in uscita una cleaning window lato socket (non blocca il BE)
      const base = at ? new Date(at).getTime() : Date.now();
      const cleaning_until = new Date(base + CLEAN_SEC * 1000).toISOString();

      io.to('admins').emit('reservation-checkout', {
        id         : r.id,
        table_id   : r.table_id || null,
        checkout_at: r.checkout_at,
        dwell_sec  : r.dwell_sec || null,
        cleaning_until
      });
      io.to('admins').emit('reservation-updated', r);
      if (r.client_token) io.to(`c:${r.client_token}`).emit('reservation-updated', r);
      logger.info('📡 [RES] reservation-checkout ✅ broadcast', { id: r.id, cleaning_until });
    });

    socket.on('disconnect', (reason) => {
      logger.info('📡 [RES] SOCKET disconnected', { id: socket.id, reason });
    });
  });
};
