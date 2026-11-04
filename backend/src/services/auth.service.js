import bcrypt from 'bcryptjs';
import { getDb } from '../db/context.js';
import { ApiError } from '../utils/appError.js';
import { signToken } from './token.service.js';

export async function registerUser({ email, password }) {
  const { models, bcryptRounds } = await getDb();
  const existing = await models.User.findOne({ where: { email: email.toLowerCase() } });
  if (existing) {
    throw ApiError.conflict('EMAIL_TAKEN', 'An account with this email already exists');
  }
  const passwordHash = await bcrypt.hash(password, bcryptRounds);
  const user = await models.User.create({ email, passwordHash });
  return user.hashedAttributes();
}

export async function authenticate({ email, password }) {
  const { models } = await getDb();
  const user = await models.User.findOne({ where: { email: email.toLowerCase() } });
  if (!user || !(await user.verifyPassword(password))) {
    // Same message for unknown email and wrong password: no account enumeration.
    throw ApiError.unauthorized('Invalid credentials');
  }
  const token = signToken({ userId: user.id, role: user.role });
  return { user: user.hashedAttributes(), token };
}

export async function getUserById(id) {
  const { models } = await getDb();
  return models.User.findByPk(id);
}