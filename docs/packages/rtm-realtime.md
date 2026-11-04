# RTM — Real-Time Collaboration (mandatory package)

## Requirement (from challenge sheet)
Multiple clients observe updates without manual refresh; handle stale state. Verification: 20 connected clients; measured delay, reconnects, and event authorization checks.

## Implementation
- Transport: **SSE** (ADR 002). Endpoints: `/api/auctions/:id/events`, `/api/users/:id/events`, `/api/global/events`.
- In-process event bus publishes **post-commit** envelopes: `{ type, channel, seq, busSeq, timestamp, ...payload }`.
- Hub keeps a bounded replay buffer (500); `id:` on each SSE event; heartbeat every 15 s; `retry: 2000`.
- Reconnect protocol: client sends `Last-Event-ID`; server replays buffered events with `id > cursor`, then writes `connected` (its id = cursor). Clients also carry application `seq` (bid id / closer batch id) to detect/reorder stale deliveries.
- Authorization: every stream requires Bearer auth; user channels are owner-only (admin override); stream subscription ≠ data escalation (e.g., `user:N` denies strangers with 403).

## Verification (executable evidence)
`backend/test/realtime.test.js`:
1. 20 concurrent clients connect to one auction stream; a bid committed via REST reaches all 20 (measured ≤ 55 ms in-process — printed as `[RTM evidence]` during the run).
2. Reconnect with `Last-Event-ID` replays the missed `bid.accepted` exactly once.
3. Cross-user channel subscription → 403; anonymous stream → 401.
4. Out-of-order scenario: events carry monotonic `seq`; swapped arrival is reordered client-side; replay-from-cursor re-delivers both events in order without gaps.

## Limitations
Single-process hub (Redis pub/sub needed for replicas); buffer beyond 500 events requires REST reconciliation (fetch bids/stats); heartbeats and `X-Accel-Buffering: no` guard against buffering proxies.