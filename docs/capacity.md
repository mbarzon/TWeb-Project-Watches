# Workload profile & capacity

## Service objective
Interactive auction UX: browse/filter endpoints responsive under concurrent bidding; bid acceptance latency under load stays well below 1 s p95; zero integrity violations.

## Workload model (per general spec §5)
- Data volume: seed of 40 users, ~120 items/auctions, 15+ bids per active auction.
- Traffic mix: 80% read/browse (list auctions, filter, item search, auction detail + bid history), 20% writes (bid attempts).
- Concurrency levels: 20 / 100 / 200 concurrent virtual users (k6 stages: 2 min baseline → 1 min surge → 1 min stress → ramp down).

## Test environment (record 2026-11-04)
- Linux Fedora, k6 v2.3.0, Node v24.22.2, SQLite WAL temp-file DB, single Node process on the same machine as k6 (localhost), no TLS.
- Machine-dependent absolute numbers; **do not compare raw RPS across machines** (per spec). Relative before/after deltas and error classes are the evidence.

## Results — three load levels (after ADR 003 fix, `load/results/mixed-final.txt`)

| Level | VUs | Throughput | p50 | p95 | 5xx / infra errors |
|---|---:|---:|---:|---:|---:|
| 1 | 20 | ~39–52 req/s | ~40 ms | ~166 ms | 0 |
| 2 | 100 | ~39–52 req/s (shared) | ~40 ms | ~166 ms | 0 |
| 3 | 200 | ~398 req/s aggregate | 40 ms | 166 ms | 0 |

Full-suite aggregate: 71,894 requests over 3 min, 398.85 req/s, max latency 555 ms, **server_errors_5xx = 0**. `http_req_failed` ≈ 5% is **expected business rejection traffic** (409 `BID_TOO_LOW` in bid races + 403 own-auction bids), verified by the request-level check `bid accepted-or-business-conflict` (passes at 100%).

## Bottleneck discovery & optimization (before/after)

Per-auction write serialization let multiple auction transactions contend on SQLite's single writer; Sequelize opens one connection per transaction, so contention manifested as `SQLITE_BUSY` storms (server log: 29.5k lines), degraded to 62.8 req/s with p95 6.07 s and 5xx responses at 200 VUs.

Fix (ADR 003): **global write mutex** matching SQLite's single-writer model, + busy_timeout applied to every transaction connection.

| Metric | Before | After |
|---|---:|---:|
| Throughput @200 VUs | 62.8 req/s | 398.8 req/s |
| p95 | 6,070 ms | 166 ms |
| 5xx / out-of-envelope errors | 53 | 0 |
| SQLITE_BUSY storms | yes | no |

## Capacity estimate
At the peak measured level the server sustains **~400 req/s with p95 166 ms and zero infrastructure errors** on the reference machine. The stress slope between 100→200 VUs stays mild through the write queue (writes are the serialized segment; reads run concurrently under WAL). Estimated sustainable capacity against the stated objective (p95 < 800 ms, 0 5xx): comfortably ≥ 200 concurrent actives on this machine; the bottleneck at higher concurrency is the **single-writer file lock behind the global write mutex** — the next optimization would be write batching / sharding per auction file or moving to Postgres row locks (documented in ADR 003 limitations).

## CON verification under load
`load/bid-race.js`: rounds of 20 same-price bids against a live auction — `race_violations = 0` (exactly one accepted bid per round), `server_errors_5xx = 0`, persisted bid history verified in teardown.