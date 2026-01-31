-- ============================================================================
-- 025_gift_voucher_optouts.sql
-- Storico revoche marketing (opt-out) separato da contatti
-- ============================================================================

CREATE TABLE IF NOT EXISTS gift_voucher_optouts (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  contact_id  INT NULL,
  email       VARCHAR(160) NULL,
  phone       VARCHAR(40)  NULL,
  channel     VARCHAR(32)  NULL,
  reason      VARCHAR(255) NULL,
  user_agent  VARCHAR(255) NULL,
  ip_addr     VARCHAR(64)  NULL,
  created_at  DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),

  INDEX idx_gvo_contact (contact_id),
  INDEX idx_gvo_email (email),
  INDEX idx_gvo_phone (phone),
  INDEX idx_gvo_created (created_at)
);
