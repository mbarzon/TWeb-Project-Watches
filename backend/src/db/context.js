import { initDb } from './sequelize.js';
import { defineModels, syncModels } from '../models/index.js';

let context = { sequelize: null, models: null, bcryptRounds: 10 };

export function setDbContext({ sequelize, models, bcryptRounds }) {
  context = { sequelize, models, bcryptRounds };
}

export function resetDbContext() {
  context = { sequelize: null, models: null, bcryptRounds: 10 };
}

export function getDbContext() {
  return context;
}

export async function getDb() {
  if (!context.sequelize) {
    const sequelize = await initDb();
    const models = defineModels(sequelize, { bcryptRounds: context.bcryptRounds });
    await syncModels(sequelize);
    setDbContext({ sequelize, models, bcryptRounds: context.bcryptRounds });
  }
  return context;
}