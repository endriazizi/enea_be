-- 010_order_item_options_fk.sql
-- FK opzionali su order_item_options:
-- Applica solo se i tipi combaciano (niente errori in avvio).
-- Puoi eseguire/committare quando hai allineato tipi e indici nelle tabelle target.

-- Controllo tipo order_items.id
SET @oi_col := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'id'
  LIMIT 1
);

-- Controllo tipo order_item_options.order_item_id
SET @oio_col := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_item_options'
    AND COLUMN_NAME = 'order_item_id'
  LIMIT 1
);

-- Se i tipi combaciano (uguali al 100%), aggiungo FK su order_items(id)
SET @sql := IF(@oi_col IS NOT NULL AND @oio_col IS NOT NULL AND @oi_col = @oio_col AND
               (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'order_item_options'
                   AND CONSTRAINT_NAME = 'fk_oio_item') = 0,
  'ALTER TABLE order_item_options
     ADD CONSTRAINT fk_oio_item
     FOREIGN KEY (order_item_id) REFERENCES order_items(id)
     ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Se esiste una tabella ingredients con id compatibile, aggiungo anche quella FK
SET @ing_col := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ingredients'
    AND COLUMN_NAME = 'id'
  LIMIT 1
);

SET @oio_ing_col := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'order_item_options'
    AND COLUMN_NAME = 'ingredient_id'
  LIMIT 1
);

SET @sql := IF(@ing_col IS NOT NULL AND @oio_ing_col IS NOT NULL AND @ing_col = @oio_ing_col AND
               (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'order_item_options'
                   AND CONSTRAINT_NAME = 'fk_oio_ingredient') = 0,
  'ALTER TABLE order_item_options
     ADD CONSTRAINT fk_oio_ingredient
     FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
     ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
