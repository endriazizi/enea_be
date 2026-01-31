-- ============================================================================
-- 026_gift_voucher_optins.sql
-- Double opt-in marketing per buoni regalo
-- ============================================================================

CREATE TABLE IF NOT EXISTS gift_voucher_optins (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  contact_id    INT NULL,
  email         VARCHAR(160) NULL,
  phone         VARCHAR(40)  NULL,
  token         VARCHAR(64)  NOT NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'pending',
  requested_at  DATETIME     NOT NULL DEFAULT UTC_TIMESTAMP(),
  confirmed_at  DATETIME     NULL,

  source_tag    VARCHAR(64)  NULL,
  utm_source    VARCHAR(80)  NULL,
  utm_medium    VARCHAR(80)  NULL,
  utm_campaign  VARCHAR(120) NULL,

  UNIQUE KEY uq_gvo_token (token),
  INDEX idx_gvo_contact (contact_id),
  INDEX idx_gvo_email (email),
  INDEX idx_gvo_phone (phone),
  INDEX idx_gvo_status (status)
);
