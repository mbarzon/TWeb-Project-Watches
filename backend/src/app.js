import express from 'express';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRouter from './routes/auth.routes.js';
import itemRouter from './routes/item.routes.js';
import auctionRouter from './routes/auction.routes.js';
import bidRouter from './routes/bid.routes.js';
import fxRouter from './routes/fx.routes.js';
import realtimeRouter from './routes/realtime.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRouter);
  app.use('/api/items', itemRouter);
  app.use('/api/auctions', auctionRouter);
  app.use('/api/auctions', bidRouter);
  app.use('/api/auctions', fxRouter);
  app.use('/api', realtimeRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}