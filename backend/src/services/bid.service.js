import { getDb } from '../db/context.js';
import { ApiError } from '../utils/appError.js';

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