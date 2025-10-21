-- users ha la colonna phone?
SHOW COLUMNS FROM users LIKE 'phone';

-- reservations ha user_id e FK?
SHOW COLUMNS FROM reservations LIKE 'user_id';
SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_reservations_user_id';

-- backfill riuscito?
SELECT COUNT(*) AS senza_user FROM reservations WHERE user_id IS NULL;
SELECT COUNT(*) AS con_user FROM reservations WHERE user_id IS NOT NULL;
