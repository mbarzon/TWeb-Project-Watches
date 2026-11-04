import express from 'express';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRouter from './routes/auth.routes.js';
import itemRouter from './routes/item.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRouter);
  app.use('/api/items', itemRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}