import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { initDb, closeDb } from '../src/db/sequelize.js';
import { defineModels, syncModels, User, Item, Auction, Bid, ROLES } from '../src/models/index.js';

let sequelize;

beforeEach(async () => {
  sequelize = await initDb(':memory:');
  defineModels(sequelize, { bcryptRounds: 10 });
  await syncModels(sequelize);
});

test.after(() => closeDb(sequelize));

test('syncs all tables and creates a user row', async () => {
  const user = await User.create({
    email: 'ana@example.com',
    passwordHash: 'hash',
    role: ROLES.USER
  });
  assert.ok(user.id >= 1);
  assert.equal(user.email, 'ana@example.com');
});

test('email is lowercased and unique (DB-level integrity)', async () => {
  await User.create({ email: 'BoB@Example.COM', passwordHash: 'h' });
  await assert.rejects(
    () => User.create({ email: 'bob@example.com', passwordHash: 'h2' }),
    (err) => err.name === 'SequelizeUniqueConstraintError'
  );
});

test('one auction per item (itemId unique constraint)', async () => {
  const seller = await User.create({ email: 's@example.com', passwordHash: 'h' });
  const item = await Item.create({ title: 'Leica M3', sellerId: seller.id, condition: 'USED' });
  await Auction.create({
    itemId: item.id,
    sellerId: seller.id,
    startPriceCents: 10000,
    minIncrementCents: 500
  });
  await assert.rejects(
    () =>
      Auction.create({
        itemId: item.id,
        sellerId: seller.id,
        startPriceCents: 10000,
        minIncrementCents: 500
      }),
    (err) => err.name === 'SequelizeUniqueConstraintError'
  );
});

test('bid amounts must be positive and same price twice in auction rejected (CON backstop)', async () => {
  const seller = await User.create({ email: 's@example.com', passwordHash: 'h' });
  const b1 = await User.create({ email: 'b1@example.com', passwordHash: 'h' });
  const b2 = await User.create({ email: 'b2@example.com', passwordHash: 'h' });
  const item = await Item.create({ title: 'Nikon F2', sellerId: seller.id });
  const auction = await Auction.create({
    itemId: item.id,
    sellerId: seller.id,
    startPriceCents: 5000,
    minIncrementCents: 100
  });
  await Bid.create({ auctionId: auction.id, bidderId: b1.id, amountCents: 5100 });
  await assert.rejects(() => Bid.create({ auctionId: auction.id, bidderId: b2.id, amountCents: 5100 }));
  await assert.rejects(() => Bid.create({ auctionId: auction.id, bidderId: b2.id, amountCents: 0 }));
});

test('foreign keys enforced: bid for missing auction rejected', async () => {
  const b = await User.create({ email: 'x@example.com', passwordHash: 'h' });
  await assert.rejects(() => Bid.create({ auctionId: 9999, bidderId: b.id, amountCents: 100 }));
});