-- 007_reservations_add_status_note.sql
-- Aggiunge campi utili al tracciamento "corrente" sul record principale.
-- Idempotente: crea colonne solo se mancanti.


START TRANSACTION;


-- Colonna testo motivazione "corrente" (ultima azione)
SET @col_exists := (
SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'status_note'
);
SET @sql := IF(@col_exists = 0,
'ALTER TABLE `reservations` ADD COLUMN `status_note` TEXT NULL AFTER `status`;',
'SELECT "reservations.status_note esiste già";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


-- Timestamp dell'ultima modifica di stato
SET @col2_exists := (
SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'status_changed_at'
);
SET @sql := IF(@col2_exists = 0,
'ALTER TABLE `reservations` ADD COLUMN `status_changed_at` TIMESTAMP NULL AFTER `status_note`;',
'SELECT "reservations.status_changed_at esiste già";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;


COMMIT;