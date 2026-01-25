-- 007_wa_tracking.sql
-- -----------------------------------------------------------------------------
-- Tracking WhatsApp (Twilio) - best effort
-- - wa_contacts: ultimo inbound per finestra 24h
-- - wa_messages: mapping SID template -> reservation_id + status callback
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wa_contacts (
  id BIGINT NOT NULL AUTO_INCREMENT,
  phone_e164 VARCHAR(32) NOT NULL,
  wa_id VARCHAR(64) NULL,
  profile_name VARCHAR(128) NULL,
  last_inbound_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wa_contacts_phone (phone_e164)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wa_messages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  sid VARCHAR(64) NOT NULL,
  direction VARCHAR(8) NOT NULL,         -- 'in' | 'out'
  kind VARCHAR(64) NULL,                 -- 'reservation_confirm' | 'status_change' | 'free_text' | ...
  to_phone VARCHAR(32) NULL,
  from_phone VARCHAR(32) NULL,
  reservation_id BIGINT NULL,
  status VARCHAR(32) NULL,               -- queued/sent/delivered/failed...
  error_code VARCHAR(32) NULL,
  error_message VARCHAR(255) NULL,
  payload_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wa_messages_sid (sid),
  KEY ix_wa_messages_resv (reservation_id),
  KEY ix_wa_messages_to (to_phone),
  KEY ix_wa_messages_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
