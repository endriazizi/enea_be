-- 029_public_asporto_lead_minutes.sql
-- ============================================================================
-- Aggiunge "asporto_lead_minutes" alle impostazioni pubbliche /asporto.
-- ============================================================================

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'public_asporto_settings'
    AND COLUMN_NAME = 'asporto_lead_minutes'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `public_asporto_settings` ADD COLUMN `asporto_lead_minutes` INT NOT NULL DEFAULT 20 AFTER `asporto_end_time`',
  'SELECT "skip_add_column_asporto_lead_minutes"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
