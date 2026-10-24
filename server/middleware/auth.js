const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'qmat-dev-secret-change-in-prod';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    // Phase 2 (P2b): a supplier_id claim in a token is never trusted. For external roles
    // the value comes from the users row, read by the external gate (req.externalScope).
    if (user && typeof user === 'object') {
      delete user.supplier_id;
      if (req.externalScope) user.supplier_id = req.externalScope.supplierId;
    }
    req.user = user;
    next();
  });
}

module.exports = { authenticateToken, JWT_SECRET };