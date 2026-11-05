import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpires,
    algorithm: 'HS256',
  });
}

/**
 * Verifies the bearer token, then re-loads the user so that deactivation or a
 * role change takes effect immediately instead of when the token expires.
 */
export async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw unauthorized('Session expired or invalid, please sign in again');
  }

  const { rows } = await query(
    'SELECT id, name, email, role, title, weekly_capacity, active FROM users WHERE id = $1',
    [payload.sub],
  );
  const user = rows[0];
  if (!user || !user.active) throw unauthorized('Account is not active');
  req.user = user;
  next();
}

export const requireLead = (req, _res, next) => {
  if (req.user?.role !== 'lead') throw forbidden('Only a team lead can do that');
  next();
};
