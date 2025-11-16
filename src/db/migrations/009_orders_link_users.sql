-- 009_orders_link_users.sql
-- Collego gli ordini agli utenti-clienti: FK soft (NULLable), idempotente.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_user_id BIGINT NULL;

ALTER TABLE orders
  ADD INDEX IF NOT EXISTS idx_orders_customer_user_id (customer_user_id);

-- (Opzionale) FK se il tuo MySQL/MariaDB lo consente senza conflitti:
-- ALTER TABLE orders
--   ADD CONSTRAINT IF NOT EXISTS fk_orders_user
--   FOREIGN KEY (customer_user_id) REFERENCES users(id);

-- Backfill "best effort": match per email o telefono o full_name
UPDATE orders o
JOIN users u
  ON (u.email IS NOT NULL AND u.email = o.email)
   OR (u.phone IS NOT NULL AND u.phone = o.phone)
   OR (u.full_name IS NOT NULL AND u.full_name = o.customer_name)
SET o.customer_user_id = u.id
WHERE o.customer_user_id IS NULL;
