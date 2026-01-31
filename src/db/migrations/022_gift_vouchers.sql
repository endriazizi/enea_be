-- ============================================================================
-- 022_gift_vouchers.sql
-- Nuova feature: Buoni Regalo (Gift Vouchers) + audit stampa termica
-- Stile progetto: commenti lunghi in italiano, modifiche incrementali.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tabella principale: gift_vouchers
-- - code univoco (uppercase)
-- - value_cents > 0
-- - valid_from default UTC now
-- - status: active | redeemed | void | expired (expired è anche calcolabile)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gift_vouchers (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  code         VARCHAR(32)  NOT NULL,
  value_cents  INT          NOT NULL,
  event_title  VARCHAR(255) NOT NULL,
  description  TEXT         NULL,
  valid_from   DATETIME     NOT NULL DEFAULT UTC_TIMESTAMP(),
  valid_until  DATETIME     NOT NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'active',
  redeemed_at  DATETIME     NULL,
  redeemed_note VARCHAR(255) NULL,
  created_at   DATETIME     NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at   DATETIME     NULL,

  UNIQUE KEY uq_gift_vouchers_code (code),
  INDEX idx_gift_vouchers_status (status),
  INDEX idx_gift_vouchers_valid_until (valid_until),
  INDEX idx_gift_vouchers_created_at (created_at)
);

-- ---------------------------------------------------------------------------
-- Audit stampa: gift_voucher_print_jobs
-- - logga esito (success/fail/skipped) + errore + info stampante
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gift_voucher_print_jobs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  voucher_id  INT         NOT NULL,
  printed_at  DATETIME    NOT NULL DEFAULT UTC_TIMESTAMP(),
  status      VARCHAR(16) NOT NULL,
  error       TEXT        NULL,
  printer_ip  VARCHAR(64) NULL,
  printer_port INT        NULL,
  qr_text     VARCHAR(255) NULL,
  created_by  VARCHAR(120) NULL,

  INDEX idx_gvp_voucher (voucher_id),
  INDEX idx_gvp_printed_at (printed_at),
  CONSTRAINT fk_gvp_voucher_id
    FOREIGN KEY (voucher_id) REFERENCES gift_vouchers(id)
    ON DELETE CASCADE
);
