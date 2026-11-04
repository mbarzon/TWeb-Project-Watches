import { env } from '../config/env.js';
import { getDb } from '../db/context.js';
import { Op } from 'sequelize';
import { publish, CHANNELS } from '../realtime/eventBus.js';
import { bidMutex } from '../utils/mutex.js';
import { assertTransition } from '../services/auctionStateMachine.js';
import { AUCTION_STATUSES as S } from '../models/index.js';

/**
 * Auction closing runner (part of the multistate workflow: ACTIVE -> ENDED).
 *
 * Sweeps auctions whose endsAt passed and closes them inside a serialized
 * (IMMEDIATE) transaction per auction, guarded by the same per-auction mutex
 * as bids so a closing aution never races an in-flight bid commit.
 *
 * Winner determination is DETERMINISTIC: the highest accepted bid wins;
 * on equal amounts (cannot persist within an auction anyway) the earliest
 * bid (lowest id) wins — but the DB unique index makes ties impossible.
 */
let sweepHandle = null;

export function startClosingRunner({ intervalMs = env.closerSweepIntervalMs } = {}) {
  if (sweepHandle) return currentRunner();
  const state = { stop: () => {}, count: 0 };
  const tick = async () => {
    try {
      state.count += await closeDueAuctions();
    } catch (err) {
      console.error('[closer] sweep failed:', err.message);
    }
  };
  sweepHandle = setInterval(tick, intervalMs);
  state.stop = () => clearInterval(sweepHandle);
  return state;
}

export function stopClosingRunner() {
  if (sweepHandle) clearInterval(sweepHandle);
  sweepHandle = null;
}

export function currentRunner() {
  return sweepHandle ? { stop: stopClosingRunner, count: 0 } : null;
}

export async function closeDueAuctions({ now = new Date() } = {}) {
  const { models } = await getDb();

  // Lazy fallback invariant: any overdue ACTIVE auction, even if the timer
  // was down, is closeable on the next sweep.
  const due = await models.Auction.findAll({
    where: { status: S.ACTIVE, endsAt: { [Op.ne]: null, [Op.lte]: now } },
    limit: 50,
    order: [['endsAt', 'ASC']]
  });

  for (const auction of due) {
    try {
      await closeAuction(auction.id, { now });
    } catch (err) {
      console.error(`[closer] failed to close auction ${auction.id}:`, err.message);
    }
  }
  return due.length;
}

export async function closeAuction(auctionId, { now = new Date(), adminUser = null } = {}) {
  const { models } = await getDb();

  return bidMutex
    .runExclusive(`auction:${auctionId}`, () =>
      models.Auction.sequelize.transaction({ type: 'IMMEDIATE' }, async (tx) => {
        const auction = await models.Auction.findByPk(auctionId, { transaction: tx });
        if (!auction) return null;

        // Deadline invariant enforced through the EXPLICIT state machine
        // (ACTIVE -> ENDED, SYSTEM actor, precondition: endsAt <= now).
        assertTransition({
          from: auction.status,
          to: S.ENDED,
          actor: 'SYSTEM',
          now,
          context: { endsAt: auction.endsAt }
        });

      const topBids = await models.Bid.findAll({
        where: { auctionId },
        order: [
          ['amountCents', 'DESC'],
          ['id', 'ASC'] // deterministic tie-break by server-issued sequence
        ],
        limit: 1,
        transaction: tx
      });
      const winnerBid = topBids[0] ?? null; // auction possible without bids

      await auction.update(
        {
          status: S.ENDED,
          closedAt: now,
          leaderId: winnerBid ? winnerBid.bidderId : null,
          leaderBidId: winnerBid ? winnerBid.id : null
        },
        { transaction: tx }
      );

      return { auction: auction.get({ plain: true }), winnerBid: winnerBid?.get({ plain: true }) ?? null };
      })
    )
    .catch((err) => {
      // A not-yet-due (or already closed) auction is not an error for the
      // runner: the state machine precondition simply blocks the transition.
      if (err?.code === 'PRECONDITION_FAILED') return null;
      throw err;
    })
    .then((result) => {
    if (!result) return null;
    // fan out AFTER commit
    publish(CHANNELS.auction(auctionId), {
      type: 'auction.closed',
      auctionId: Number(auctionId),
      seq: Date.now(),
      winner: result.winnerBid
        ? { bidderId: result.winnerBid.bidderId, amountCents: result.winnerBid.amountCents }
        : null
    });
    if (result.winnerBid) {
      publish(CHANNELS.user(result.winnerBid.bidderId), {
        type: 'auction.won',
        auctionId: Number(auctionId),
        amountCents: result.winnerBid.amountCents,
        bidId: result.winnerBid.id
      });
    }
    return result;
  });
}