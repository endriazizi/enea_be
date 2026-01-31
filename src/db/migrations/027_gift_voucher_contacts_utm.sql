-- ============================================================================
-- 027_gift_voucher_contacts_utm.sql
-- Tracciamento UTM sui contatti (marketing analytics)
-- ============================================================================

ALTER TABLE gift_voucher_contacts
  ADD COLUMN utm_source   VARCHAR(80)  NULL AFTER source_tag,
  ADD COLUMN utm_medium   VARCHAR(80)  NULL AFTER utm_source,
  ADD COLUMN utm_campaign VARCHAR(120) NULL AFTER utm_medium;
