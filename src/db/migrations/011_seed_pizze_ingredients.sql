-- 011_seed_pizze_ingredients.sql
-- Seed ingredienti master + collegamenti prodotto_ingredients per Pizze Rosse & Bianche
-- Idempotente (INSERT IGNORE + WHERE NOT EXISTS)
-- NOTE: i prodotti vengono cercati per UPPER(name) per essere robusti su maiuscole/minuscole

SET NAMES utf8mb4;

-- =========================
-- 1) Master INGREDIENTS
-- =========================
INSERT IGNORE INTO ingredients (name, is_active) VALUES
('pomodoro',1),
('aglio',1),
('olio',1),
('peperoncino',1),
('origano',1),
('mozzarella',1),
('acciughe',1),
('capperi',1),
('salame piccante',1),
('wurstel',1),
('tonno',1),
('melanzane',1),
('zucchine',1),
('mozzarella di bufala',1),
('patate fritte',1),
('salsiccia',1),
('pancetta',1),
('cipolla',1),
('funghi',1),
('radicchio',1),
('speck',1),
('mais',1),
('prosciutto crudo',1),
('carciofini',1),
('prosciutto cotto',1),
('uovo',1),
('pomodoro a fette',1),
('rucola',1),
('funghi freschi',1),
('grana a scaglie',1),
('gorgonzola',1),
('emmenthal',1),
('grana',1),
('salsa tartufata',1),
('pomodorini pachino',1),
('salmone',1),
('bocconcino di bufala',1),
('bresaola',1),
('rosmarino',1),
('sale',1);

-- helper per DRY (non è una procedura, solo commento):
-- pattern d’inserimento:
-- INSERT INTO product_ingredients (product_id, ingredient_id, is_default, is_removable, extra_price, sort_order)
-- SELECT p.id, i.id, 1, 1, 0, <ORD>
-- FROM products p JOIN ingredients i ON i.name='<ING>'
-- WHERE UPPER(p.name) = '<PRODOTTO>'
--   AND NOT EXISTS (SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- =========================
-- 2) PIZZE ROSSE
-- =========================

