-- 011_reservations_add_user_id.sql
-- Aggiunge colonna user_id a reservations + FK verso users(id) (idempotente)

START TRANSACTION;

-- add colonna user_id se manca
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND COLUMN_NAME = 'user_id'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `reservations` ADD COLUMN `user_id` BIGINT NULL AFTER `id`;',
  'SELECT "reservations.user_id exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- add indice su user_id se manca
SET @idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations' AND INDEX_NAME = 'idx_reservations_user_id'
);
SET @sql := IF(@idx=0,
  'CREATE INDEX `idx_reservations_user_id` ON `reservations` (`user_id`);',
  'SELECT "idx_reservations_user_id exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- add foreign key se manca
SET @fk := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND CONSTRAINT_NAME = 'fk_reservations_user_id'
);
SET @sql := IF(@fk=0,
  'ALTER TABLE `reservations` ADD CONSTRAINT `fk_reservations_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE CASCADE ON DELETE SET NULL;',
  'SELECT "fk_reservations_user_id exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

COMMIT;
