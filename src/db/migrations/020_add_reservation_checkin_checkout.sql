-- 020_add_reservation_checkin_checkout.sql
-- ============================================================================
-- Aggiunge tracciamento temporale di check-in / check-out su reservations.
-- - checkin_at  : quando il cliente si siede
-- - checkout_at : quando lascia il tavolo
-- - dwell_sec   : durata in secondi (checkout_at - checkin_at), calcolata da BE
-- NOTE:
-- - Valori NULL-safe: se fai check-in e mai check-out, dwell rimane NULL.
-- - Non cambiamo l'enum di status: restiamo su 'pending'/'accepted'/'rejected'/'cancelled'.
-- ============================================================================

ALTER TABLE reservations
  ADD COLUMN checkin_at  DATETIME NULL AFTER updated_at,
  ADD COLUMN checkout_at DATETIME NULL AFTER checkin_at,
  ADD COLUMN dwell_sec   INT NULL AFTER checkout_at;

-- Index utili per report veloci
CREATE INDEX IF NOT EXISTS idx_res_checkin_at  ON reservations(checkin_at);
CREATE INDEX IF NOT EXISTS idx_res_checkout_at ON reservations(checkout_at);
