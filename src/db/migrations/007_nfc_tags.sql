-- 007_nfc_tags.sql
-- =============================================================================
-- NFC TAGS: mapping token → table_id (+ opzionale UID, revoca, auditing)
-- Sicurezza: token random unico e revocabile.
-- Robustezza:
--   - Creo la tabella senza FK.
--   - Allineo DINAMICAMENTE nfc_tags.table_id al tipo REALE di tables.id.
--   - Aggiungo indici/unique in modo idempotente.
--   - Aggiungo la FK solo se compatibile.
-- =============================================================================

-- 1) Tabella base (senza FK) ---------------------------------------------------
CREATE TABLE IF NOT EXISTS `nfc_tags` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `table_id`   INT NOT NULL,                -- allineo tipo dopo (vedi step 2)
  `token`      VARCHAR(64) NOT NULL,
  `nfc_uid`    VARCHAR(128) NULL,
  `is_revoked` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Allineo il TIPO di table_id a quello di tables.id -------------------------
--    (es. int unsigned, bigint unsigned, ecc.)
SET @ref_type := (
  SELECT COLUMN_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'tables'
    AND COLUMN_NAME  = 'id'
  LIMIT 1
);

-- Se non trovo il tipo (tabella diversa o nome colonna diverso) NON faccio nulla.
SET @sql := IF(
  @ref_type IS NOT NULL,
  CONCAT('ALTER TABLE `nfc_tags` MODIFY `table_id` ', @ref_type, ' NOT NULL;'),
  'DO 0'
);
PREPARE __stmt FROM @sql; EXECUTE __stmt; DEALLOCATE PREPARE __stmt;

-- 3) UNIQUE su token (idempotente) --------------------------------------------
SET @exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nfc_tags'
    AND INDEX_NAME = 'uk_nfc_token'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE `nfc_tags` ADD UNIQUE KEY `uk_nfc_token` (`token`);',
  'DO 0'
);
PREPARE __stmt FROM @sql; EXECUTE __stmt; DEALLOCATE PREPARE __stmt;

-- 4) INDEX su table_id (idempotente) ------------------------------------------
SET @exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'nfc_tags'
    AND INDEX_NAME = 'ix_nfc_table_id'
);
SET @sql := IF(@exists = 0,
  'CREATE INDEX `ix_nfc_table_id` ON `nfc_tags`(`table_id`);',
  'DO 0'
);
PREPARE __stmt FROM @sql; EXECUTE __stmt; DEALLOCATE PREPARE __stmt;

-- 5) FK → `tables`(`id`) (idempotente) ----------------------------------------
--    NB: se per qualsiasi motivo il tipo non è compatibile, questa ALTER fallirà.
--    Va bene: la tabella funziona comunque senza FK. Potremo aggiungerla con una
--    migrazione successiva quando lo schema sarà allineato.
SET @exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'nfc_tags'
    AND CONSTRAINT_NAME = 'fk_nfc_table'
);
SET @sql := IF(@exists = 0,
  'ALTER TABLE `nfc_tags` ADD CONSTRAINT `fk_nfc_table` ' 
  'FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) '
  'ON DELETE RESTRICT ON UPDATE RESTRICT;',
  'DO 0'
);
-- CONCAT di più stringhe in una sola variabile:
SET @sql := REPLACE(@sql, '  ', ' ');
PREPARE __stmt FROM @sql; EXECUTE __stmt; DEALLOCATE PREPARE __stmt;

-- 6) Seed iniziale: un token attivo per ogni tavolo che non ne ha uno ----------
INSERT INTO `nfc_tags` (`table_id`, `token`)
SELECT t.`id`,
       REPLACE(SUBSTRING(UUID(), 1, 13), '-', '')
FROM `tables` t
LEFT JOIN `nfc_tags` n
  ON n.`table_id` = t.`id` AND n.`is_revoked` = 0
WHERE n.`id` IS NULL;
