-- 031_public_asporto_whatsapp_show_prices.sql
-- ============================================================================
-- Flag WhatsApp: mostra/nasconde prezzi/coperto/totale nel messaggio ordine
-- ============================================================================

SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'public_asporto_settings'
    AND COLUMN_NAME = 'whatsapp_show_prices'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `public_asporto_settings` ADD COLUMN `whatsapp_show_prices` TINYINT(1) NOT NULL DEFAULT 1 AFTER `asporto_lead_minutes`',
  'SELECT "skip_add_column_whatsapp_show_prices"'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
