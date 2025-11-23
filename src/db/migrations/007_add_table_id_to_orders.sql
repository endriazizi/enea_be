-- 007_add_table_id_to_orders.sql
-- ============================================================================
-- Aggiunge table_id agli ordini per collegarli ai tavoli (preview da lista tavoli)
-- Compatibile MySQL/MariaDB, pensata per la tua catena di migrazioni.
-- ============================================================================

ALTER TABLE `orders`
  ADD COLUMN `table_id` BIGINT(20) NULL AFTER `scheduled_at`,
  ADD KEY `idx_orders_table_id` (`table_id`);

-- (Opzionale ma consigliato: FK verso tables.id, se vuoi rigidità referenziale)
-- ATTENZIONE: esegui questa parte solo se hai già la tabella `tables` con PK `id`
-- e non hai vincoli in conflitto.

-- ALTER TABLE `orders`
--   ADD CONSTRAINT `fk_orders_table`
--   FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`)
--   ON UPDATE CASCADE
--   ON DELETE SET NULL;
