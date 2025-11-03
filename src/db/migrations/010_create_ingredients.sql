-- 010_create_ingredients.sql
-- Tabelle base ingredienti e tabella ponte prodotto↔ingrediente.
-- Niente DELIMITER/PROC, nessun FK (solo indici) per evitare errno 150.

CREATE TABLE IF NOT EXISTS ingredients (
  id         INT NOT NULL AUTO_INCREMENT,
  name       VARCHAR(100) NOT NULL,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ingredients_name (name)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_ingredients (
  product_id    INT NOT NULL,
  ingredient_id INT NOT NULL,
  is_default    TINYINT(1) NOT NULL DEFAULT 1,
  is_removable  TINYINT(1) NOT NULL DEFAULT 1,
  extra_price   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, ingredient_id),
  KEY idx_pi_product (product_id),
  KEY idx_pi_ingredient (ingredient_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- Nota: niente FOREIGN KEY in questa prima passata.
-- Quando verifichiamo i tipi (INT vs BIGINT/UNSIGNED) potremo aggiungerli con:
-- ALTER TABLE product_ingredients
--   ADD CONSTRAINT fk_pi_product    FOREIGN KEY (product_id)    REFERENCES products(id)    ON DELETE CASCADE,
--   ADD CONSTRAINT fk_pi_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE;
