// Baseline mixed-workload load test (3 load levels via stages).
// Run:  BASE_URL=http://localhost:3000 k6 run load/mixed-workload.js
// Scenarios: browse auctions/items (80%) + place bids (20%) with logged-in users.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PASSWORD = __ENV.SEED_PASSWORD || 'Password123!';
const BIDDERS = Number(__ENV.BIDDER_POOL || 38); // user0..user37@auction.dev from seed

const serverErrors = new Counter('server_errors_5xx'); // infrastructure failures only

export const options = {
  stages: [
    { duration: '20s', target: 20 }, // level 1: baseline
    { duration: '20s', target: 20 },
    { duration: '30s', target: 100 }, // level 2
    { duration: '30s', target: 100 },
    { duration: '30s', target: 200 }, // level 3: stress
    { duration: '30s', target: 200 },
    { duration: '20s', target: 0 }
  ],
  thresholds: {
    // business rejections (409 BID_TOO_LOW, 403 own auction) are expected;
    // only infrastructure failures (5xx/timeouts) must stay at zero
    server_errors_5xx: ['count==0'],
    http_req_duration: ['p(50)<80', 'p(95)<800']
  }
};

const tokens = new Map(); // per-VU token cache

function login(vuTag) {
  if (tokens.has(vuTag)) return tokens.get(vuTag);
  const email = `user${(vuTag % BIDDERS)}@auction.dev`;
  const res = http.post(`${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  const token = res.json().token;
  tokens.set(vuTag, token);
  return token;
}

export default function () {
  const vu = __VU;
  const token = login(vu);
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  // ~80% browse traffic
  if (Math.random() < 0.8) {
    const which = Math.random();
    if (which < 0.5) {
      const res = http.get(`${BASE_URL}/api/auctions?status=ACTIVE&sort=endsAt&order=asc&limit=20`, authHeaders);
      check(res, { 'list 200': (r) => r.status === 200 });
    } else if (which < 0.8) {
      const res = http.get(`${BASE_URL}/api/items?q=camera&limit=20`, authHeaders);
      check(res, { 'items 200': (r) => r.status === 200 });
    } else {
      const list = http.get(`${BASE_URL}/api/auctions?status=ACTIVE&limit=20`, authHeaders);
      const data = list.json('data') || [];
      if (data.length > 0) {
        const id = data[Math.floor(Math.random() * data.length)].id;
        const detail = http.get(`${BASE_URL}/api/auctions/${id}`, authHeaders);
        check(detail, { 'detail 200': (r) => r.status === 200 });
        const history = http.get(`${BASE_URL}/api/auctions/${id}/bids?limit=10`, authHeaders);
        check(history, { 'history 200': (r) => r.status === 200 });
      }
    }
    sleep(0.3);
    return;
  }

  // ~20% bid traffic: race against the same auction from all VUs
  const list = http.get(`${BASE_URL}/api/auctions?status=ACTIVE&limit=5`, authHeaders);
  const data = list.json('data') || [];
  if (data.length === 0) { sleep(0.5); return; }
  const auction = data[Math.floor(Math.random() * data.length)];

  const stats = http.get(`${BASE_URL}/api/auctions/${auction.id}/stats`);
  const minCents = (stats.json('minimumBidCents') || auction.startPriceCents * 100 + 100);

  // a plausible competitive amount
  const amount = (minCents / 100 + Math.random() * 5).toFixed(2);
  const res = http.post(`${BASE_URL}/api/auctions/${auction.id}/bids`,
    JSON.stringify({ amount }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
  // valid outcomes: 201 accepted, 409 outbid/minimum, 403 own auction
  check(res, { 'bid accepted-or-business-conflict': (r) => [201, 409, 403].includes(r.status) });
  serverErrors.add(res.status === 0 || res.status >= 500 ? 1 : 0);
  sleep(0.5);
}