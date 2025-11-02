-- 009_order_item_options.sql
-- Varianti riga d'ordine (aggiunte/rimozioni) per future UI:
-- - Salviamo cosa è stato aggiunto/rimosso a livello di singolo item
-- - Compatibile con DB Viewer: NESSUNA FK rigida (evitiamo errno:150)
-- - Indici su campi chiave per query rapide
-- - Idempotente

CREATE TABLE IF NOT EXISTS order_item_options (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_item_id BIGINT       NOT NULL,          -- riferimento logico a order_items.id (no FK per compatibilità)
  type          ENUM('add','remove') NOT NULL,  -- aggiunta o rimozione
  ingredient_id BIGINT       NULL,              -- opzionale: id ingrediente se mappato nel catalogo ingredienti
  name          VARCHAR(160) NULL,              -- nome “libero” dell’opzione (fallback testuale)
  price_delta   DECIMAL(10,2) NOT NULL DEFAULT 0.00, -- + / - sul prezzo riga
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Indici idempotenti via information_schema (DB Viewer safe)
SET @ix := (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'order_item_options'
              AND INDEX_NAME  = 'idx_oio_item');
SET @sql := IF(@ix = 0,
  'CREATE INDEX idx_oio_item ON order_item_options (order_item_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ix := (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'order_item_options'
              AND INDEX_NAME  = 'idx_oio_ingredient');
SET @sql := IF(@ix = 0,
  'CREATE INDEX idx_oio_ingredient ON order_item_options (ingredient_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ix := (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'order_item_options'
              AND INDEX_NAME  = 'idx_oio_type');
SET @sql := IF(@ix = 0,
  'CREATE INDEX idx_oio_type ON order_item_options (type)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Nota:
-- Se vorrai legare rigidamente con FK, usa la 010 opzionale (vedi sotto).
-- Qui teniamo il sistema robusto ai mismatch di tipo INT/BIGINT/UNSIGNED già presenti.
