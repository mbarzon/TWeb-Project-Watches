import { getDb } from '../db/context.js';
import { ApiError } from '../utils/appError.js';
import { Op } from 'sequelize';

const SORTABLE = {
  createdAt: 'createdAt',
  title: 'title'
};

export async function createItem({ sellerId, title, description, condition }) {
  const { models } = await getDb();
  return models.Item.create({ sellerId, title, description, condition });
}

export async function getItem(id) {
  const { models } = await getDb();
  const item = await models.Item.findByPk(id, {
    include: [{ association: 'auction', include: [`bids`] }]
  });
  if (!item) throw ApiError.notFound();
  return item;
}

export async function listItems({ q, sellerId, sort = 'createdAt', order = 'desc', page = 1, limit = 10 }) {
  const { models } = await getDb();

  const sortColumn = SORTABLE[sort];
  if (!sortColumn) throw ApiError.badRequest('INVALID_SORT', `sort must be one of ${Object.keys(SORTABLE).join(', ')}`);
  const dir = order === 'asc' ? 'ASC' : order === 'desc' ? 'DESC' : null;
  if (!dir) throw ApiError.badRequest('INVALID_ORDER', "order must be 'asc' or 'desc'");

  const where = {};
  if (q) where.title = { [Op.like]: `%${q}%` };
  if (sellerId) where.sellerId = sellerId;

  const { rows, count } = await models.Item.findAndCountAll({
    where,
    order: [[sortColumn, dir]],
    limit,
    offset: (page - 1) * limit,
    include: [{ association: 'auction' }]
  });

  return {
    data: rows,
    meta: { page, limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) }
  };
}

export async function updateItem(id, { user, changes }) {
  const { models } = await getDb();
  const item = await models.Item.findByPk(id);
  if (!item) throw ApiError.notFound();

  assertCanModify(user, item.sellerId);

  const allowed = {};
  for (const key of ['title', 'description', 'condition']) {
    if (changes[key] !== undefined) allowed[key] = changes[key];
  }
  await item.update(allowed);
  return item;
}

export async function deleteItem(id, { user }) {
  const { models } = await getDb();
  const item = await models.Item.findByPk(id, { include: [{ association: 'auction' }] });
  if (!item) throw ApiError.notFound();

  assertCanModify(user, item.sellerId);

  const auction = item.auction;
  if (auction && auction.status !== 'DRAFT' && auction.status !== 'CANCELLED') {
    throw ApiError.conflict(
      'ITEM_IN_ACTIVE_AUCTION',
      'Item is attached to a live auction and cannot be deleted'
    );
  }

  if (auction) {
    await auction.destroy();
  }
  await item.destroy();
  return { deleted: true, id: Number(id) };
}

export function assertCanModify(user, ownerId) {
  if (user.role === 'ADMIN') return;
  if (user.id !== ownerId) {
    throw ApiError.forbidden('You can only modify your own items');
  }
}