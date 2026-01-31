-- 030_order_category_visibility.sql
-- ============================================================================
-- Visibilità categorie per contesto (new order / asporto / domicilio)
-- - categories_json = NULL => mostra tutte
-- - categories_json = []   => nasconde tutte
-- ============================================================================

CREATE TABLE IF NOT EXISTS order_category_visibility (
  context VARCHAR(32) NOT NULL PRIMARY KEY,
  categories_json TEXT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO order_category_visibility (context, categories_json)
VALUES
  ('order_new', NULL),
  ('asporto', NULL),
  ('domicilio', NULL)
ON DUPLICATE KEY UPDATE context = context;
