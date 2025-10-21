-- Sostituisci {{HASH}} con l'hash bcrypt della tua password (es. 'secret')
-- Genera: node -e "console.log(require('bcryptjs').hashSync('secret', 10))"
INSERT INTO users (email, password_hash, name, roles, is_active)
VALUES ('admin@demo.it', '{{HASH}}', 'Admin', 'admin', 1);
