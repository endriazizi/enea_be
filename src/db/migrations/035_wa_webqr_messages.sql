-- 035_wa_webqr_messages.sql
-- -----------------------------------------------------------------------------
-- Messaggi ricevuti da WhatsApp WebQR (Baileys) — persistenza per cronologia
-- e sopravvivenza al riavvio del server.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wa_webqr_messages (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  message_id VARCHAR(64) NOT NULL,
  ts BIGINT NOT NULL,
  from_jid VARCHAR(128) NULL,
  from_number VARCHAR(32) NULL,
  push_name VARCHAR(255) NULL,
  text VARCHAR(1024) NULL,
  raw_type VARCHAR(64) NULL,
  has_media TINYINT(1) NOT NULL DEFAULT 0,
  media_type VARCHAR(32) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wa_webqr_messages_session_msg (session_id, message_id),
  KEY ix_wa_webqr_messages_session_ts (session_id, ts DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
