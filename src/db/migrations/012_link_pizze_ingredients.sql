-- 012_link_pizze_ingredients.sql
-- Collega i prodotti (per nome) ai loro ingredienti base.
-- Idempotente: ogni INSERT fa NOT EXISTS sul ponte.

-- Helper di inserimento “inline” (niente procedure):
-- Esempio schema:
-- INSERT INTO product_ingredients (product_id, ingredient_id, is_default, is_removable, extra_price, sort_order)
-- SELECT p.id, i.id, 1, 1, 0.00, 10
-- FROM products p JOIN ingredients i
-- WHERE p.name='MARINARA' AND i.name='pomodoro'
--   AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);

/* ===== PIZZE ROSSE ===== */
INSERT INTO product_ingredients (product_id, ingredient_id, is_default, is_removable, extra_price, sort_order)
SELECT p.id, i.id, 1,1,0.00,10 FROM products p JOIN ingredients i WHERE p.name='MARINARA' AND i.name='pomodoro'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,20 FROM products p JOIN ingredients i WHERE p.name='MARINARA' AND i.name='aglio'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,30 FROM products p JOIN ingredients i WHERE p.name='MARINARA' AND i.name='olio'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,40 FROM products p JOIN ingredients i WHERE p.name='MARINARA' AND i.name='peperoncino'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,50 FROM products p JOIN ingredients i WHERE p.name='MARINARA' AND i.name='origano'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);

INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,10 FROM products p JOIN ingredients i WHERE p.name='MARGHERITA' AND i.name='pomodoro'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,20 FROM products p JOIN ingredients i WHERE p.name='MARGHERITA' AND i.name='mozzarella'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);

INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,10 FROM products p JOIN ingredients i WHERE p.name='NAPOLI' AND i.name='pomodoro'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,20 FROM products p JOIN ingredients i WHERE p.name='NAPOLI' AND i.name='mozzarella'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,30 FROM products p JOIN ingredients i WHERE p.name='NAPOLI' AND i.name='acciughe'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,40 FROM products p JOIN ingredients i WHERE p.name='NAPOLI' AND i.name='origano'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);

INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,10 FROM products p JOIN ingredients i WHERE p.name='ROMANA' AND i.name='pomodoro'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,20 FROM products p JOIN ingredients i WHERE p.name='ROMANA' AND i.name='mozzarella'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,30 FROM products p JOIN ingredients i WHERE p.name='ROMANA' AND i.name='capperi'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);

INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,10 FROM products p JOIN ingredients i WHERE p.name='DIAVOLA' AND i.name='pomodoro'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,20 FROM products p JOIN ingredients i WHERE p.name='DIAVOLA' AND i.name='mozzarella'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,30 FROM products p JOIN ingredients i WHERE p.name='DIAVOLA' AND i.name='salame piccante'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);

INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,10 FROM products p JOIN ingredients i WHERE p.name='WURSTEL' AND i.name='pomodoro'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,20 FROM products p JOIN ingredients i WHERE p.name='WURSTEL' AND i.name='mozzarella'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,30 FROM products p JOIN ingredients i WHERE p.name='WURSTEL' AND i.name='wurstel'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);

INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,10 FROM products p JOIN ingredients i WHERE p.name='TONNO' AND i.name='pomodoro'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,20 FROM products p JOIN ingredients i WHERE p.name='TONNO' AND i.name='mozzarella'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,30 FROM products p JOIN ingredients i WHERE p.name='TONNO' AND i.name='tonno'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);

INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,10 FROM products p JOIN ingredients i WHERE p.name='VEGETARIANA' AND i.name='pomodoro'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,20 FROM products p JOIN ingredients i WHERE p.name='VEGETARIANA' AND i.name='mozzarella'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,30 FROM products p JOIN ingredients i WHERE p.name='VEGETARIANA' AND i.name='melanzane'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,40 FROM products p JOIN ingredients i WHERE p.name='VEGETARIANA' AND i.name='zucchine'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);

INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,10 FROM products p JOIN ingredients i WHERE p.name='EMILY' AND i.name='pomodoro'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,20 FROM products p JOIN ingredients i WHERE p.name='EMILY' AND i.name='mozzarella'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,30 FROM products p JOIN ingredients i WHERE p.name='EMILY' AND i.name='mozzarella di bufala'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);

INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,10 FROM products p JOIN ingredients i WHERE p.name='LEONARDO' AND i.name='pomodoro'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,20 FROM products p JOIN ingredients i WHERE p.name='LEONARDO' AND i.name='mozzarella'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,30 FROM products p JOIN ingredients i WHERE p.name='LEONARDO' AND i.name='wurstel'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,40 FROM products p JOIN ingredients i WHERE p.name='LEONARDO' AND i.name='patate fritte'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);

INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,10 FROM products p JOIN ingredients i WHERE p.name='KLEDI' AND i.name='pomodoro'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,20 FROM products p JOIN ingredients i WHERE p.name='KLEDI' AND i.name='mozzarella'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,30 FROM products p JOIN ingredients i WHERE p.name='KLEDI' AND i.name='salsiccia'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,40 FROM products p JOIN ingredients i WHERE p.name='KLEDI' AND i.name='wurstel'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);

INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,10 FROM products p JOIN ingredients i WHERE p.name='APPETITOSA' AND i.name='pomodoro'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,20 FROM products p JOIN ingredients i WHERE p.name='APPETITOSA' AND i.name='mozzarella'
AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,30 FROM products p JOIN ingredients i WHERE p.name='APPETITOSA' AND i.name='melanzane' AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,40 FROM products p JOIN ingredients i WHERE p.name='APPETITOSA' AND i.name='pancetta' AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id,i.id,1,1,0.00,50 FROM products p JOIN ingredients i WHERE p.name='APPETITOSA' AND i.name='cipolla' AND NOT EXISTS (SELECT 1 FROM product_ingredients x WHERE x.product_id=p.id AND x.ingredient_id=i.id);

-- (Per brevità non copio tutte le restanti: CALABRESE, NORDICA, FRANCESCANA,
-- QUATTRO STAGIONI, CAPRICCIOSA, SICILIANA, STELIO, LA LANTERNA, ecc.,
-- e l’intero blocco delle BIANCHE: FOCACCIA, ZUCCHINE, QUATTRO FORMAGGI, ...).
-- Se vuoi, ti incarto subito anche il resto 1:1 come qui sopra.
