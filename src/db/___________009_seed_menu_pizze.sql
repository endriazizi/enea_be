-- 009_seed_menu_pizze.sql
-- Seed prodotti: Pizze Rosse, Pizze Bianche, Antipasti. Idempotente per 'name'.

-- Cache ID categorie
SET @cat_rosse   := (SELECT id FROM categories WHERE name='PIZZE ROSSE'   LIMIT 1);
SET @cat_bianche := (SELECT id FROM categories WHERE name='PIZZE BIANCHE' LIMIT 1);
SET @cat_antip   := (SELECT id FROM categories WHERE name='ANTIPASTI'     LIMIT 1);

-- ========== PIZZE ROSSE =====================================================
INSERT INTO products (category_id, name, description, price, is_active, sort_order)
SELECT @cat_rosse, 'MARINARA', 'pomodoro, aglio, olio, peperoncino, origano', 7.50, 1, 10
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='MARINARA');

INSERT INTO products SELECT @cat_rosse, 'MARGHERITA', 'pomodoro, mozzarella', 8.00, 1, 20
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='MARGHERITA');

INSERT INTO products SELECT @cat_rosse, 'NAPOLI', 'pomodoro, mozzarella, acciughe, origano', 9.00, 1, 30
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='NAPOLI');

INSERT INTO products SELECT @cat_rosse, 'ROMANA', 'pomodoro, mozzarella, capperi', 9.00, 1, 40
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='ROMANA');

INSERT INTO products SELECT @cat_rosse, 'DIAVOLA', 'pomodoro, mozzarella, salame piccante', 9.00, 1, 50
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='DIAVOLA');

INSERT INTO products SELECT @cat_rosse, 'WURSTEL', 'pomodoro, mozzarella, wurstel', 9.00, 1, 60
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='WURSTEL');

INSERT INTO products SELECT @cat_rosse, 'TONNO', 'pomodoro, mozzarella, tonno', 9.00, 1, 70
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='TONNO');

INSERT INTO products SELECT @cat_rosse, 'VEGETARIANA', 'pomodoro, mozzarella, melanzane, zucchine', 9.50, 1, 80
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='VEGETARIANA');

INSERT INTO products SELECT @cat_rosse, 'EMILY', 'pomodoro, mozzarella, mozzarella di bufala', 9.50, 1, 90
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='EMILY');

INSERT INTO products SELECT @cat_rosse, 'LEONARDO', 'pomodoro, mozzarella, wurstel, patate fritte', 9.50, 1, 100
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='LEONARDO');

INSERT INTO products SELECT @cat_rosse, 'KLEDI', 'pomodoro, mozzarella, salsiccia, wurstel', 9.50, 1, 110
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='KLEDI');

INSERT INTO products SELECT @cat_rosse, 'APPETITOSA', 'pomodoro, mozzarella, melanzane, pancetta, cipolla', 10.00, 1, 120
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='APPETITOSA');

INSERT INTO products SELECT @cat_rosse, 'CALABRESE', 'pomodoro, mozzarella, pancetta, funghi, cipolla, peperoncino', 10.00, 1, 130
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='CALABRESE');

INSERT INTO products SELECT @cat_rosse, 'NORDICA', 'pomodoro, mozzarella, radicchio, speck, mais', 10.00, 1, 140
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='NORDICA');

INSERT INTO products SELECT @cat_rosse, 'FRANCESCANA', 'pomodoro, mozzarella, funghi, prosciutto crudo', 10.00, 1, 150
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='FRANCESCANA');

INSERT INTO products SELECT @cat_rosse, 'QUATTRO STAGIONI', 'pomodoro, mozzarella, funghi, carciofini, prosciutto cotto', 10.00, 1, 160
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='QUATTRO STAGIONI');

INSERT INTO products SELECT @cat_rosse, 'CAPRICCIOSA', 'pomodoro, mozzarella, funghi, carciofini, prosciutto cotto, uovo', 11.00, 1, 170
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='CAPRICCIOSA');

INSERT INTO products SELECT @cat_rosse, 'SICILIANA', 'pomodoro, mozzarella, pomodoro a fette, rucola, mozzarella di bufala', 11.00, 1, 180
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='SICILIANA');

INSERT INTO products SELECT @cat_rosse, 'STELIO', 'pomodoro, mozzarella, funghi, rucola, prosciutto crudo, mozzarella di bufala', 11.00, 1, 190
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='STELIO');

