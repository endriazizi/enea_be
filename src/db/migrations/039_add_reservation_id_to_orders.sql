-- 039_add_reservation_id_to_orders.sql
-- ============================================================================
-- Aggiunge reservation_id agli ordini per collegare ordini a prenotazioni.
-- Idempotente: controlla INFORMATION_SCHEMA prima di aggiungere.
-- Compatibile MySQL/MariaDB (DB Viewer).
-- ============================================================================

-- Verifica se la colonna reservation_id esiste già
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'reservation_id'
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE `orders` ADD COLUMN `reservation_id` BIGINT NULL AFTER `table_id`',
  'SELECT ''skip_add_reservation_id'''
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Indice per lookup ordini per prenotazione
SET @idx_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_reservation_id'
);

SET @idx_sql = IF(
  @idx_exists = 0,
  'CREATE INDEX `idx_orders_reservation_id` ON `orders`(`reservation_id`)',
  'SELECT ''skip_idx_reservation_id'''
);

PREPARE idx_stmt FROM @idx_sql;
EXECUTE idx_stmt;
DEALLOCATE PREPARE idx_stmt;
