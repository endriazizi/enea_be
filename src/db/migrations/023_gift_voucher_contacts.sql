-- ============================================================================
-- 023_gift_voucher_contacts.sql
-- Contatti raccolti da attivazione buoni regalo (marketing consent)
-- ============================================================================

CREATE TABLE IF NOT EXISTS gift_voucher_contacts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  voucher_id     INT         NOT NULL,
  voucher_code   VARCHAR(32) NOT NULL,

  customer_first VARCHAR(120) NOT NULL,
  customer_last  VARCHAR(120) NOT NULL,
  phone          VARCHAR(40)  NULL,
  email          VARCHAR(160) NULL,
  city           VARCHAR(120) NOT NULL,
  birthday       DATE         NULL,
  notes          TEXT         NULL,

  consent_marketing TINYINT(1) NOT NULL DEFAULT 0,
  source_tag        VARCHAR(64) NOT NULL DEFAULT 'gift_voucher_manual',

  created_at     DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),

  UNIQUE KEY uq_gvc_voucher_id (voucher_id),
  INDEX idx_gvc_voucher_code (voucher_code),
  INDEX idx_gvc_created_at (created_at),
  CONSTRAINT fk_gvc_voucher_id
    FOREIGN KEY (voucher_id) REFERENCES gift_vouchers(id)
    ON DELETE CASCADE
);
