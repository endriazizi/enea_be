-- 007_users_customer_profile.sql
-- Estende la tabella `users` per usarla come anagrafica clienti con
-- telefono normalizzato, verifica e trust_score.

ALTER TABLE users
  ADD COLUMN phone_normalized VARCHAR(32) NULL AFTER phone,
  ADD COLUMN phone_verified_at DATETIME NULL AFTER phone_normalized,
  ADD COLUMN verification_channel ENUM('otp_sms','otp_whatsapp','manual_call','other') NULL AFTER phone_verified_at,
  ADD COLUMN trust_score TINYINT UNSIGNED NOT NULL DEFAULT 50 AFTER verification_channel;

-- Popola una prima versione "safe" di phone_normalized per ciò che già esiste
UPDATE users
SET phone_normalized =
  CASE
    WHEN phone IS NULL OR phone = '' THEN NULL
    ELSE REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '.', '')
  END
WHERE phone IS NOT NULL
  AND phone <> ''
  AND phone_normalized IS NULL;

-- Indice (NON univoco per non rischiare errori se hai duplicati reali)
ALTER TABLE users
  ADD INDEX idx_users_phone_normalized (phone_normalized);
