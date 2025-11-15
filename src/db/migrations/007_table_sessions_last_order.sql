-- 007_table_sessions_last_order.sql
-- Tracciamento ultimo ordine legato alla sessione NFC del tavolo
-- Idempotente: crea le colonne solo se non esistono.

START TRANSACTION;

-- last_order_id (INT NULL)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'table_sessions'
    AND COLUMN_NAME  = 'last_order_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `table_sessions` ADD COLUMN `last_order_id` INT NULL;',
  'SELECT "skip_add_last_order_id"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- last_order_status (VARCHAR(20) NULL)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'table_sessions'
    AND COLUMN_NAME  = 'last_order_status'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `table_sessions` ADD COLUMN `last_order_status` VARCHAR(20) NULL;',
  'SELECT "skip_add_last_order_status"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Indici di utilità (idempotenti)
-- (In molte versioni MySQL/MariaDB non c'è IF NOT EXISTS per ADD INDEX → protezione manuale)
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'table_sessions'
    AND INDEX_NAME   = 'idx_table_sessions_last_order_id'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE `table_sessions` ADD INDEX `idx_table_sessions_last_order_id` (`last_order_id`);',
  'SELECT "skip_add_idx_last_order_id"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx2_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'table_sessions'
    AND INDEX_NAME   = 'idx_table_sessions_last_order_status'
);
SET @sql := IF(@idx2_exists = 0,
  'ALTER TABLE `table_sessions` ADD INDEX `idx_table_sessions_last_order_status` (`last_order_status`);',
  'SELECT "skip_add_idx_last_order_status"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

COMMIT;
