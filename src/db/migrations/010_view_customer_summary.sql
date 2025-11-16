-- 010_view_customer_summary.sql
-- Vista di sintesi: numero ordini, ultimo ordine, totale speso (calcolato via order_items)
CREATE OR REPLACE VIEW v_customer_order_summary AS
SELECT
  u.id                AS user_id,
  COUNT(DISTINCT o.id) AS orders_count,
  MAX(o.created_at)    AS last_order_at,
  COALESCE(SUM(oi.qty * oi.price),0) AS total_spent
FROM users u
LEFT JOIN orders o
  ON o.customer_user_id = u.id
LEFT JOIN order_items oi
  ON oi.order_id = o.id
GROUP BY u.id;