-- MARINARA: pomodoro, aglio, olio, peperoncino, origano
INSERT INTO product_ingredients (product_id, ingredient_id, is_default, is_removable, extra_price, sort_order)
SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='MARINARA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='aglio'
WHERE UPPER(p.name)='MARINARA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='olio'
WHERE UPPER(p.name)='MARINARA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='peperoncino'
WHERE UPPER(p.name)='MARINARA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 5 FROM products p JOIN ingredients i ON i.name='origano'
WHERE UPPER(p.name)='MARINARA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- MARGHERITA: pomodoro, mozzarella
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='MARGHERITA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='MARGHERITA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- NAPOLI: pomodoro, mozzarella, acciughe, origano
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='NAPOLI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='NAPOLI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='acciughe'
WHERE UPPER(p.name)='NAPOLI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='origano'
WHERE UPPER(p.name)='NAPOLI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- ROMANA: pomodoro, mozzarella, capperi
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='ROMANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='ROMANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='capperi'
WHERE UPPER(p.name)='ROMANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- DIAVOLA: pomodoro, mozzarella, salame piccante
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='DIAVOLA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='DIAVOLA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='salame piccante'
WHERE UPPER(p.name)='DIAVOLA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- WURSTEL: pomodoro, mozzarella, wurstel
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='WURSTEL' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='WURSTEL' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='wurstel'
WHERE UPPER(p.name)='WURSTEL' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- TONNO: pomodoro, mozzarella, tonno
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='TONNO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='TONNO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='tonno'
WHERE UPPER(p.name)='TONNO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- VEGETARIANA: pomodoro, mozzarella, melanzane, zucchine
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='VEGETARIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='VEGETARIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='melanzane'
WHERE UPPER(p.name)='VEGETARIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='zucchine'
WHERE UPPER(p.name)='VEGETARIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- EMILY: pomodoro, mozzarella, mozzarella di bufala
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='EMILY' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='EMILY' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='mozzarella di bufala'
WHERE UPPER(p.name)='EMILY' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- LEONARDO: pomodoro, mozzarella, wurstel, patate fritte
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='LEONARDO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='LEONARDO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='wurstel'
WHERE UPPER(p.name)='LEONARDO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='patate fritte'
WHERE UPPER(p.name)='LEONARDO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- KLEDI: pomodoro, mozzarella, salsiccia, wurstel
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='KLEDI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='KLEDI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='salsiccia'
WHERE UPPER(p.name)='KLEDI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='wurstel'
WHERE UPPER(p.name)='KLEDI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- APPETITOSA: pomodoro, mozzarella, melanzane, pancetta, cipolla
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='APPETITOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='APPETITOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='melanzane'
WHERE UPPER(p.name)='APPETITOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='pancetta'
WHERE UPPER(p.name)='APPETITOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 5 FROM products p JOIN ingredients i ON i.name='cipolla'
WHERE UPPER(p.name)='APPETITOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- CALABRESE: pomodoro, mozzarella, pancetta, funghi, cipolla, peperoncino
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='CALABRESE' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='CALABRESE' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='pancetta'
WHERE UPPER(p.name)='CALABRESE' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='funghi'
WHERE UPPER(p.name)='CALABRESE' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 5 FROM products p JOIN ingredients i ON i.name='cipolla'
WHERE UPPER(p.name)='CALABRESE' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 6 FROM products p JOIN ingredients i ON i.name='peperoncino'
WHERE UPPER(p.name)='CALABRESE' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- NORDICA: pomodoro, mozzarella, radicchio, speck, mais
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='NORDICA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='NORDICA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='radicchio'
WHERE UPPER(p.name)='NORDICA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='speck'
WHERE UPPER(p.name)='NORDICA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 5 FROM products p JOIN ingredients i ON i.name='mais'
WHERE UPPER(p.name)='NORDICA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- FRANCESCANA: pomodoro, mozzarella, funghi, prosciutto crudo
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='FRANCESCANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='FRANCESCANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='funghi'
WHERE UPPER(p.name)='FRANCESCANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='prosciutto crudo'
WHERE UPPER(p.name)='FRANCESCANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- QUATTRO STAGIONI: pomodoro, mozzarella, funghi, carciofini, prosciutto cotto
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='QUATTRO STAGIONI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='QUATTRO STAGIONI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='funghi'
WHERE UPPER(p.name)='QUATTRO STAGIONI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='carciofini'
WHERE UPPER(p.name)='QUATTRO STAGIONI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 5 FROM products p JOIN ingredients i ON i.name='prosciutto cotto'
WHERE UPPER(p.name)='QUATTRO STAGIONI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- CAPRICCIOSA: pomodoro, mozzarella, funghi, carciofini, prosciutto cotto, uovo
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='CAPRICCIOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='CAPRICCIOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='funghi'
WHERE UPPER(p.name)='CAPRICCIOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='carciofini'
WHERE UPPER(p.name)='CAPRICCIOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 5 FROM products p JOIN ingredients i ON i.name='prosciutto cotto'
WHERE UPPER(p.name)='CAPRICCIOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 6 FROM products p JOIN ingredients i ON i.name='uovo'
WHERE UPPER(p.name)='CAPRICCIOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- SICILIANA: pomodoro, mozzarella, pomodoro a fette, rucola, mozzarella di bufala
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='SICILIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='SICILIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='pomodoro a fette'
WHERE UPPER(p.name)='SICILIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='rucola'
WHERE UPPER(p.name)='SICILIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 5 FROM products p JOIN ingredients i ON i.name='mozzarella di bufala'
WHERE UPPER(p.name)='SICILIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- STELIO: pomodoro, mozzarella, funghi, rucola, prosciutto crudo, mozzarella di bufala
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='STELIO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='STELIO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='funghi'
WHERE UPPER(p.name)='STELIO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='rucola'
WHERE UPPER(p.name)='STELIO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 5 FROM products p JOIN ingredients i ON i.name='prosciutto crudo'
WHERE UPPER(p.name)='STELIO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 6 FROM products p JOIN ingredients i ON i.name='mozzarella di bufala'
WHERE UPPER(p.name)='STELIO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- LA LANTERNA: pomodoro, mozzarella, funghi, salsiccia, melanzane, zucchine, prosciutto crudo
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='pomodoro'
WHERE UPPER(p.name)='LA LANTERNA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='LA LANTERNA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='funghi'
WHERE UPPER(p.name)='LA LANTERNA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='salsiccia'
WHERE UPPER(p.name)='LA LANTERNA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 5 FROM products p JOIN ingredients i ON i.name='melanzane'
WHERE UPPER(p.name)='LA LANTERNA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 6 FROM products p JOIN ingredients i ON i.name='zucchine'
WHERE UPPER(p.name)='LA LANTERNA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 7 FROM products p JOIN ingredients i ON i.name='prosciutto crudo'
WHERE UPPER(p.name)='LA LANTERNA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- =========================
-- 3) PIZZE BIANCHE
-- =========================

