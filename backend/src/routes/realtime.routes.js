import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { sseEndpoint } from '../realtime/sseHub.js';

const router = Router();

// Live updates require an authenticated user (event authorization checks are
// part of the RTM verification evidence).
router.get('/global/events', requireAuth, sseEndpoint('global'));
router.get('/auctions/:id/events', requireAuth, sseEndpoint('auctions'));
router.get('/users/:id/events', requireAuth, sseEndpoint('users'));

export default router;