-- 014_users_auth_optional.sql
START TRANSACTION;

-- Password hash nullable (variante varbinary)
SET @needs := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'password_hash'
    AND IS_NULLABLE = 'NO'
);
SET @coltype := (
  SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'password_hash'
);

SET @sql := CASE
  WHEN @needs=0 THEN 'SELECT "users.password_hash already nullable";'
  WHEN @coltype LIKE 'varbinary(%)' THEN
    'ALTER TABLE `users` MODIFY `password_hash` VARBINARY(60) NULL;'
  ELSE
    'ALTER TABLE `users` MODIFY `password_hash` VARCHAR(255) NULL;'
END;

PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

COMMIT;
