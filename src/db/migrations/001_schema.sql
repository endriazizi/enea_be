-- 📄 Schema base “light”: products, orders, order_items
SET NAMES utf8mb4;
SET time_zone = '+00:00';

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;

CREATE TABLE products (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  ingredients TEXT,
  image_url VARCHAR(255),
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_active   ON products(is_active);

CREATE TABLE orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status ENUM('pending','confirmed','preparing','ready','completed') DEFAULT 'pending',
  total DECIMAL(10,2) NOT NULL,
  currency VARCHAR(5) DEFAULT 'EUR',
  customer_first VARCHAR(50),
  customer_last VARCHAR(50),
  phone VARCHAR(20),
  email VARCHAR(100),
  delivery_address VARCHAR(200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT,
  product_name VARCHAR(100),
  qty INT,
  price DECIMAL(10,2),
  notes VARCHAR(200),
  ingredients TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
