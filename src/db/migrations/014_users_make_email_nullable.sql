-- 014_users_make_email_nullable.sql
START TRANSACTION;

-- Rendi email e phone nullable (idempotente di fatto se già lo sono)
ALTER TABLE `users` MODIFY `email` VARCHAR(191) NULL;
ALTER TABLE `users` MODIFY `phone` VARCHAR(40)  NULL;

COMMIT;
