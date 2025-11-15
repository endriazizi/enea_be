-- 008_table_sessions.sql
-- ============================================================================
-- Table sessions: 1 sessione "aperta" per tavolo; chiusa via closed_at.
-- Nota: la FK verso `tables(id)` viene aggiunta SOLO se compatibile (InnoDB + UNSIGNED),
--       così evitiamo l'errno 150. In caso non sia compatibile, avrai comunque la tabella
--       e l'indice, e potrai sistemare i tipi in seguito senza bloccare l'avvio.
-- ============================================================================

-- 1) Tabella (idempotente)
CREATE TABLE IF NOT EXISTS `table_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `table_id` BIGINT UNSIGNED NOT NULL,
  `opened_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` DATETIME NULL,
  `note` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Indice su table_id (idempotente)
SET @exists_ix := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'table_sessions' AND INDEX_NAME = 'ix_ts_table_id'
);
SET @sql := IF(@exists_ix = 0,
  'CREATE INDEX `ix_ts_table_id` ON `table_sessions`(`table_id`);',
  'DO 0'
);
PREPARE s1 FROM @sql; EXECUTE s1; DEALLOCATE PREPARE s1;

-- 3) Prova ad aggiungere la FK, solo se compatibile (InnoDB + UNSIGNED)
--    - Engine della tabella `tables`
--    - Tipo della colonna `tables.id` (controllo "unsigned")
SET @t_engine := (
  SELECT ENGINE FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tables' LIMIT 1
);
SET @t_id_coltype := (
  SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tables' AND COLUMN_NAME = 'id' LIMIT 1
);

-- Esiste già la FK?
SET @fk_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_ts_table'
);

-- Compatibilità: InnoDB + unsigned
SET @ok_engine   := IF(@t_engine = 'InnoDB', 1, 0);
SET @ok_unsigned := IF(@t_id_coltype LIKE '%unsigned%', 1, 0);

SET @sql_fk := IF(@fk_exists = 0 AND @ok_engine = 1 AND @ok_unsigned = 1,
  'ALTER TABLE `table_sessions` ADD CONSTRAINT `fk_ts_table` FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;',
  'DO 0'
);
PREPARE s2 FROM @sql_fk; EXECUTE s2; DEALLOCATE PREPARE s2;

-- 4) (Opzionale) Indice su closed_at per ricerche "aperte/chiuse"
SET @exists_ix2 := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'table_sessions' AND INDEX_NAME = 'ix_ts_closed_at'
);
SET @sql2 := IF(@exists_ix2 = 0,
  'CREATE INDEX `ix_ts_closed_at` ON `table_sessions`(`closed_at`);',
  'DO 0'
);
PREPARE s3 FROM @sql2; EXECUTE s3; DEALLOCATE PREPARE s3;

-- Fine 008
