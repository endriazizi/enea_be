-- 007_add_price_extra_to_ingredients.sql
-- Aggiunge il prezzo per l'uso come EXTRA (globale)
ALTER TABLE ingredients
  ADD COLUMN price_extra DECIMAL(10,2) NULL AFTER is_active;

-- opzionale: default a 0.00
-- UPDATE ingredients SET price_extra = 0.00 WHERE price_extra IS NULL;

-- indice facoltativo
-- ALTER TABLE ingredients ADD INDEX idx_ingredients_active (is_active);
