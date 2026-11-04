import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../utils/validators.js';
import { AUCTION_STATUSES } from '../models/index.js';
import {
  createAuction,
  listAuctions,
  getAuction,
  presentAuction,
  transitionAuction,
  getAuctionStats
} from '../services/auction.service.js';
import { listBids } from '../services/bid.service.js';

const router = Router();

const createSpec = {
  itemId: { type: 'integer', required: true, min: 1 },
  startPrice: { type: 'string', required: true, min: 1 },
  minIncrement: { type: 'string', required: true, min: 1 }
};

const listSpec = {
  status: { type: 'string', enum: Object.values(AUCTION_STATUSES) },
  q: { type: 'string', max: 100 },
  sort: { type: 'string', enum: ['createdAt', 'endsAt', 'startPrice'] },
  order: { type: 'string', enum: ['asc', 'desc'] },
  page: { type: 'integer', min: 1 },
  limit: { type: 'integer', min: 1, max: 100 }
};

const transitionsSpec = {
  to: { type: 'string', required: true, enum: Object.values(AUCTION_STATUSES) },
  startsAt: { type: 'datetime' },
  endsAt: { type: 'datetime' }
};

router.get('/', validateQuery(listSpec), async (req, res, next) => {
  try {
    res.json(await listAuctions(req.validated));
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, validateBody(createSpec), async (req, res, next) => {
  try {
    const auction = await createAuction({
      actor: req.user,
      itemId: req.validated.itemId,
      startPrice: req.validated.startPrice,
      minIncrement: req.validated.minIncrement
    });
    res.status(201).json({ auction: presentAuction(auction) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    res.json({ auction: presentAuction(await getAuction(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/stats', async (req, res, next) => {
  try {
    res.json(await getAuctionStats(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/bids', validateQuery({ page: { type: 'integer', min: 1 }, limit: { type: 'integer', min: 1, max: 100 } }), async (req, res, next) => {
  try {
    res.json(await listBids(req.params.id, req.validated));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/transitions', requireAuth, validateBody(transitionsSpec), async (req, res, next) => {
  try {
    const auction = await transitionAuction(req.params.id, {
      actorUser: req.user,
      to: req.validated.to,
      startsAt: req.validated.startsAt,
      endsAt: req.validated.endsAt
    });
    res.status(200).json({ auction: presentAuction(auction) });
  } catch (err) {
    next(err);
  }
});

export default router;