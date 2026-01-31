-- ============================================================================
-- 024_gift_voucher_contacts_optout.sql
-- Aggiunge tracciamento opt-out marketing su contatti buono regalo
-- ============================================================================

ALTER TABLE gift_voucher_contacts
  ADD COLUMN opt_out_at DATETIME NULL AFTER created_at,
  ADD COLUMN opt_out_channel VARCHAR(32) NULL AFTER opt_out_at;
