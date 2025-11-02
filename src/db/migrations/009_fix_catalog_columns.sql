-- 009_fix_catalog_columns.sql
-- Allinea lo schema "catalogo" PRIMA dei seed.
-- - Garantisce che categories abbia is_active
-- - Garantisce che products abbia category_id (e colonne base)
-- - Idempotente e sicuro per MySQL/MariaDB/DB Viewer

-- === CATEGORIES (crea tabella base se manca) ================================
CREATE TABLE IF NOT EXISTS categories (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  icon       VARCHAR(8)   NULL,
  sort_order INT NOT NULL DEFAULT 9999,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Aggiungi is_active se assente
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'is_active'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE categories ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER icon',
  'SELECT 1');
PREPARE x FROM @sql; EXECUTE x; DEALLOCATE PREPARE x;

-- === PRODUCTS (crea tabella base se manca) ==================================
CREATE TABLE IF NOT EXISTS products (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(160) NOT NULL,
  price      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 9999,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Aggiungi category_id se assente (+ indice)
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'category_id'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE products ADD COLUMN category_id BIGINT NULL AFTER price',
  'SELECT 1');
PREPARE y FROM @sql; EXECUTE y; DEALLOCATE PREPARE y;

SET @ix := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND INDEX_NAME = 'idx_products_category'
);
SET @sql := IF(@ix = 0,
  'CREATE INDEX idx_products_category ON products (category_id)',
  'SELECT 1');
PREPARE z FROM @sql; EXECUTE z; DEALLOCATE PREPARE z;
