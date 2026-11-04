import 'dotenv/config';

const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback) => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 3000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-insecure-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  bcryptRounds: int(process.env.BCRYPT_ROUNDS, 10),
  dbFile: process.env.DB_FILE ?? 'data/auctions.sqlite',
  fxBaseUrl: process.env.FX_BASE_URL ?? 'https://api.frankfurter.dev/v1',
  fxTimeoutMs: int(process.env.FX_TIMEOUT_MS, 2000),
  fxCacheTtlMs: int(process.env.FX_CACHE_TTL_MS, 60000),
  fxRetries: int(process.env.FX_RETRIES, 2),
  sseHeartbeatMs: int(process.env.SSE_HEARTBEAT_MS, 15000),
  sseBufferSize: int(process.env.SSE_BUFFER_SIZE, 500),
  closerSweepIntervalMs: int(process.env.CLOSER_SWEEP_INTERVAL_MS, 1000),
  isTest: bool(process.env.NODE_TEST, false)
};

export function assertProductionSecrets() {
  if (env.nodeEnv === 'production' && env.jwtSecret === 'dev-insecure-secret') {
    throw new Error('JWT_SECRET must be set in production');
  }
}