-- 008_reservation_audit.sql
-- Crea la tabella di audit. Idempotente.

CREATE TABLE IF NOT EXISTS `reservation_audit` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `reservation_id` BIGINT NOT NULL,
  `old_status` ENUM('pending','accepted','rejected','cancelled') NOT NULL,
  `new_status` ENUM('pending','accepted','rejected','cancelled') NOT NULL,
  `reason` TEXT NULL,
  `user_id` BIGINT NULL,
  `user_email` VARCHAR(191) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_audit_reservation_id_created_at` (`reservation_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
