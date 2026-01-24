/* =========================================================
   010_wa_messaging.sql
   - Tracciamo:
     1) ultimo inbound per numero (finestra 24h)
     2) mapping tra messaggio template inviato (sid) e reservation_id
   NOTE:
   - Compatibile MariaDB/MySQL
   - Timestamps in UTC (UTC_TIMESTAMP())
   ========================================================= */

CREATE TABLE IF NOT EXISTS wa_contacts (
  phone_e164       VARCHAR(32)  NOT NULL,
  wa_id            VARCHAR(64)  NULL,
  profile_name     VARCHAR(128) NULL,
  last_inbound_at  DATETIME     NOT NULL,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (phone_e164)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wa_messages (
  id              BIGINT NOT NULL AUTO_INCREMENT,
  sid             VARCHAR(64) NOT NULL,
  direction       ENUM('out','in') NOT NULL,
  kind            VARCHAR(64) NOT NULL,
  to_phone        VARCHAR(32) NULL,
  from_phone      VARCHAR(32) NULL,
  reservation_id  BIGINT NULL,
  status          VARCHAR(32) NULL,
  error_code      VARCHAR(32) NULL,
  error_message   VARCHAR(255) NULL,
  payload_json    TEXT NULL,
  created_at      DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_wa_messages_sid (sid),
  KEY idx_wa_messages_reservation (reservation_id),
  KEY idx_wa_messages_to (to_phone),
  KEY idx_wa_messages_from (from_phone),
  KEY idx_wa_messages_kind (kind),
  KEY idx_wa_messages_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
