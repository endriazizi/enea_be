-- 007_google_tokens.sql  (idempotente)
-- Tabella per persistere i token Google. Modello "owner='default'" → nessun user_id.
CREATE TABLE IF NOT EXISTS google_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner VARCHAR(50) NOT NULL DEFAULT 'default',
  access_token TEXT NULL,
  refresh_token TEXT NULL,
  scope TEXT NULL,
  token_type VARCHAR(50) NULL,
  expiry_date BIGINT NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_google_tokens_owner (owner)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
