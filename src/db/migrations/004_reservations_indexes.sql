-- src/db/migrations/004_reservations_indexes.sql
-- Indici per performance su liste/ricerche prenotazioni
ALTER TABLE reservations
  ADD INDEX idx_resv_start_at (start_at),
  ADD INDEX idx_resv_status (status),
  ADD INDEX idx_resv_table (table_id);
