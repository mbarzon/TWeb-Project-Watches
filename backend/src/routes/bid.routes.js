import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../utils/validators.js';
import { placeBid } from '../services/bid.service.js';

const router = Router();

router.post('/:id/bids', requireAuth, validateBody({ amount: { type: 'string', required: true, min: 1 } }), async (req, res, next) => {
  try {
    const bid = await placeBid(req.params.id, { actorUser: req.user, amount: req.validated.amount });
    res.status(201).json({
      bid: {
        id: bid.id,
        auctionId: bid.auctionId,
        bidderId: bid.bidderId,
        amount: Number((bid.amountCents / 100).toFixed(2)),
        amountCents: bid.amountCents,
        createdAt: bid.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;