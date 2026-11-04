import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sequelize } from 'sequelize';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const backendRoot = path.resolve(__dirname, '..', '..');

export function createDatabase(storage = undefined) {
  // Explicit ':memory:' in tests so every test process gets an isolated DB.
  const resolved =
    storage !== undefined
      ? storage
      : env.isTest
        ? ':memory:'
        : path.resolve(backendRoot, env.dbFile);

  return new Sequelize({
    dialect: 'sqlite',
    storage: resolved,
    logging: env.nodeEnv === 'development' && !env.isTest ? (sql) => console.debug(sql) : false
  });
}

// SQLite pragmas: WAL lets readers proceed during a write transaction and
// busy_timeout makes concurrent writers wait instead of failing instantly.
// PRAGMA foreign_keys is enabled by Sequelize's sqlite connection manager.
export async function applyPragmas(sequelize) {
  await sequelize.query('PRAGMA journal_mode = WAL');
  await sequelize.query('PRAGMA busy_timeout = 5000');
  return sequelize;
}

export async function initDb(storage = undefined) {
  const sequelize = createDatabase(storage);
  await sequelize.authenticate();
  if (sequelize.options.storage !== ':memory:') {
    await applyPragmas(sequelize);
  }
  return sequelize;
}

export async function closeDb(sequelize) {
  await sequelize.close();
}