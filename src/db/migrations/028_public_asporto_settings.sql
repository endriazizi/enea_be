-- 028_public_asporto_settings.sql
-- ============================================================================
-- Impostazioni pubbliche per /asporto (persistenza DB)
-- - Toggle servizio + modalità disponibili (asporto / domicilio)
-- - Orari slot e WhatsApp destinazione
-- ============================================================================

CREATE TABLE IF NOT EXISTS public_asporto_settings (
  id INT NOT NULL PRIMARY KEY,
  enable_public_asporto TINYINT(1) NOT NULL DEFAULT 1,
  public_whatsapp_to VARCHAR(40) NOT NULL DEFAULT '0737642142',
  asporto_start_time VARCHAR(5) NOT NULL DEFAULT '07:00',
  asporto_step_minutes INT NOT NULL DEFAULT 15,
  asporto_end_time VARCHAR(5) NOT NULL DEFAULT '23:00',
  public_asporto_allow_takeaway TINYINT(1) NOT NULL DEFAULT 1,
  public_asporto_allow_delivery TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- riga unica (id=1)
INSERT INTO public_asporto_settings (id)
VALUES (1)
ON DUPLICATE KEY UPDATE id = id;
