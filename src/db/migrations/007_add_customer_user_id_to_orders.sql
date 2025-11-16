-- 007_add_customer_user_id_to_orders.sql
-- Aggiunge orders.customer_user_id + indice, in modo idempotente.
-- Compatibile MySQL/MariaDB (usa information_schema + PREPARE).

-- 1) Colonna
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'customer_user_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `orders` ADD COLUMN `customer_user_id` BIGINT NULL AFTER `email`',
  'SELECT "skip_add_column_customer_user_id"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Indice
SET @idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_customer_user_id'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX `idx_orders_customer_user_id` ON `orders`(`customer_user_id`)',
  'SELECT "skip_create_index_idx_orders_customer_user_id"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
