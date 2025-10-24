// /api/auth — Login + Me (JWT HS256)
// Stile: log chiari, errori espliciti, dipendenze standard.

const express = require('express');
const router = express.Router();

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const env = require('../env');         // ✅ unica fonte di verità
const logger = require('../logger');   // ✅ winston
const { query } = require('../db');    // ✅ mysql2/promise pool
const requireAuth = require('../middleware/auth'); // Bearer verifier

// Helper robusto: crea JWT HS256
function signToken(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    roles: user.roles ? String(user.roles).split(',') : []
  };
  return jwt.sign(payload, env.JWT.secret, {
    algorithm: 'HS256',
    expiresIn: env.JWT.ttlSeconds
  });
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  logger.info('🔐 [AUTH] login ▶️', { email, hasPwd: !!password });

  if (!email || !password) {
    logger.warn('🔐 [AUTH] login ⚠️ missing fields', { email: !!email, password: !!password });
    return res.status(400).json({ error: 'missing_credentials' });
  }

  try {
    // 1) utente
    const rows = await query('SELECT * FROM users WHERE email=? LIMIT 1', [email]);
    const user = rows?.[0];

    if (!user) {
      logger.warn('🔐 [AUTH] login ❌ no_user', { email });
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    // 2) password (hash in colonna password_hash)
    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) {
      logger.warn('🔐 [AUTH] login ❌ bad_password', { userId: user.id });
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    // 3) JWT ready?
    if (!env.JWT || !env.JWT.secret) {
      logger.error('🔐 [AUTH] login 💥 misconfigured JWT', { jwtConfigured: !!env.JWT, hasSecret: !!(env.JWT && env.JWT.secret) });
      return res.status(500).json({ error: 'jwt_misconfigured' });
    }

    // 4) token + risposta "safe"
    const token = signToken(user);
    const safeUser = {
      id: user.id,
      email: user.email,
      name: user.name || user.full_name || null,
      roles: user.roles ? String(user.roles).split(',') : []
    };

    logger.info('🔐 [AUTH] login ✅', { userId: user.id });
    res.json({ token, user: safeUser });
  } catch (err) {
    logger.error('🔐 [AUTH] login 💥 error', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/auth/me (protetta)
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.sub || req.user?.id;
    const rows = await query('SELECT id, email, name, roles FROM users WHERE id=? LIMIT 1', [userId]);
    const user = rows?.[0] || null;
    if (!user) return res.status(404).json({ error: 'not_found' });
    res.json({
      id: user.id,
      email: user.email,
      name: user.name || null,
      roles: user.roles ? String(user.roles).split(',') : []
    });
  } catch (err) {
    logger.error('🔐 [AUTH] me 💥 error', { error: String(err) });
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