INSERT INTO products SELECT @cat_rosse, 'LA LANTERNA', 'pomodoro, mozzarella, funghi, salsiccia, melanzane, zucchine, prosciutto crudo', 11.00, 1, 200
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='LA LANTERNA');

-- ========== PIZZE BIANCHE ===================================================
INSERT INTO products SELECT @cat_bianche, 'FOCACCIA', 'olio, sale, rosmarino o cipolla', 6.50, 1, 10
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='FOCACCIA');

INSERT INTO products SELECT @cat_bianche, 'ZUCCHINE', 'mozzarella, zucchine', 9.00, 1, 20
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='ZUCCHINE');

INSERT INTO products SELECT @cat_bianche, 'QUATTRO FORMAGGI', 'mozzarella, gorgonzola, emmenthal, grana', 9.50, 1, 30
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='QUATTRO FORMAGGI');

INSERT INTO products SELECT @cat_bianche, 'BOSCAIOLA', 'mozzarella, funghi, prosciutto cotto', 9.50, 1, 40
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='BOSCAIOLA');

INSERT INTO products SELECT @cat_bianche, 'PATATOSA', 'mozzarella, patate fritte, salsiccia', 9.50, 1, 50
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='PATATOSA');

INSERT INTO products SELECT @cat_bianche, 'VERA', 'mozzarella, rucola, funghi freschi, grana a scaglie', 9.50, 1, 60
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='VERA');

INSERT INTO products SELECT @cat_bianche, 'JENNY', 'mozzarella, zucchine, pancetta', 9.50, 1, 70
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='JENNY');

INSERT INTO products SELECT @cat_bianche, 'TARTUFO', 'mozzarella, salsiccia, salsa tartufata', 9.50, 1, 80
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='TARTUFO');

INSERT INTO products SELECT @cat_bianche, 'BIANCANEVE', 'mozzarella, prosciutto crudo', 10.00, 1, 90
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='BIANCANEVE');

INSERT INTO products SELECT @cat_bianche, 'MEDITERRANEA', 'mozzarella, rucola, pomodorini pachino, grana a scaglie', 10.00, 1, 100
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='MEDITERRANEA');

INSERT INTO products SELECT @cat_bianche, 'PARMIGIANA', 'mozzarella, melanzane, salsiccia, pomodoro a fette, grana a scaglie', 10.00, 1, 110
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='PARMIGIANA');

INSERT INTO products SELECT @cat_bianche, 'ENDRI', 'mozzarella, zucchine, salmone', 10.00, 1, 120
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='ENDRI');

INSERT INTO products SELECT @cat_bianche, 'CONTADINA', 'mozzarella, pomodoro a fette, prosciutto crudo', 10.00, 1, 130
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='CONTADINA');

INSERT INTO products SELECT @cat_bianche, 'MONTE BIANCO', 'mozzarella, prosciutto crudo, bocconcino di bufala al centro', 10.00, 1, 140
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='MONTE BIANCO');

INSERT INTO products SELECT @cat_bianche, 'NADIA', 'mozzarella, rucola, bresaola, pomodoro a fette, grana a scaglie', 11.00, 1, 150
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='NADIA');

-- ========== ANTIPASTI =======================================================
INSERT INTO products SELECT @cat_antip, 'Crostino misto', NULL, 6.50, 1, 10
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Crostino misto');

INSERT INTO products SELECT @cat_antip, 'Bresaola rucola e grana', NULL, 9.50, 1, 20
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Bresaola rucola e grana');

INSERT INTO products SELECT @cat_antip, 'Patate fritte', NULL, 5.50, 1, 30
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Patate fritte');

INSERT INTO products SELECT @cat_antip, 'Olive all’ascolana', NULL, 5.50, 1, 40
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Olive all’ascolana');

INSERT INTO products SELECT @cat_antip, 'Crocchette di pollo', NULL, 5.50, 1, 50
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Crocchette di pollo');

INSERT INTO products SELECT @cat_antip, 'Crocchette di patate', NULL, 5.50, 1, 60
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Crocchette di patate');

INSERT INTO products SELECT @cat_antip, 'Anelli di cipolla', NULL, 5.50, 1, 70
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Anelli di cipolla');

INSERT INTO products SELECT @cat_antip, 'Fritto misto', NULL, 12.00, 1, 80
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name='Fritto misto');
