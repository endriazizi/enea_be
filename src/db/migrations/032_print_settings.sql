-- 032_print_settings.sql
-- ============================================================================
-- Impostazioni stampa (persistenza DB)
-- - riga unica (id=1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS print_settings (
  id INT NOT NULL PRIMARY KEY,
  printer_enabled TINYINT(1) NOT NULL DEFAULT 1,
  printer_ip VARCHAR(64) NOT NULL DEFAULT '',
  printer_port INT NOT NULL DEFAULT 9100,
  takeaway_auto_print TINYINT(1) NOT NULL DEFAULT 1,
  takeaway_comanda_center VARCHAR(10) NOT NULL DEFAULT 'ALL',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- riga unica (id=1)
INSERT INTO print_settings (id)
VALUES (1)
ON DUPLICATE KEY UPDATE id = id;
