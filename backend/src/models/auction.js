import { DataTypes, Model } from 'sequelize';

export const AUCTION_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  ACTIVE: 'ACTIVE',
  ENDED: 'ENDED',
  CANCELLED: 'CANCELLED'
});

/**
 * leaderId / leaderBidId intentionally carry NO foreign-key constraint:
 * auction & bid reference each other (auction ↔ bid would be circular).
 * Integrity of the leader is provable from the bids table itself; these
 * columns are a denormalized display convenience updated transactionally.
 */
export class Auction extends Model {}

export function defineAuction(sequelize) {
  Auction.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      itemId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'items', key: 'id' }
      },
      sellerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' }
      },
      status: {
        type: DataTypes.ENUM(Object.values(AUCTION_STATUSES)),
        allowNull: false,
        defaultValue: AUCTION_STATUSES.DRAFT
      },
      startPriceCents: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 }
      },
      minIncrementCents: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 }
      },
      startsAt: { type: DataTypes.DATE, allowNull: true },
      endsAt: { type: DataTypes.DATE, allowNull: true },
      leaderId: { type: DataTypes.INTEGER, allowNull: true },
      leaderBidId: { type: DataTypes.INTEGER, allowNull: true },
      closedAt: { type: DataTypes.DATE, allowNull: true }
    },
    {
      sequelize,
      modelName: 'Auction',
      tableName: 'auctions',
      indexes: [
        { fields: ['sellerId'] },
        { fields: ['status'] },
        { fields: ['endsAt'] },
        { fields: ['status', 'endsAt'] }
      ]
    }
  );
  return Auction;
}

export default Auction;