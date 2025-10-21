-- 006_fk_rooms_tables.sql
-- Allinea il tipo e crea la FK tables.room_id → rooms.id
-- Nota: presuppone che non esista già una FK omonima

-- 1) Tipo coerente con rooms.id (BIGINT). Manteniamo NULL per consentire tavoli "non assegnati"
ALTER TABLE tables
  MODIFY COLUMN room_id BIGINT NULL;

-- 2) Bonifica eventuali riferimenti orfani (room_id senza stanza corrispondente)
UPDATE tables t
LEFT JOIN rooms r ON r.id = t.room_id
SET t.room_id = NULL
WHERE t.room_id IS NOT NULL AND r.id IS NULL;

-- 3) Crea la FK (se non esiste). Se ti desse errore di nome duplicato,
--    droppare prima la constraint con il nome reale da SHOW CREATE TABLE tables
ALTER TABLE tables
  ADD CONSTRAINT fk_tables_room
  FOREIGN KEY (room_id) REFERENCES rooms(id)
  ON DELETE SET NULL
  ON UPDATE CASCADE;
