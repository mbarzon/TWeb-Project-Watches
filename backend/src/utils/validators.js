import { ApiError } from '../utils/appError.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Minimal, dependency-free validation core.
 * Spec per field: { type: string|integer|datetime|boolean, required, min, max,
 * email, enum }. Returns { values, errors }.
 */
export function runValidation(input, spec) {
  const errors = [];
  const out = {};
  const body = input !== null && typeof input === 'object' ? input : {};

  for (const [key, rules] of Object.entries(spec)) {
    const raw = body[key];

    if (raw === undefined || raw === null || raw === '') {
      if (rules.required) errors.push({ field: key, message: `${key} is required` });
      continue;
    }

    let value = raw;
    if (rules.type === 'string') {
      if (typeof value !== 'string') {
        errors.push({ field: key, message: `${key} must be a string` });
        continue;
      }
      value = rules.trim === false ? value : value.trim();
      if (rules.min !== undefined && value.length < rules.min) {
        errors.push({ field: key, message: `${key} must be at least ${rules.min} characters` });
      }
      if (rules.max !== undefined && value.length > rules.max) {
        errors.push({ field: key, message: `${key} must be at most ${rules.max} characters` });
      }
      if (rules.email && !EMAIL_RE.test(value)) {
        errors.push({ field: key, message: `${key} must be a valid email address` });
      }
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push({ field: key, message: `${key} must be one of: ${rules.enum.join(', ')}` });
      }
    } else if (rules.type === 'integer') {
      const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (!Number.isInteger(n)) {
        errors.push({ field: key, message: `${key} must be an integer` });
        continue;
      }
      if (rules.min !== undefined && n < rules.min) {
        errors.push({ field: key, message: `${key} must be >= ${rules.min}` });
      }
      if (rules.max !== undefined && n > rules.max) {
        errors.push({ field: key, message: `${key} must be <= ${rules.max}` });
      }
      value = n;
    } else if (rules.type === 'datetime') {
      const d = typeof value === 'string' ? new Date(value) : value;
      if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
        errors.push({ field: key, message: `${key} must be a valid ISO-8601 date` });
        continue;
      }
      value = d;
    } else if (rules.type === 'boolean') {
      if (typeof value !== 'boolean') {
        errors.push({ field: key, message: `${key} must be a boolean` });
        continue;
      }
    } else {
      // passthrough type
      value = raw;
    }

    out[key] = value;
  }

  return { values: out, errors };
}

/** Express middleware: validates req.body into req.validated. */
export function validateBody(spec) {
  return (req, _res, next) => {
    try {
      const { values, errors } = runValidation(req.body, spec);
      if (errors.length > 0) throw ApiError.validation(errors);
      req.validated = values;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Express middleware: validates req.query (all strings) into req.validated. */
export function validateQuery(spec) {
  return (req, _res, next) => {
    try {
      const { values, errors } = runValidation(req.query, spec);
      if (errors.length > 0) throw ApiError.validation(errors);
      req.validated = values;
      next();
    } catch (err) {
      next(err);
    }
  };
}