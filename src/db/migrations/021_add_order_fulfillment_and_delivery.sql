-- 021_add_order_fulfillment_and_delivery.sql
-- ============================================================================
-- Aggiunge modalità ordine "fulfillment" + campi delivery_* agli ordini.
-- - Idempotente: usa INFORMATION_SCHEMA + PREPARE/EXECUTE.
-- - Backfill sicuro: se l'ordine ha table_id → table, altrimenti takeaway.
-- ============================================================================

-- === fulfillment -------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'fulfillment'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `orders` ADD COLUMN `fulfillment` ENUM(''table'',''takeaway'',''delivery'') NOT NULL DEFAULT ''takeaway'' AFTER `table_id`',
  'SELECT "skip_add_column_fulfillment"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === delivery_name -----------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'delivery_name'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `orders` ADD COLUMN `delivery_name` VARCHAR(120) NULL AFTER `fulfillment`',
  'SELECT "skip_add_column_delivery_name"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === delivery_phone ----------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'delivery_phone'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `orders` ADD COLUMN `delivery_phone` VARCHAR(40) NULL AFTER `delivery_name`',
  'SELECT "skip_add_column_delivery_phone"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === delivery_address --------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'delivery_address'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `orders` ADD COLUMN `delivery_address` VARCHAR(255) NULL AFTER `delivery_phone`',
  'SELECT "skip_add_column_delivery_address"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === delivery_note -----------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'delivery_note'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `orders` ADD COLUMN `delivery_note` VARCHAR(255) NULL AFTER `delivery_address`',
  'SELECT "skip_add_column_delivery_note"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- === Backfill fulfillment ----------------------------------------------------
-- Nota: aggiorno solo i casi "compat" (takeaway + table_id presente),
-- così non tocco eventuali ordini delivery già esistenti in ambienti futuri.
UPDATE `orders`
SET `fulfillment` = IF(`table_id` IS NULL, 'takeaway', 'table')
WHERE `fulfillment` IS NULL
   OR `fulfillment` = ''
   OR (`fulfillment` = 'takeaway' AND `table_id` IS NOT NULL);

-- === Indice su fulfillment ---------------------------------------------------
SET @idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND INDEX_NAME = 'idx_orders_fulfillment'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX `idx_orders_fulfillment` ON `orders`(`fulfillment`)',
  'SELECT "skip_create_index_idx_orders_fulfillment"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
