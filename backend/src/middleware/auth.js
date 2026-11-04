import { ApiError } from '../utils/appError.js';
import { extractBearerToken, verifyToken } from '../services/token.service.js';
import { getUserById } from '../services/auth.service.js';

/**
 * Server-side authentication: verifies JWT and reloads the user from the
 * database so permission checks see the CURRENT role (not a stale claim).
 */
export async function requireAuth(req, _res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) throw ApiError.unauthorized('Missing Bearer token');
    const payload = await verifyToken(token);
    if (!payload?.sub) throw ApiError.unauthorized('Invalid token payload');
    const user = await getUserById(payload.sub);
    if (!user) throw ApiError.unauthorized('User no longer exists');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Authentication is attempted if a token is present, but optional. */
export async function optionalAuth(req, _res, next) {
  try {
    const token = extractBearerToken(req);
    if (token) {
      const payload = await verifyToken(token);
      if (payload?.sub) req.user = await getUserById(payload.sub);
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    next();
  };
}