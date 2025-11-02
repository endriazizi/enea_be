-- 009_seed_categories.sql
-- Seed categorie di base. Idempotente.

INSERT INTO categories (name, icon, sort_order, is_active)
SELECT 'PIZZE ROSSE', '🍅', 10, 1
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='PIZZE ROSSE');

INSERT INTO categories (name, icon, sort_order, is_active)
SELECT 'PIZZE BIANCHE', '🧀', 20, 1
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='PIZZE BIANCHE');

INSERT INTO categories (name, icon, sort_order, is_active)
SELECT 'ANTIPASTI', '🥟', 30, 1
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='ANTIPASTI');
