import { Router } from 'express';
import { register, login } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../utils/validators.js';

const router = Router();

router.post(
  '/register',
  validateBody({
    email: { type: 'string', required: true, email: true, max: 254 },
    password: { type: 'string', required: true, min: 8, max: 72 }
  }),
  register
);

router.post(
  '/login',
  validateBody({
    email: { type: 'string', required: true, email: true },
    password: { type: 'string', required: true }
  }),
  login
);

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json({ user: req.user.hashedAttributes() });
  } catch (err) {
    next(err);
  }
});

export default router;