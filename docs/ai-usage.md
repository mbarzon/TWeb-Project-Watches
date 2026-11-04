# AI tool usage summary

Project built with an AI coding agent (opencode / GLM) under human direction. Working agreement: agent implements, human reviews diffs, runs tests and load tools locally, and decides direction. All design decisions (SSE over WebSockets, global write mutex, Frankfurter integration, money-as-cents) were taken after agent-proposed alternatives were compared in ADR files.

## Engineering case — concurrency debugging (significant)

**Requirement**: 20 concurrent bidders must produce exactly one accepted bid for a price slot (CON package).

**Agent contribution**: implemented the bid service with `BEGIN IMMEDIATE` transactions + the per-auction mutex, and the 20-concurrent test. First run failed: only ~1 accepted, dozen 500s; log showed `SQLITE_BUSY: database is locked` cascading into Sequelize's "cannot start / cannot rollback" connection-kill storms.

**Inspection**: The human and agent investigated together; the agent ran isolated probes (`node --test` repro scripts) that revealed three distinct causes:
1. `PRAGMA busy_timeout` was applied only to the default connection, while Sequelize opens a **new connection per transaction** (probe: BEGINs failed immediately instead of waiting).
2. On `:memory:` test DBs, ALL transactions share one cached connection → "transaction within transaction" (probe comparing file vs memory storage).
3. Even with correct pragmas, 20 concurrent transactions on file storage degraded at scale (5 s waits per retry × Sequelize retry max → 100 s storms, observed in instrumented probes logging BEGIN attempts/latency).

**Issue found / verification**: the initial design (per-auction mutex) was correct per-auction but still allowed cross-auction contention on the single file lock; the probe suite isolated it: 4 concurrent transactions OK, but 20 under mixed HTTP traffic collapsed.

**Correction**: switched to a **global write mutex** (matching SQLite's single-writer model), pragma patching moved into `initDb` for every transaction connection, tests moved to temp-file DBs. k6 before/after: 62.8 → 398.8 req/s; p95 6.07 s → 166 ms; 5xx 53 → 0. The fix is itself tested (76/76 suite green three consecutive runs of the CON scenarios).

**Outcome**: CON scenarios pass deterministically; evidence recorded in `docs/adr/003`, `docs/capacity.md` and `load/results/`.

Human accountability: all commits reviewed before push; test suite and load scripts were executed and their outputs inspected by the team; the agent did not commit without instruction.