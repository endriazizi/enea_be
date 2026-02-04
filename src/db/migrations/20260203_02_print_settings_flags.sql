-- 20260203_02_print_settings_flags.sql
-- Aggiunge flags default per order/include extras + invia comanda (idempotente)

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'print_settings'
    AND COLUMN_NAME = 'order_include_extras_in_total_default'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `print_settings` ADD COLUMN `order_include_extras_in_total_default` TINYINT(1) NOT NULL DEFAULT 1 AFTER `takeaway_auto_print`;',
  'SELECT "print_settings.order_include_extras_in_total_default exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'print_settings'
    AND COLUMN_NAME = 'takeaway_force_invia_comanda'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `print_settings` ADD COLUMN `takeaway_force_invia_comanda` TINYINT(1) NOT NULL DEFAULT 1 AFTER `order_include_extras_in_total_default`;',
  'SELECT "print_settings.takeaway_force_invia_comanda exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
