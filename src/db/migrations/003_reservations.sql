-- 📄 003_reservations.sql — Tavoli e Prenotazioni (light)
SET NAMES utf8mb4;
SET time_zone = '+00:00';

DROP TABLE IF EXISTS reservations;
DROP TABLE IF EXISTS tables;

CREATE TABLE tables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_number INT UNIQUE NOT NULL,
  seats INT DEFAULT 4,
  status ENUM('free','reserved','occupied') DEFAULT 'free',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE reservations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_first VARCHAR(50),
  customer_last  VARCHAR(50),
  phone          VARCHAR(20),
  email          VARCHAR(100),
  party_size     INT NOT NULL,
  start_at       DATETIME NOT NULL,
  end_at         DATETIME NOT NULL,
  notes          VARCHAR(200),
  status ENUM('pending','accepted','rejected','cancelled') DEFAULT 'pending',
  client_token   VARCHAR(100),
  table_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_res_table FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_res_status ON reservations(status);
CREATE INDEX idx_res_start  ON reservations(start_at);

INSERT INTO tables (table_number, seats, status) VALUES
(1,4,'free'),(2,4,'free'),(3,4,'free'),(4,4,'free'),
(5,4,'free'),(6,4,'free'),(7,6,'free'),(8,6,'free'),
(9,2,'free'),(10,2,'free');
