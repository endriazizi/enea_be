-- 010_create_or_fix_users.sql
-- Crea/adegua tabella users in modo idempotente: include 'phone' e indici unici.

START TRANSACTION;

CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `first_name` VARCHAR(100) NULL,
  `last_name`  VARCHAR(100) NULL,
  `email`      VARCHAR(191) NULL,
  `phone`      VARCHAR(40)  NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- add first_name se manca
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'first_name'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `users` ADD COLUMN `first_name` VARCHAR(100) NULL AFTER `id`;',
  'SELECT "users.first_name exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- add last_name se manca
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_name'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `users` ADD COLUMN `last_name` VARCHAR(100) NULL AFTER `first_name`;',
  'SELECT "users.last_name exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- add email se manca
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `users` ADD COLUMN `email` VARCHAR(191) NULL AFTER `last_name`;',
  'SELECT "users.email exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- add phone se manca (👈 necessario per evitare l’errore u.phone)
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `users` ADD COLUMN `phone` VARCHAR(40) NULL AFTER `email`;',
  'SELECT "users.phone exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- add created_at se manca
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'created_at'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `users` ADD COLUMN `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `phone`;',
  'SELECT "users.created_at exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- add updated_at se manca
SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'updated_at'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `users` ADD COLUMN `updated_at` TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`;',
  'SELECT "users.updated_at exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- unique index su email, se manca
SET @idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'uniq_users_email'
);
SET @sql := IF(@idx=0,
  'CREATE UNIQUE INDEX `uniq_users_email` ON `users` (`email`);',
  'SELECT "uniq_users_email exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- unique index su phone, se manca
SET @idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'uniq_users_phone'
);
SET @sql := IF(@idx=0,
  'CREATE UNIQUE INDEX `uniq_users_phone` ON `users` (`phone`);',
  'SELECT "uniq_users_phone exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

COMMIT;
