import { Router } from 'express';
import { ApiError } from '../utils/appError.js';

const router = Router();

// Placeholder until the auth feature lands (next commit).
router.use((_req, _res, next) => next(ApiError.notFound('Auth routes not implemented yet')));

export default router;