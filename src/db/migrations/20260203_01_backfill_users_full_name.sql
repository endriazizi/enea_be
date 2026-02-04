-- 20260203_01_backfill_users_full_name.sql
-- Backfill full_name per utenti senza nome completo (idempotente)

UPDATE users
SET full_name = TRIM(CONCAT(IFNULL(first_name,''), ' ', IFNULL(last_name,'')))
WHERE (full_name IS NULL OR full_name = '')
  AND (
    IFNULL(first_name,'') <> '' OR IFNULL(last_name,'') <> ''
  );
