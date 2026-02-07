-- Aggiunge extra_total a order_items per mostrare prezzo extra ingredienti in modale ordini
-- (idempotente)
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'extra_total'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `order_items` ADD COLUMN `extra_total` DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER `notes`;',
  'SELECT "order_items.extra_total exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
