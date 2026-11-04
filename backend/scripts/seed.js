// Seed synthetic data: users, items, auctions in mixed states, bids.
// Usage: node scripts/seed.js [--force]
// Env knobs: SEED_USERS (default 40), SEED_ITEMS_PER_USER (default 3),
//            SEED_ACTIVE_AUCTIONS (default 10), SEED_BIDS_PER_ACTIVE (default 15)
// Reproducible: PRNG is seeded (xorshift), same DB wiped & rebuilt with --force.
import path from 'node:path';
import process from 'node:process';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { initDb, closeDb } from '../src/db/sequelize.js';
import { defineModels, syncModels } from '../src/models/index.js';
import { AUCTION_STATUSES as S } from '../src/models/index.js';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

const force = process.argv.includes('--force');

// deterministic PRNG
function xorshift(seed) {
  let x = seed || 88675123;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}
const rand = xorshift(42);
const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];

const TITLES = ['Leica M3', 'Nikon F2', 'Pentax 67', 'Rolex Datejust', 'Omega Speedmaster',
  'Vespa Sprint', 'Minerva Watch', 'Hasselblad 500C/M', 'Zeiss Ikon', 'B&O Beogram 4000',
  'Braun SK6', 'Dieter Rams Chair', 'Gibson J-45', 'Marshall JCM800', 'Roland TR-808'];
const CONDITIONS = ['NEW', 'LIKE_NEW', 'GOOD', 'USED', 'FOR_PARTS'];

const args = {
  users: Number(process.env.SEED_USERS ?? 40),
  itemsPerUser: Number(process.env.SEED_ITEMS_PER_USER ?? 3),
  activeAuctions: Number(process.env.SEED_ACTIVE_AUCTIONS ?? 10),
  bidsPerActive: Number(process.env.SEED_BIDS_PER_ACTIVE ?? 15)
};

async function main() {
  const dbFile = path.resolve(backendRoot, env.dbFile);
  const sequelize = await initDb(dbFile);
  if (force) {
    console.log('[seed] wiping database at', dbFile);
    await sequelize.drop();
  }
  const models = defineModels(sequelize, { bcryptRounds: 10 });
  await syncModels(sequelize);

  const password = 'Password123!';
  const passwordHash = await bcrypt.hash(password, 10);

  console.log(`[seed] creating ${args.users} users...`);
  const users = [];
  // admin first
  const admin = await models.User.create({ email: 'admin@auction.dev', passwordHash, role: 'ADMIN' });
  users.push(admin);
  for (let i = 0; i < args.users - 1; i++) {
    users.push(await models.User.create({ email: `user${i}@auction.dev`, passwordHash }));
  }

  console.log('[seed] creating items + auctions...');
  const auctions = [];
  for (const seller of users.slice(1)) {
    for (let j = 0; j < args.itemsPerUser; j++) {
      const item = await models.Item.create({
        title: `${pick(TITLES)} ${Math.floor(rand() * 900 + 100)}`,
        description: 'Seeded demonstration item.',
        condition: pick(CONDITIONS),
        sellerId: seller.id
      });
      const scheduled = rand() > 0.5;
      const auction = await models.Auction.create({
        itemId: item.id,
        sellerId: seller.id,
        status: S.DRAFT,
        startPriceCents: Math.floor(rand() * 90_000 + 10_000),
        minIncrementCents: Math.floor(rand() * 400 + 100)
      });
      if (scheduled) {
        const startsAt = new Date(Date.now() + 60_000);
        const endsAt = new Date(Date.now() + 3_600_000 * (1 + Math.floor(rand() * 24)));
        await auction.update({ status: S.SCHEDULED, startsAt, endsAt });
      }
      auctions.push(auction);
    }
  }
  console.log(`[seed] ${auctions.length} auctions (mix of DRAFT and SCHEDULED)`);

  console.log('[seed] activating auctions and generating bid history...');
  const bidders = users.slice(2); // exclude admin + first user
  const active = [];
  for (let i = 0; i < Math.min(args.activeAuctions, auctions.length); i++) {
    const auction = auctions[i];
    const endsAt = new Date(Date.now() + 60_000 * (5 + Math.floor(rand() * 50)));
    await auction.update({ status: S.ACTIVE, startsAt: new Date(Date.now() - 3_600_000), endsAt });
    active.push(auction);

    let minimum = auction.startPriceCents;
    for (let b = 0; b < args.bidsPerActive; b++) {
      const bidder = pick(bidders);
      const amount = minimum + Math.floor(rand() * auction.minIncrementCents * 3);
      try {
        const bid = await models.Bid.create({
          auctionId: auction.id,
          bidderId: bidder.id,
          amountCents: amount
        });
        await auction.update({ leaderId: bidder.id, leaderBidId: bid.id });
        minimum = amount + auction.minIncrementCents;
      } catch {
        // same-price collision due to PRNG overlap: skip (unique index holds)
      }
    }
  }

  // one auction about to close (for the closing runner demo)
  const demoItem = await models.Item.create({
    title: 'Demo: closes in ~5 seconds',
    description: 'Watch the SSE stream when this closes.',
    condition: 'GOOD',
    sellerId: users[1].id
  });
  const demoAuction = await models.Auction.create({
    itemId: demoItem.id,
    sellerId: users[1].id,
    status: S.ACTIVE,
    startPriceCents: 5000,
    minIncrementCents: 500,
    startsAt: new Date(),
    endsAt: new Date(Date.now() + 5_000)
  });

  const counts = {};
  for (const m of Object.values(models)) counts[m.name] = await m.count();

  console.log('[seed] done:');
  console.table(counts);
  console.log(`[seed] admin login: admin@auction.dev / ${password}`);
  console.log(`[seed] user logins: user0..user${args.users - 2}@auction.dev / ${password}`);
  console.log(`[seed] demo auction ${demoAuction.id} closes in ~5s (closing runner + SSE demo)`);
  await closeDb(sequelize);
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});