-- 20260203_03_google_contacts_upsert.sql
-- Colonne users per sync Google + tabella conflitti (idempotente)

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'google_resource_name'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `users` ADD COLUMN `google_resource_name` VARCHAR(255) NULL AFTER `phone`;',
  'SELECT "users.google_resource_name exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'google_etag'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `users` ADD COLUMN `google_etag` VARCHAR(255) NULL AFTER `google_resource_name`;',
  'SELECT "users.google_etag exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'google_sync_at'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `users` ADD COLUMN `google_sync_at` TIMESTAMP NULL AFTER `google_etag`;',
  'SELECT "users.google_sync_at exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'google_sync_hash'
);
SET @sql := IF(@col=0,
  'ALTER TABLE `users` ADD COLUMN `google_sync_hash` VARCHAR(64) NULL AFTER `google_sync_at`;',
  'SELECT "users.google_sync_hash exists";'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS google_contact_conflicts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  local_snapshot_json TEXT NULL,
  google_snapshot_json TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_google_contact_conflicts_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
