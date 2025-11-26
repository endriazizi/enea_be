-- 009_nfc_table_state.sql
-- Table to store per-table NFC tag enabled/disabled state

CREATE TABLE IF NOT EXISTS `nfc_table_state` (
  `table_id` INT NOT NULL PRIMARY KEY,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `blocked_reason` VARCHAR(255) DEFAULT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
