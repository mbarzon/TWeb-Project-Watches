import { initDb } from '../../src/db/sequelize.js';
import { defineModels } from '../../src/models/index.js';
import { setDbContext, resetDbContext } from '../../src/db/context.js';
import { createApp } from '../../src/app.js';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { signToken } from '../../src/services/token.service.js';

/**
 * Bootstraps an isolated in-memory database + express app for one test file.
 * Returns { app, request, sequelize, models, helpers, teardown }.
 */
export async function bootTestApp({ withApp = true } = {}) {
  const sequelize = await initDb(':memory:');
  const models = defineModels(sequelize, { bcryptRounds: 4 });
  await sequelize.sync();
  setDbContext({ sequelize, models, bcryptRounds: 4 });

  const app = withApp ? createApp() : null;

  const api = withApp
    ? request(app)
    : null;

  const helpers = {
    bearer(user) {
      return { Authorization: `Bearer ${signToken({ userId: user.id, role: user.role })}` };
    },
    hash(password) {
      return bcrypt.hashSync(password, 4);
    },
    async user(overrides = {}) {
      const i = Math.floor(Math.random() * 1e9);
      return models.User.create({
        email: overrides.email ?? `${overrides.prefix ?? 'user'}${i}@test.dev`,
        passwordHash: overrides.password ?? bcrypt.hashSync('Password123!', 4),
        role: overrides.role
      });
    },
    /** Full login round-trip over HTTP (exercises the real credential path). */
    async loginToken(email, password = 'Password123!') {
      const res = await api.post('/api/auth/login').send({ email, password });
      if (res.status !== 200) return null;
      return res.body.token;
    },
    async bearerViaLogin(email, password = 'Password123!') {
      const token = await this.loginToken(email, password);
      return { Authorization: `Bearer ${token}` };
    }
  };

  return {
    sequelize,
    models,
    app,
    request: api,
    helpers,
    async teardown() {
      await sequelize.close();
      resetDbContext();
    }
  };
}