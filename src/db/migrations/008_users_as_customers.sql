-- 008_users_as_customers.sql
-- Clienti = tabella `users`. Aggiungo colonne "customer-friendly" solo se mancano.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS full_name      VARCHAR(120) NULL AFTER id,
  ADD COLUMN IF NOT EXISTS phone          VARCHAR(30)  NULL,
  ADD COLUMN IF NOT EXISTS note           TEXT         NULL,
  ADD COLUMN IF NOT EXISTS tags           VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS is_active      TINYINT(1)   NOT NULL DEFAULT 1;

-- Indici utili per ricerca rapida
ALTER TABLE users
  ADD INDEX IF NOT EXISTS idx_users_phone (phone),
  ADD INDEX IF NOT EXISTS idx_users_email (email),
  ADD INDEX IF NOT EXISTS idx_users_full_name (full_name);
