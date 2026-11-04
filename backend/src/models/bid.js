import { DataTypes, Model } from 'sequelize';

/**
 * The UNIQUE index on (auctionId, amountCents) is the deepest layer of
 * the CON safety net: accepted bids within one auction can never share a
 * price, because every accepted bid must exceed the previous minimum.
 * If two same-price bids race, the database itself rejects the second one.
 */
export class Bid extends Model {}

export function defineBid(sequelize) {
  Bid.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      auctionId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'auctions', key: 'id' }
      },
      bidderId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' }
      },
      amountCents: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1 }
      },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    },
    {
      sequelize,
      modelName: 'Bid',
      tableName: 'bids',
      updatedAt: false,
      indexes: [
        { unique: true, name: 'bids_auction_price_unique', fields: ['auctionId', 'amountCents'] },
        { fields: ['auctionId'] },
        { fields: ['bidderId'] }
      ]
    }
  );
  return Bid;
}

export default Bid;