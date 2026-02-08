-- ============================================================================
-- FIX: colonne sezione comanda in print_settings
-- Eseguire manualmente se la sezione comanda non persiste
-- ============================================================================
-- Istruzioni: esegui una riga alla volta. Se "Duplicate column name" → colonna OK, passa alla successiva.

-- 1) Aggiungi colonne (MySQL 5.7: no IF NOT EXISTS)
ALTER TABLE print_settings ADD COLUMN comanda_layout VARCHAR(16) NOT NULL DEFAULT 'classic';
ALTER TABLE print_settings ADD COLUMN takeaway_center VARCHAR(16) NOT NULL DEFAULT 'pizzeria';
ALTER TABLE print_settings ADD COLUMN takeaway_copies INT NOT NULL DEFAULT 1;

-- 2) Verifica: SELECT * FROM print_settings WHERE id=1;
-- 3) Test UPDATE manuale:
--    UPDATE print_settings SET comanda_layout='mcd', takeaway_center='pizzeria', takeaway_copies=2 WHERE id=1;
