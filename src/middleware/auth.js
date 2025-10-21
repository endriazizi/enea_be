const jwt = require('jsonwebtoken');
const env = require('../env');

/**
 * 🔐 Middleware JWT: richiede Authorization: Bearer <token>
 * - Valida il token
 * - Espone req.auth con i claim (sub, roles, iat, exp)
 * - 401 se assente/invalidato/scaduto
 */
module.exports = function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const [scheme, token] = h.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'NO_TOKEN', message: 'Missing bearer token' });
  }
  try {
    req.auth = jwt.verify(token, env.JWT.secret); // { sub, roles, iat, exp }
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Invalid or expired token' });
  }
};
