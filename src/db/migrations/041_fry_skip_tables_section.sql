-- 041_fry_skip_tables_section.sql
-- ============================================================================
-- Setting: se attivo, /quick-fry salta la sezione tavoli e va direttamente
-- alle prenotazioni (table_id dalla prenotazione; per walk-in resta griglia tavoli).
-- Persistenza in public_asporto_settings.
-- ============================================================================

SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'public_asporto_settings'
    AND COLUMN_NAME = 'fry_skip_tables_section'
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE `public_asporto_settings` ADD COLUMN `fry_skip_tables_section` TINYINT(1) NOT NULL DEFAULT 0 AFTER `prenota_online_enabled`',
  'SELECT ''skip_fry_skip_tables_section'''
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
