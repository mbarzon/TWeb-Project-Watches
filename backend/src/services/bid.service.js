import { publish } from '../realtime/eventBus.js';
import { getDb } from '../db/context.js';
import { ApiError } from '../utils/appError.js';
import { toCents, fromCents } from '../utils/money.js';
import { bidMutex } from '../utils/mutex.js';
import { Transaction } from 'sequelize';
import { minimumBidCentsFor } from './auction.service.js';
import { AUCTION_STATUSES as S } from '../models/index.js';

/**
 * CON package core: bid acceptance under concurrency.
 *
 * Layers of defense against over-allocation / lost updates:
 *  0. Per-auction cooperative mutex: since SQLite is single-writer, one
 *     writer transaction per auction at a time (other auctions unaffected).
 *  1. BEGIN IMMEDIATE transaction: snapshot-serialized rule evaluation.
 *  2. Rule re-check inside the transaction against the committed max bid.
 *  3. DB-level UNIQUE(auctionId, amountCents): even a buggy path can never
 *     persist two bids at the same price in one auction.
 */
export async function placeBid(auctionId, { actorUser, amount }) {
  if (!actorUser) throw ApiError.unauthorized();

  const cents = toCents(amount);
  if (!Number.isInteger(cents) || cents <= 0) {
    throw ApiError.validation([{ field: 'amount', message: 'amount must be a positive number' }]);
  }

  const { models } = await getDb();

  // Per-auction cooperative lock: one writer transaction per auction at a
  // time (SQLite is single-writer; see ADR con-transactions.md).
  const result = await bidMutex.runExclusive(`auction:${auctionId}`, () =>
    models.Auction.sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (tx) => {
      const auction = await models.Auction.findByPk(auctionId, { transaction: tx });
      if (!auction) throw ApiError.notFound();

      if (auction.status === S.ACTIVE && auction.endsAt !== null) {
        // Deadline invariant: server clock only, never trusts clients.
        if (auction.endsAt.getTime() <= Date.now()) {
          throw ApiError.conflict('BID_DEADLINE_PASSED', 'This auction has already ended', {
            endedAt: auction.endsAt
          });
        }
      }
      if (auction.status !== S.ACTIVE) {
        throw ApiError.conflict('AUCTION_NOT_ACTIVE', `Bids are only accepted on ACTIVE auctions (current status: ${auction.status})`, {
          status: auction.status
        });
      }

      if (auction.sellerId === actorUser.id) {
        throw ApiError.forbidden('You cannot bid on your own auction');
      }

      const agg = await models.Bid.findOne({
        where: { auctionId },
        attributes: [[models.Bid.sequelize.fn('MAX', models.Bid.sequelize.col('amountCents')), 'max']],
        transaction: tx
      });
      const maxBidCents = agg?.get('max') ?? null;
      const minimum = minimumBidCentsFor(auction, maxBidCents);

      if (cents < minimum) {
        throw ApiError.conflict('BID_TOO_LOW', 'Bid does not meet the current minimum', {
          currentMinimum: Number(fromCents(minimum)),
          currentMinimumCents: minimum
        });
      }

      // Everything passed: persist the bid + update the leader atomically.
      const bid = await models.Bid.create(
        { auctionId, bidderId: actorUser.id, amountCents: cents },
        { transaction: tx }
      );
      await auction.update(
        { leaderId: actorUser.id, leaderBidId: bid.id },
        { transaction: tx }
      );
      return { auction, bid, previousLeaderId: maxBidCents === null ? null : auction.leaderId };
    })
  );

  const { bid, auction, previousLeaderId } = result;

  // Realtime fan-out AFTER commit (events must never announce state the DB
  // has not persisted). Sequenced by bid.id for client-side ordering/RTM.
  const payload = {
    type: 'bid.accepted',
    auctionId: Number(auctionId),
    bidId: bid.id,
    seq: bid.id,
    amountCents: bid.amountCents,
    bidderId: bid.bidderId,
    status: auction.status
  };
  publish(`auction:${auctionId}`, payload);

  if (previousLeaderId && previousLeaderId !== actorUser.id) {
    publish(`user:${previousLeaderId}`, {
      type: 'outbid',
      auctionId: Number(auctionId),
      byBidId: bid.id,
      seq: bid.id,
      amountCents: bid.amountCents
    });
  }

  return bid;
}

export async function getBidById(id) {
  const { models } = await getDb();
  return models.Bid.findByPk(id);
}

export async function listBids(auctionId, { page = 1, limit = 10 }) {
  const { models } = await getDb();
  const auction = await models.Auction.findByPk(auctionId);
  if (!auction) throw ApiError.notFound();

  const { rows, count } = await models.Bid.findAndCountAll({
    where: { auctionId },
    order: [['amountCents', 'DESC']], // persisted history: leader first
    limit,
    offset: (page - 1) * limit,
    include: [{ association: 'bidder', attributes: ['id', 'email'] }]
  });

  return {
    data: rows.map((b) => ({
      id: b.id,
      auctionId: b.auctionId,
      bidder: { id: b.bidder.id, email: b.bidder.email },
      amount: b.amountCents / 100,
      amountCents: b.amountCents,
      createdAt: b.createdAt
    })),
    meta: { page, limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) }
  };
}