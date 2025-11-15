-- 007_nfc_tags_token_16_and_indexes.sql
-- Allinea lunghezza token, default e indici per risoluzione veloce.

-- 1) token almeno 12 char (mettiamo 16 per stare larghi)
ALTER TABLE nfc_tags
  MODIFY COLUMN token VARCHAR(16) NOT NULL;

-- 2) is_revoked default 0 (coerente con bind)
ALTER TABLE nfc_tags
  MODIFY COLUMN is_revoked TINYINT(1) NOT NULL DEFAULT 0;

-- 3) UNIQUE su token (solo uno attivo con quel valore)
SET @has_uk := (
  SELECT COUNT(1) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'nfc_tags'
     AND index_name = 'uk_nfc_token'
);
SET @sql := IF(@has_uk=0,
  'ALTER TABLE nfc_tags ADD UNIQUE KEY uk_nfc_token (token)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Indice per lookup rapido di token attivi per tavolo
SET @has_idx := (
  SELECT COUNT(1) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'nfc_tags'
     AND index_name = 'idx_nfc_active_by_table'
);
SET @sql2 := IF(@has_idx=0,
  'ALTER TABLE nfc_tags ADD INDEX idx_nfc_active_by_table (table_id, is_revoked)',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
