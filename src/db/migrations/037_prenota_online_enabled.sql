-- 037_prenota_online_enabled.sql
-- ============================================================================
-- Flag prenotazioni online /prenota (abilita/disabilita)
-- ============================================================================

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'public_asporto_settings'
    AND COLUMN_NAME = 'prenota_online_enabled'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `public_asporto_settings` ADD COLUMN `prenota_online_enabled` TINYINT(1) NOT NULL DEFAULT 1 AFTER `public_asporto_allow_delivery`',
  'SELECT "skip_add_column_prenota_online_enabled"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
