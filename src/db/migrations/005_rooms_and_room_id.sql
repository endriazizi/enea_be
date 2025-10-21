-- 005_rooms_and_room_id.sql
-- 🛠️ Collega i tavoli alle sale:
--   - Crea tabella rooms (se non esiste)
--   - Aggiunge room_id a tables (se non esiste)
--   - Crea indice su tables(room_id)
--   - Crea "Sala Principale" e collega i tavoli esistenti con room_id=1 (soft default)
-- Nota: usiamo IF NOT EXISTS per essere idempotenti su MariaDB/MySQL recenti.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 1) Tabella ROOMS (light)
CREATE TABLE IF NOT EXISTS rooms (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order INT          NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Aggiunge room_id ai TAVOLI (nullable)
ALTER TABLE tables
  ADD COLUMN IF NOT EXISTS room_id INT NULL AFTER id;

-- 3) Indice utile per join/filtri
CREATE INDEX IF NOT EXISTS idx_tables_room ON tables(room_id);

-- 4) Se non c'è almeno una sala, creane una di default
INSERT INTO rooms (name, is_active, sort_order)
SELECT 'Sala Principale', 1, 0
WHERE NOT EXISTS (SELECT 1 FROM rooms);

-- 5) Backfill: collega i tavoli senza sala alla "Sala Principale" (id=1)
UPDATE tables
SET room_id = 1
WHERE room_id IS NULL;
