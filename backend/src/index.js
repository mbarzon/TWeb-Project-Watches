import { createApp } from './app.js';
import { env, assertProductionSecrets } from './config/env.js';
import { startClosingRunner } from './jobs/closingRunner.js';

async function main() {
  assertProductionSecrets();
  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[auction-platform] listening on :${env.port} (${env.nodeEnv})`);
  });
  server.on('close', () => {
    console.log('[auction-platform] server closed');
  });
  process.on('SIGINT', () => server.close());
  process.on('SIGTERM', () => server.close());
}

main().catch((err) => {
  console.error('[auction-platform] failed to start:', err);
  process.exit(1);
});