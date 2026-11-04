import { defineUser, User, ROLES } from './user.js';
import { defineItem, Item, ITEM_CONDITIONS } from './item.js';
import { defineAuction, Auction, AUCTION_STATUSES } from './auction.js';
import { defineBid, Bid } from './bid.js';

const MODEL_ORDER = ['User', 'Item', 'Auction', 'Bid'];

export function defineModels(sequelize, { bcryptRounds } = {}) {
  const registered = {
    User: defineUser(sequelize, { bcryptRounds }),
    Item: defineItem(sequelize),
    Auction: defineAuction(sequelize),
    Bid: defineBid(sequelize)
  };

  // Associations
  Item.belongsTo(registered.User, {
    as: 'seller',
    foreignKey: { name: 'sellerId', allowNull: false }
  });
  Item.hasOne(registered.Auction, {
    as: 'auction',
    foreignKey: { name: 'itemId', allowNull: false }
  });

  Auction.belongsTo(registered.Item, {
    as: 'item',
    foreignKey: { name: 'itemId', allowNull: false }
  });
  Auction.belongsTo(registered.User, {
    as: 'seller',
    foreignKey: { name: 'sellerId', allowNull: false }
  });
  Auction.hasMany(registered.Bid, {
    as: 'bids',
    foreignKey: { name: 'auctionId', allowNull: false }
  });

  Bid.belongsTo(registered.Auction, {
    as: 'auction',
    foreignKey: { name: 'auctionId', allowNull: false }
  });
  Bid.belongsTo(registered.User, {
    as: 'bidder',
    foreignKey: { name: 'bidderId', allowNull: false }
  });

  return registered;
}

export async function syncModels(sequelize) {
  return sequelize.sync({ force: envForce() });
}

function envForce() {
  return process.env.DB_SYNC_FORCE === '1';
}

export { User, Item, Auction, Bid, ROLES, ITEM_CONDITIONS, AUCTION_STATUSES, MODEL_ORDER };