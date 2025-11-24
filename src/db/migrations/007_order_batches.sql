-- 007_order_batches.sql
-- ============================================================================
-- Tabella order_batches: traccia T1, T2, T3... per ogni ordine
-- - Ogni riga = una "mandata" (batch) di comanda/conto
-- - items_snapshot_json contiene lo snapshot delle righe order_items al momento
-- ============================================================================

-- 1) Crea tabella se non esiste
CREATE TABLE IF NOT EXISTS `order_batches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT UNSIGNED NOT NULL,
  `batch_no` INT UNSIGNED NOT NULL,          -- 1 = T1, 2 = T2, ...
  `sent_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `sent_by` VARCHAR(100) NULL,               -- es. utente/cameriere
  `note` VARCHAR(255) NULL,                  -- es. "aggiunta dolci"
  `items_snapshot_json` JSON NULL,           -- snapshot delle righe order_items
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Indice su order_id per velocizzare ricerche per ordine
--    (idempotente via INFORMATION_SCHEMA + PREPARE)
SET @idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'order_batches'
    AND INDEX_NAME   = 'idx_order_batches_order'
);

SET @sql := IF(
  @idx_exists = 0,
  'ALTER TABLE `order_batches` ADD INDEX `idx_order_batches_order` (`order_id`);',
  'SELECT 1;'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) Vincolo logico su (order_id, batch_no) per evitare T2 duplicati
--    NB: MySQL non ha "ADD CONSTRAINT IF NOT EXISTS", quindi usiamo lo stesso trucco
SET @uniq_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'order_batches'
    AND CONSTRAINT_TYPE = 'UNIQUE'
    AND CONSTRAINT_NAME = 'uniq_order_batches_order_batch'
);

SET @sql2 := IF(
  @uniq_exists = 0,
  'ALTER TABLE `order_batches` ADD CONSTRAINT `uniq_order_batches_order_batch` UNIQUE (`order_id`, `batch_no`);',
  'SELECT 1;'
);

PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- ============================================================================
-- NOTE:
-- - Adattare BIGINT UNSIGNED se il tuo orders.id è di tipo diverso
-- - items_snapshot_json: se usi MariaDB vecchia senza JSON, puoi
--   cambiare in LONGTEXT e gestire JSON lato applicativo.
-- ============================================================================
