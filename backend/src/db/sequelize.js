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
//
// CRITICAL (CON): Sequelize's sqlite dialect opens a NEW connection per
// transaction. Pragmas are per-connection in SQLite, so we must apply
// busy_timeout to every transaction connection or concurrent BEGIN IMMEDIATE
// attempts fail with SQLITE_BUSY instead of queueing on the write lock.
export async function applyPragmas(sequelize) {
  const connectionManager = sequelize.connectionManager;
  const originalGetConnection = connectionManager.getConnection.bind(connectionManager);

  connectionManager.getConnection = async function getConnectionWithPragmas(options = {}) {
    const connection = await originalGetConnection(options);
    const isTransactionConnection = Boolean(options?.uuid && options.uuid !== 'default');
    if (isTransactionConnection && !connection.__pragmasApplied) {
      connection.run('PRAGMA busy_timeout = 5000');
      connection.__pragmasApplied = true;
    }
    return connection;
  };

  // The persistent default connection: WAL is a persistent file property,
  // so setting it once on the file is enough for all future connections.
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