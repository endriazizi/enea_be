
-- 009_cleanup_reservations_status_columns.sql
-- Pulisce la colonna errata e garantisce le colonne corrette su reservations.
-- Idempotente: controlla INFORMATION_SCHEMA prima di alterare.

START TRANSACTION;

-- 1) Drop della colonna con typo se presente
SET @has_bad := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'status_changus_note'
);
SET @sql := IF(@has_bad = 1,
  'ALTER TABLE `reservations` DROP COLUMN `status_changus_note`;',
  'SELECT "ok: reservations.status_changus_note non presente";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2) Assicura status_note (se mancasse)
SET @has_note := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'status_note'
);
SET @sql := IF(@has_note = 0,
  'ALTER TABLE `reservations` ADD COLUMN `status_note` TEXT NULL AFTER `status`;',
  'SELECT "ok: reservations.status_note esiste già";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3) Assicura status_changed_at (se mancasse)
SET @has_changed := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'status_changed_at'
);
SET @sql := IF(@has_changed = 0,
  'ALTER TABLE `reservations` ADD COLUMN `status_changed_at` TIMESTAMP NULL AFTER `status_note`;',
  'SELECT "ok: reservations.status_changed_at esiste già";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

COMMIT;
