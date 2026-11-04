import { DataTypes, Model } from 'sequelize';
import bcrypt from 'bcryptjs';

export const ROLES = Object.freeze({ USER: 'USER', ADMIN: 'ADMIN' });

export class User extends Model {
  verifyPassword(plain) {
    return bcrypt.compare(plain, this.passwordHash);
  }

  hashedAttributes() {
    // Returns raw attribute values (excludes the hash from API responses).
    const values = this.get({ plain: true });
    delete values.passwordHash;
    return values;
  }
}

export function defineUser(sequelize, { bcryptRounds = 10 } = {}) {
  User._bcryptRounds = bcryptRounds;
  User.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        set(value) {
          this.setDataValue('email', String(value).trim().toLowerCase());
        },
        validate: { isEmail: { msg: 'email must be a valid address' } }
      },
      passwordHash: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { notEmpty: true }
      },
      role: {
        type: DataTypes.ENUM(Object.values(ROLES)),
        allowNull: false,
        defaultValue: ROLES.USER
      }
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      indexes: [{ unique: true, fields: ['email'] }]
    }
  );
  return User;
}

export default User;