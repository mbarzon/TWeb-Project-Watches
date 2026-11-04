# ADR 002 — SSE vs WebSockets vs polling (RTM package)

## Problem
Multiple clients must observe auction updates (bids, closures, outbid alerts) without manual refresh; reconnecting clients must not lose events; the workload includes out-of-order delivery that clients must survive.

## Alternatives
1. **Client polling** — simple, but latency scales with poll rate; wasted requests; poor fit for 20+ concurrent auction streams.
2. **WebSockets (`ws`)** — bidirectional, but bids already flow over REST; requires custom reconnect/backoff, ping/pong, and resumability logic; harder to test.
3. **Server-Sent Events (SSE)** — unidirectional server→client stream; native browser reconnection; per-event `id:` makes resumption a standard (`Last-Event-ID`); trivially authorizable with the same Bearer middleware as the REST API.

## Decision
SSE. Auction traffic is naturally unidirectional (state changes are submitted over REST; observations stream). Two stream families: per-auction (public activity) and per-user (outbid/won notifications), plus a global stream for tests/admin. The hub owns a bounded ring buffer; each client's cursor is the SSE `id`; reconnect replays everything after the cursor, then confirms with a `connected` event carrying `nextBusSeq`. Every SSE connect is authorized (Bearer token); user channels reject subscribers who are neither the owner nor an admin.

## Experiment / tests (measured evidence)
- `test/realtime.test.js`: 20 concurrent clients receive a bid event live (observed ≤ 55 ms after commit in-process); reconnect with `Last-Event-ID` replays missed bid events; per-user channel privacy (403 for strangers); unauthenticated streams rejected (401).
- Out-of-order handling: events carry monotonic `seq`/`id`; test simulates swapped arrival and restores order client-side.

## Limitations
- One node only: the hub and bus are in-process (no fanout across replicas). For HA, replace the bus with Redis pub/sub — interface unchanged.
- Ring buffer drops the oldest events past `SSE_BUFFER_SIZE` (500); a longer disconnect than 500 events requires REST reconciliation (documented client pattern: refetch bids/stats).
- Corporate proxies that buffer SSE need `X-Accel-Buffering: no` (set) and heartbeats (15 s, set).