-- FOCACCIA: olio, sale, rosmarino (default); cipolla (non default)
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='olio'
WHERE UPPER(p.name)='FOCACCIA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='sale'
WHERE UPPER(p.name)='FOCACCIA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='rosmarino'
WHERE UPPER(p.name)='FOCACCIA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients (product_id, ingredient_id, is_default, is_removable, extra_price, sort_order)
SELECT p.id, i.id, 0, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='cipolla'
WHERE UPPER(p.name)='FOCACCIA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- ZUCCHINE: mozzarella, zucchine
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='ZUCCHINE' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='zucchine'
WHERE UPPER(p.name)='ZUCCHINE' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- QUATTRO FORMAGGI: mozzarella, gorgonzola, emmenthal, grana
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='QUATTRO FORMAGGI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='gorgonzola'
WHERE UPPER(p.name)='QUATTRO FORMAGGI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='emmenthal'
WHERE UPPER(p.name)='QUATTRO FORMAGGI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='grana'
WHERE UPPER(p.name)='QUATTRO FORMAGGI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- BOSCAIOLA: mozzarella, funghi, prosciutto cotto
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='BOSCAIOLA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='funghi'
WHERE UPPER(p.name)='BOSCAIOLA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='prosciutto cotto'
WHERE UPPER(p.name)='BOSCAIOLA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- PATATOSA: mozzarella, patate fritte, salsiccia
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='PATATOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='patate fritte'
WHERE UPPER(p.name)='PATATOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='salsiccia'
WHERE UPPER(p.name)='PATATOSA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- VERA: mozzarella, rucola, funghi freschi, grana a scaglie
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='VERA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='rucola'
WHERE UPPER(p.name)='VERA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='funghi freschi'
WHERE UPPER(p.name)='VERA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='grana a scaglie'
WHERE UPPER(p.name)='VERA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- JENNY: mozzarella, zucchine, pancetta
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='JENNY' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='zucchine'
WHERE UPPER(p.name)='JENNY' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='pancetta'
WHERE UPPER(p.name)='JENNY' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- TARTUFO: mozzarella, salsiccia, salsa tartufata
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='TARTUFO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='salsiccia'
WHERE UPPER(p.name)='TARTUFO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='salsa tartufata'
WHERE UPPER(p.name)='TARTUFO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- BIANCANEVE: mozzarella, prosciutto crudo
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='BIANCANEVE' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='prosciutto crudo'
WHERE UPPER(p.name)='BIANCANEVE' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- MEDITERRANEA: mozzarella, rucola, pomodorini pachino, grana a scaglie
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='MEDITERRANEA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='rucola'
WHERE UPPER(p.name)='MEDITERRANEA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='pomodorini pachino'
WHERE UPPER(p.name)='MEDITERRANEA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='grana a scaglie'
WHERE UPPER(p.name)='MEDITERRANEA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- PARMIGIANA: mozzarella, melanzane, salsiccia, pomodoro a fette, grana a scaglie
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='PARMIGIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='melanzane'
WHERE UPPER(p.name)='PARMIGIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='salsiccia'
WHERE UPPER(p.name)='PARMIGIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='pomodoro a fette'
WHERE UPPER(p.name)='PARMIGIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 5 FROM products p JOIN ingredients i ON i.name='grana a scaglie'
WHERE UPPER(p.name)='PARMIGIANA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- ENDRI: mozzarella, zucchine, salmone
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='ENDRI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='zucchine'
WHERE UPPER(p.name)='ENDRI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='salmone'
WHERE UPPER(p.name)='ENDRI' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- CONTADINA: mozzarella, pomodoro a fette, prosciutto crudo
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='CONTADINA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='pomodoro a fette'
WHERE UPPER(p.name)='CONTADINA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='prosciutto crudo'
WHERE UPPER(p.name)='CONTADINA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- MONTE BIANCO: mozzarella, prosciutto crudo, bocconcino di bufala
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='MONTE BIANCO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='prosciutto crudo'
WHERE UPPER(p.name)='MONTE BIANCO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='bocconcino di bufala'
WHERE UPPER(p.name)='MONTE BIANCO' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);

-- NADIA: mozzarella, rucola, bresaola, pomodoro a fette, grana a scaglie
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 1 FROM products p JOIN ingredients i ON i.name='mozzarella'
WHERE UPPER(p.name)='NADIA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 2 FROM products p JOIN ingredients i ON i.name='rucola'
WHERE UPPER(p.name)='NADIA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 3 FROM products p JOIN ingredients i ON i.name='bresaola'
WHERE UPPER(p.name)='NADIA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 4 FROM products p JOIN ingredients i ON i.name='pomodoro a fette'
WHERE UPPER(p.name)='NADIA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
INSERT INTO product_ingredients SELECT p.id, i.id, 1, 1, 0, 5 FROM products p JOIN ingredients i ON i.name='grana a scaglie'
WHERE UPPER(p.name)='NADIA' AND NOT EXISTS(SELECT 1 FROM product_ingredients pi WHERE pi.product_id=p.id AND pi.ingredient_id=i.id);
