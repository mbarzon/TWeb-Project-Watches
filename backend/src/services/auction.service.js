import { getDb } from '../db/context.js';
import { ApiError } from '../utils/appError.js';
import { Op, fn, col } from 'sequelize';
import { toCents, fromCents } from '../utils/money.js';
import { assertCanModify } from './item.service.js';
import { assertTransition, actorFor } from './auctionStateMachine.js';
import { AUCTION_STATUSES as S } from '../models/index.js';
import { Transaction } from 'sequelize';

const SORTABLE = {
  createdAt: 'createdAt',
  endsAt: 'endsAt',
  startPrice: 'startPriceCents'
};

export function presentAuction(auction) {
  const plain = auction.get({ plain: true });
  const item = plain.item;
  return {
    id: plain.id,
    status: plain.status,
    startPrice: Number(fromCents(plain.startPriceCents)),
    startPriceCents: plain.startPriceCents,
    minIncrement: Number(fromCents(plain.minIncrementCents)),
    minIncrementCents: plain.minIncrementCents,
    startsAt: plain.startsAt,
    endsAt: plain.endsAt,
    closedAt: plain.closedAt,
    leader: plain.leaderId ? { userId: plain.leaderId, bidId: plain.leaderBidId } : null,
    sellerId: plain.sellerId,
    item
  };
}

export async function createAuction({ actor, itemId, startPrice, minIncrement }) {
  const errors = [];
  if (!itemId) errors.push({ field: 'itemId', message: 'itemId is required' });

  const startCents = toCents(startPrice ?? NaN);
  const incCents = toCents(minIncrement ?? NaN);

  if (!Number.isInteger(startCents) || startCents <= 0) {
    errors.push({ field: 'startPrice', message: 'startPrice must be a positive amount' });
  }
  if (!Number.isInteger(incCents) || incCents <= 0) {
    errors.push({ field: 'minIncrement', message: 'minIncrement must be a positive amount' });
  }
  if (errors.length > 0) throw ApiError.validation(errors);

  const { models } = await getDb();
  const item = await models.Item.findByPk(itemId, { include: [{ association: 'auction' }] });
  if (!item) throw ApiError.notFound();

  assertCanModify(actor, item.sellerId); // only the item's owner auctions their item

  if (item.auction) {
    throw ApiError.conflict('AUCTION_EXISTS', 'This item already has an auction');
  }

  const auction = await models.Auction.create({
    itemId: item.id,
    sellerId: item.sellerId,
    startPriceCents: startCents,
    minIncrementCents: incCents,
    status: S.DRAFT
  });
  return getAuction(auction.id);
}

const LIST_INCLUDE = [{ association: 'item' }];

export async function listAuctions({ status, q, sort = 'createdAt', order = 'desc', page = 1, limit = 10 }) {
  const sortColumn = SORTABLE[sort];
  if (!sortColumn) throw ApiError.badRequest('INVALID_SORT', `sort must be one of ${Object.keys(SORTABLE).join(', ')}`);
  if (!['asc', 'desc'].includes(order)) throw ApiError.badRequest('INVALID_ORDER', "order must be 'asc' or 'desc'");
  if (!Object.values(S).includes(status) && status !== undefined) {
    throw ApiError.badRequest('INVALID_STATUS', `status must be one of ${Object.values(S).join(', ')}`);
  }

  const { models } = await getDb();
  const where = {};
  if (status) where.status = status;

  const { rows, count } = await models.Auction.findAndCountAll({
    where,
    include: [
      ...LIST_INCLUDE,
      ...(q ? [{ association: 'item', where: { title: { [Op.like]: `%${q}%` } }, required: true }] : [])
    ],
    order: [[sortColumn, order === 'asc' ? 'ASC' : 'DESC']],
    limit,
    offset: (page - 1) * limit,
    distinct: true
  });

  return {
    data: rows.map(presentAuction),
    meta: { page, limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) }
  };
}

export async function getAuction(id) {
  const { models } = await getDb();
  const auction = await models.Auction.findByPk(id, {
    include: [{ association: 'item' }]
  });
  if (!auction) throw ApiError.notFound();
  return auction;
}

/** Current minimum a bid must meet: startPrice without bids, else max + increment. */
export function minimumBidCentsFor(auction, maxBidCents) {
  return maxBidCents === null ? auction.startPriceCents : maxBidCents + auction.minIncrementCents;
}

export async function getAuctionStats(id) {
  const { models } = await getDb();
  const auction = await getAuction(id);
  const agg = await models.Bid.findOne({
    where: { auctionId: auction.id },
    attributes: [[fn('MAX', col('amountCents')), 'max']]
  });
  const maxBid = agg?.get('max') ?? null;
  return {
    auctionId: auction.id,
    bidCount: await models.Bid.count({ where: { auctionId: auction.id } }),
    maxBidCents: maxBid,
    minimumBidCents: minimumBidCentsFor(auction, maxBid),
    status: auction.status
  };
}

/**
 * Applies a transition after running it through the state machine.
 * `to` is the ONLY decision variable; everything else is a precondition.
 */
export async function transitionAuction(auctionId, { actorUser, to, startsAt, endsAt, system = false }) {
  if (!Object.values(S).includes(to)) {
    throw ApiError.validation([{ field: 'to', message: 'to must be a valid auction status' }]);
  }

  const { models } = await getDb();

  return models.Auction.sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (tx) => {
    const auction = await models.Auction.findByPk(auctionId, { transaction: tx });
    if (!auction) throw ApiError.notFound();

    const actor = system ? 'SYSTEM' : actorFor(actorUser);
    if (system) {
      if (to !== S.ENDED) throw ApiError.forbidden('SYSTEM may only close auctions');
    } else {
      if (!actorUser) throw ApiError.unauthorized();
      // object-level: only the auction's own seller (or an admin) may transition
      if (actor === 'SELLER' && auction.sellerId !== actorUser.id) {
        throw ApiError.forbidden('Only the auction seller can manage this auction');
      }
    }

    const ctx = {
      startsAt: startsAt ?? auction.startsAt,
      endsAt: endsAt ?? auction.endsAt,
      now: new Date()
    };
    assertTransition({ from: auction.status, to, actor, context: ctx });

    const updates = { status: to };
    if (to === S.SCHEDULED) {
      if (startsAt) updates.startsAt = ctx.startsAt;
      if (endsAt) updates.endsAt = ctx.endsAt;
    }
    if (to === S.CANCELLED) {
      const bidCount = await models.Bid.count({ where: { auctionId: auction.id }, transaction: tx });
      if (bidCount > 0) {
        throw ApiError.conflict('AUCTION_HAS_BIDS', 'Auction has bids and cannot be cancelled');
      }
    }
    if (to === S.ENDED) {
      updates.closedAt = ctx.now;
    }
    await auction.update(updates, { transaction: tx });
    return auction;
  });
}