-- 040_seed_fry_antipasti_products.sql
-- ============================================================================
-- Seed prodotti fritti/antipasti standard se non esistono.
-- Usa la categoria ANTIPASTI esistente (009_seed_categories).
-- Idempotente: inserisce solo se nome non esiste già.
-- ============================================================================

-- Ottieni id categoria ANTIPASTI
SET @cat_id = (SELECT id FROM categories WHERE name = 'ANTIPASTI' LIMIT 1);

-- Se la categoria non esiste, usa NULL (best-effort)
INSERT INTO products (name, description, price, is_active, sort_order, category_id)
SELECT 'Patatine fritte', 'Porzione patatine fritte', 4.00, 1, 100, @cat_id
WHERE @cat_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM products WHERE name = 'Patatine fritte' LIMIT 1);

INSERT INTO products (name, description, price, is_active, sort_order, category_id)
SELECT 'Olive ascolane', 'Olive ascolane fritte', 5.50, 1, 101, @cat_id
WHERE @cat_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM products WHERE name = 'Olive ascolane' LIMIT 1);

INSERT INTO products (name, description, price, is_active, sort_order, category_id)
SELECT 'Crocchette', 'Crocchette di patate', 4.50, 1, 102, @cat_id
WHERE @cat_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM products WHERE name = 'Crocchette' LIMIT 1);

INSERT INTO products (name, description, price, is_active, sort_order, category_id)
SELECT 'Mozzarelline', 'Mozzarelline fritte', 6.00, 1, 103, @cat_id
WHERE @cat_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM products WHERE name = 'Mozzarelline' LIMIT 1);
