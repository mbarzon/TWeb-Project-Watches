import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/appError.js';

export function signToken({ userId, role, expiresIn = env.jwtExpiresIn }) {
  return jwt.sign({ sub: userId, role }, env.jwtSecret, { expiresIn });
}

export async function verifyToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Token expired');
    }
    throw ApiError.unauthorized('Invalid token');
  }
}

export function extractBearerToken(req) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token === '' ? null : token;
}