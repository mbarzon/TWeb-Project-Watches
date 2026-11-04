import { env } from '../config/env.js';

export function startClosingRunner() {
  // Placeholder until the auction engine lands.
  console.log('[closer] placeholder runner (sweep every %dms)', env.closerSweepIntervalMs);
  return { stop: () => {} };
}