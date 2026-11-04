import { DataTypes, Model } from 'sequelize';

export const ITEM_CONDITIONS = Object.freeze(['NEW', 'LIKE_NEW', 'GOOD', 'USED', 'FOR_PARTS']);

export class Item extends Model {}

export function defineItem(sequelize) {
  Item.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      title: {
        type: DataTypes.STRING(200),
        allowNull: false,
        validate: { notEmpty: { msg: 'title must not be empty' }, len: [3, 200] }
      },
      description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
      condition: {
        type: DataTypes.ENUM(...ITEM_CONDITIONS),
        allowNull: false,
        defaultValue: 'GOOD'
      },
      sellerId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } }
    },
    { sequelize, modelName: 'Item', tableName: 'items', indexes: [{ fields: ['sellerId'] }] }
  );
  return Item;
}

export default Item;