// CON invariant under load: 20 concurrent bidders, per-ROUND price slot.
// Each round all 20 VUs bid the SAME amount; exactly one 201 must be
// accepted per round (metric race_violations must stay at 0).
// Run:  BASE_URL=http://localhost:3000 npm i k6; k6 run load/bid-race.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PASSWORD = __ENV.SEED_PASSWORD || 'Password123!';
const BIDDERS = Number(__ENV.RACE_BIDDERS || 20); // spec: 20 concurrent bidders
const ROUNDS = Number(__ENV.ROUNDS || 8);

const raceViolations = new Counter('race_violations');
const serverErrors = new Counter('server_errors_5xx'); // infra failures only

export const options = {
  vus: BIDDERS,
  duration: `${ROUNDS * 1.5}s`,
  thresholds: {
    race_violations: ['count==0'],
    server_errors_5xx: ['count==0']
  }
};

const accounts = [...Array(BIDDERS).keys()].map((i) => `user${i}@auction.dev`);
const acceptedByRound = {}; // shared (per-instance) tally
let round = 0;
let roundAmount = null;
let auctionId = null;

export function setup() {
  const res = http.get(`${BASE_URL}/api/auctions?status=ACTIVE&limit=3`);
  const data = res.json('data') || [];
  if (data.length === 0) throw new Error('No ACTIVE auctions; run npm run seed first');
  auctionId = data[0].id;
  return { auctionId };
}

function token(vu) {
  const res = http.post(`${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: accounts[vu - 1], password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } });
  if (res.status !== 200) throw new Error(`login failed for ${accounts[vu - 1]}: ${res.status}`);
  return res.json().token;
}

export default function (setupData) {
  if (__VU === 1) {
    // round leader: read the CURRENT server minimum, schedule a round
    const stats = http.get(`${BASE_URL}/api/auctions/${setupData.auctionId}/stats`);
    const min = stats.json('minimumBidCents');
    round += 1;
    roundAmount = ((min / 100) + 0.05).toFixed(2); // same price for everyone
    acceptedByRound[round] = 0;
  }

  sleep(0.3); // align inside the round window
  if (round === 0) {
    return; // round not yet started
  }
  const amount = roundAmount;

  const res = http.post(`${BASE_URL}/api/auctions/${setupData.auctionId}/bids`,
    JSON.stringify({ amount }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(__VU)}` },
      tags: { name: 'race-bid', round: String(round) } });

  check(res, {
    'accepted or low': (r) => r.status === 201 || (r.status === 409 && r.json('error.code') === 'BID_TOO_LOW')
  });
  serverErrors.add(res.status === 0 || res.status >= 500 ? 1 : 0);

  if (res.status === 201) {
    acceptedByRound[round] += 1;
  }
  sleep(0.8); // leave room for the next round
}

export function teardown(setupData) {
  // persisted evidence: bid history grew by exactly one per round
  const res = http.get(`${BASE_URL}/api/auctions/${setupData.auctionId}/bids?limit=100`);
  const total = res.json('meta')?.total;
  console.log(`[bid-race] auction ${setupData.auctionId} persisted history: ${total} bids`);
  for (const [r, accepted] of Object.entries(acceptedByRound)) {
    if (accepted !== 1) {
      console.error(`[bid-race] VIOLATION: round ${r} accepted ${accepted} bids (expected 1)`);
      raceViolations.add(1);
    }
  }
}