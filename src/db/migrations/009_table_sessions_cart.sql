-- 009_table_sessions_cart.sql
-- ============================================================================
-- Estende table_sessions con:
-- - cart_json MEDIUMTEXT NULL (snapshot carrello)
-- - cart_version INT UNSIGNED NOT NULL DEFAULT 0 (optimistic locking)
-- - cart_updated_at DATETIME NULL (auditing/TTL)
-- Idempotente per MySQL/MariaDB (usa INFORMATION_SCHEMA + PREPARE).
-- ============================================================================

-- cart_json ------------------------------------------------------------------
SET @sql := IF (
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'table_sessions'
       AND COLUMN_NAME  = 'cart_json') = 0,
  'ALTER TABLE `table_sessions` ADD COLUMN `cart_json` MEDIUMTEXT NULL AFTER `note`;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- cart_version ---------------------------------------------------------------
SET @sql := IF (
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'table_sessions'
       AND COLUMN_NAME  = 'cart_version') = 0,
  'ALTER TABLE `table_sessions` ADD COLUMN `cart_version` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `cart_json`;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- cart_updated_at ------------------------------------------------------------
SET @sql := IF (
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'table_sessions'
       AND COLUMN_NAME  = 'cart_updated_at') = 0,
  'ALTER TABLE `table_sessions` ADD COLUMN `cart_updated_at` DATETIME NULL AFTER `cart_version`;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- (opz) indice di servizio su (table_id, closed_at) per query veloci ----------
SET @sql := IF (
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'table_sessions'
       AND INDEX_NAME   = 'idx_table_sessions_open') = 0,
  'CREATE INDEX `idx_table_sessions_open` ON `table_sessions` (`table_id`, `closed_at`);',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
