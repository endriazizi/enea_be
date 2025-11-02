-- 008_catalog_core.sql
-- Catalogo prodotti + categorie (idempotente).
-- Stile: sicuro per MySQL/MariaDB & DB Viewer. Niente SET time_zone ecc.

-- ========== CATEGORIES ======================================================
CREATE TABLE IF NOT EXISTS categories (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  icon       VARCHAR(8)   NULL,
  sort_order INT          NOT NULL DEFAULT 0,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_categories_name (name)
);

-- ========== PRODUCTS ========================================================
CREATE TABLE IF NOT EXISTS products (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  category_id BIGINT       NULL,
  name        VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  price       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order  INT           NOT NULL DEFAULT 0,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NULL     DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
);

-- Indici utili (idempotenti)
ALTER TABLE products ADD INDEX IF NOT EXISTS idx_products_category (category_id);
ALTER TABLE products ADD INDEX IF NOT EXISTS idx_products_active   (is_active);
ALTER TABLE products ADD INDEX IF NOT EXISTS idx_products_sort     (sort_order, name);

-- Nota: FK non aggiunta per massima portabilità/robustezza in ambiente DB Viewer.
-- In futuro: ALTER TABLE products ADD CONSTRAINT fk_products_category ... (in 010_xxx.sql).
