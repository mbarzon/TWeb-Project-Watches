import { env } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` }
  });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' }
    });
  }

  const known = err.name === 'ApiError' || (err.status && err.code);

  if (!known) {
    console.error('[error] unexpected:', {
      message: err.message,
      stack: err.stack,
      path: req?.originalUrl
    });
  }

  const status = known ? err.status : 500;
  const code = known ? err.code : 'INTERNAL_ERROR';
  const message = known ? err.message : 'Internal server error';
  const body = { error: { code, message } };

  // Never leak internals like stack traces or SQL errors to clients.
  if (err.details) body.error.details = err.details;
  if (!known && env.nodeEnv === 'development') body.error.cause = err.message;

  res.status(status).json(body);
}