-- 034_print_settings_comanda.sql
-- ============================================================================
-- Estensione print_settings per layout COMANDA + copie + centro takeaway
-- - aggiunge colonne nuove (idempotente)
-- - aggiorna riga unica (id=1) con default sicuri
-- ============================================================================

ALTER TABLE print_settings
  ADD COLUMN IF NOT EXISTS comanda_layout VARCHAR(16) NOT NULL DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS takeaway_center VARCHAR(16) NOT NULL DEFAULT 'pizzeria',
  ADD COLUMN IF NOT EXISTS takeaway_copies INT NOT NULL DEFAULT 1;

-- riga unica (id=1) con default (senza sovrascrivere valori già presenti)
INSERT INTO print_settings (
  id,
  comanda_layout,
  takeaway_center,
  takeaway_copies,
  takeaway_auto_print
)
VALUES (1, 'classic', 'pizzeria', 1, 1)
ON DUPLICATE KEY UPDATE
  comanda_layout = IFNULL(comanda_layout, 'classic'),
  takeaway_center = IFNULL(takeaway_center, 'pizzeria'),
  takeaway_copies = IFNULL(takeaway_copies, 1),
  takeaway_auto_print = IFNULL(takeaway_auto_print, 1);
