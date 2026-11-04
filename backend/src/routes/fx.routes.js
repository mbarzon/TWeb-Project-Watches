import { Router } from 'express';
import { validateQuery } from '../utils/validators.js';
import { ApiError } from '../utils/appError.js';
import { getDb } from '../db/context.js';
import { convert } from '../services/fx.service.js';
import { getAuction } from '../services/auction.service.js';

const router = Router();

/**
 * External integration endpoint: renders the leading price of an auction
 * in a target currency via the Frankfurter service (contract documented in
 * docs/packages/external-integration.md). Public read; no auth necessary
 * (no sensitive data disclosed; rates are public data).
 */
router.get('/:id/price', validateQuery({ currency: { type: 'string', required: true, min: 3, max: 3 } }), async (req, res, next) => {
  try {
    const auction = await getAuction(req.params.id);
    const { models } = await getDb();

    const agg = await models.Bid.findOne({
      where: { auctionId: auction.id },
      attributes: [[models.Bid.sequelize.fn('MAX', models.Bid.sequelize.col('amountCents')), 'max']]
    });
    const maxBidCents = agg?.get('max') ?? null;
    const amountCents = maxBidCents ?? auction.startPriceCents;

    try {
      const result = await convert({ amountCents, currency: req.validated.currency });
      res.json({
        auctionId: auction.id,
        amountCents,
        amount: amountCents / 100,
        ...result
      });
    } catch (err) {
      if (err.status === 503) {
        next(new ApiError(503, 'EXTERNAL_UNAVAILABLE', 'Currency service temporarily unavailable; try again later'));
      } else {
        next(err);
      }
    }
  } catch (err) {
    next(err);
  }
});

export default router;