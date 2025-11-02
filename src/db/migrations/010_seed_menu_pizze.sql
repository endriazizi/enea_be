-- 010_seed_menu_pizze.sql
-- Inserisce prodotti con category_id corretto e in modo idempotente.
-- ⚠️ IMPORTANTE: sempre specificare le colonne in INSERT per evitare mismatch.
-- Stile: compatibile MySQL/MariaDB/DB Viewer, niente FK rigide qui.

SET @cat_rosse   := (SELECT id FROM categories WHERE name='PIZZE ROSSE'   LIMIT 1);
SET @cat_bianche := (SELECT id FROM categories WHERE name='PIZZE BIANCHE' LIMIT 1);
SET @cat_antip   := (SELECT id FROM categories WHERE name='ANTIPASTI'     LIMIT 1);

-- --- PIZZE ROSSE ------------------------------------------------------------
INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'MARINARA', 7.50, @cat_rosse, 1, 100
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='MARINARA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'MARGHERITA', 8.00, @cat_rosse, 1, 110
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='MARGHERITA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'NAPOLI', 9.00, @cat_rosse, 1, 120
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='NAPOLI');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'ROMANA', 9.00, @cat_rosse, 1, 130
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='ROMANA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'DIAVOLA', 9.00, @cat_rosse, 1, 140
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='DIAVOLA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'WURSTEL', 9.00, @cat_rosse, 1, 150
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='WURSTEL');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'TONNO', 9.00, @cat_rosse, 1, 160
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='TONNO');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'VEGETARIANA', 9.50, @cat_rosse, 1, 170
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='VEGETARIANA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'EMILY', 9.50, @cat_rosse, 1, 180
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='EMILY');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'LEONARDO', 9.50, @cat_rosse, 1, 190
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='LEONARDO');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'KLEDI', 9.50, @cat_rosse, 1, 200
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='KLEDI');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'APPETITOSA', 10.00, @cat_rosse, 1, 210
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='APPETITOSA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'CALABRESE', 10.00, @cat_rosse, 1, 220
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='CALABRESE');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'NORDICA', 10.00, @cat_rosse, 1, 230
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='NORDICA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'FRANCESCANA', 10.00, @cat_rosse, 1, 240
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='FRANCESCANA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'QUATTRO STAGIONI', 10.00, @cat_rosse, 1, 250
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='QUATTRO STAGIONI');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'CAPRICCIOSA', 11.00, @cat_rosse, 1, 260
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='CAPRICCIOSA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'SICILIANA', 11.00, @cat_rosse, 1, 270
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='SICILIANA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'STELIO', 11.00, @cat_rosse, 1, 280
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='STELIO');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'LA LANTERNA', 11.00, @cat_rosse, 1, 290
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='LA LANTERNA');

-- --- PIZZE BIANCHE ----------------------------------------------------------
INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'FOCACCIA', 6.50, @cat_bianche, 1, 300
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='FOCACCIA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'ZUCCHINE', 9.00, @cat_bianche, 1, 310
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='ZUCCHINE');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'QUATTRO FORMAGGI', 9.50, @cat_bianche, 1, 320
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='QUATTRO FORMAGGI');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'BOSCAIOLA', 9.50, @cat_bianche, 1, 330
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='BOSCAIOLA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'PATATOSA', 9.50, @cat_bianche, 1, 340
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='PATATOSA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'VERA', 9.50, @cat_bianche, 1, 350
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='VERA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'JENNY', 9.50, @cat_bianche, 1, 360
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='JENNY');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'TARTUFO', 9.50, @cat_bianche, 1, 370
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='TARTUFO');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'BIANCANEVE', 10.00, @cat_bianche, 1, 380
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='BIANCANEVE');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'MEDITERRANEA', 10.00, @cat_bianche, 1, 390
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='MEDITERRANEA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'PARMIGIANA', 10.00, @cat_bianche, 1, 400
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='PARMIGIANA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'ENDRI', 10.00, @cat_bianche, 1, 410
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='ENDRI');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'CONTADINA', 10.00, @cat_bianche, 1, 420
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='CONTADINA');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'MONTE BIANCO', 10.00, @cat_bianche, 1, 430
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='MONTE BIANCO');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'NADIA', 11.00, @cat_bianche, 1, 440
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='NADIA');

-- --- ANTIPASTI --------------------------------------------------------------
INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'Crostino misto', 6.50, @cat_antip, 1, 500
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Crostino misto');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'Bresaola rucola e grana', 9.50, @cat_antip, 1, 510
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Bresaola rucola e grana');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'Patate fritte', 5.50, @cat_antip, 1, 520
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Patate fritte');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'Olive all’ascolana', 5.50, @cat_antip, 1, 530
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Olive all’ascolana');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'Crocchette di pollo', 5.50, @cat_antip, 1, 540
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Crocchette di pollo');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'Crocchette di patate', 5.50, @cat_antip, 1, 550
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Crocchette di patate');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'Anelli di cipolla', 5.50, @cat_antip, 1, 560
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Anelli di cipolla');

INSERT INTO products (name, price, category_id, is_active, sort_order)
SELECT 'Fritto misto', 12.00, @cat_antip, 1, 570
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Fritto misto');
