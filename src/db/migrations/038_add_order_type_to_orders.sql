-- 038_add_order_type_to_orders.sql
-- ============================================================================
-- Aggiunge order_type agli ordini per distinguere ordini normali da FRY_QUICK.
-- Idempotente: controlla INFORMATION_SCHEMA prima di aggiungere.
-- Compatibile MySQL/MariaDB (DB Viewer).
-- ============================================================================

-- Verifica se la colonna order_type esiste già
SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'order_type'
);

-- Aggiungi order_type solo se non esiste
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE `orders` ADD COLUMN `order_type` VARCHAR(32) NOT NULL DEFAULT ''NORMAL'' AFTER `channel`',
  'SELECT ''skip_add_order_type'''
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Indice per filtrare ordini cucina fry (order_type = FRY_QUICK)
SET @idx_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_order_type'
);

SET @idx_sql = IF(
  @idx_exists = 0,
  'CREATE INDEX `idx_orders_order_type` ON `orders`(`order_type`)',
  'SELECT ''skip_idx_order_type'''
);

PREPARE idx_stmt FROM @idx_sql;
EXECUTE idx_stmt;
DEALLOCATE PREPARE idx_stmt;
