> An universitar / Academic year: **2026–2027**  
> Disciplina / Course: **Tehnologii Web / Web Technologies**  
> Statut / Status: **Draft v2.0 — pentru revizuire / for review**

---

# Architectural Challenge Packages — EN

## Composition rule

**Project = general specification + domain topic sheet + exactly two mandatory packages.** These packages are reusable requirement sets, not prebuilt NPM modules. Both must be implemented in the same application and independently verified. Each requires a concise ADR, executable tests, and measurable evidence. Core functionality, testing, coverage, baseline security, and lightweight capacity testing remain mandatory for all projects. SCL adds capacity optimization; SEC adds ZAP scanning.

## Catalogue

| ID | Package | Indicative difficulty |
|---|---|---|
| CON | Concurrency and Consistency | Advanced |
| STA | Workflow State Integrity | Intermediate |
| SCL | Scalability and Capacity | Advanced |
| DBP | Data-Intensive Query Optimization | Intermediate |
| RTM | Real-Time Collaboration | Advanced |
| ASY | Asynchronous Jobs and Recovery | Advanced |
| SEC | OWASP ZAP Security Assessment | Intermediate |
| TEN | Multi-Tenant Isolation | Advanced |
| EXT | Resilient External Integration | Intermediate |
| OFF | Offline Operation and Synchronization | Advanced |
| WRK | Browser Worker Computation | Intermediate |
| AUD | Auditability and Reconstruction | Intermediate |

## CON — Concurrency and Consistency

**Injected requirement:** Concurrent operations against a shared limited resource; integrity enforced by server/database.

**Required verification:** At least 20 concurrent requests against insufficient capacity; verify responses and persisted state; no over-allocation.

**Decisions to discuss:** Transactions, constraints, atomic operations; SQLite limitations.

## STA — Workflow State Integrity

**Injected requirement:** Workflow with at least four states, permitted transitions, preconditions, authorized actors.

**Required verification:** Test valid/invalid transitions, repeated submissions, and unauthorized changes.

**Decisions to discuss:** Explicit state machine versus scattered conditionals.

## SCL — Scalability and Capacity

**Injected requirement:** Explicit traffic/data model, three load levels plus saturation experiment; measurable optimization.

**Required verification:** Graphs for p50/p95, throughput, errors, CPU/memory where available; controlled before/after measures.

**Decisions to discuss:** Database, event-loop, connection, caching, or index bottlenecks.

## DBP — Data-Intensive Query Optimization

**Injected requirement:** Filtering/sorting/aggregation over substantial data volume; avoid loading everything in memory.

**Required verification:** Reproducible seeded data (default 100,000 main rows), query plan, before/after timings, correct pagination.

**Decisions to discuss:** Indexes, eager loading, N+1, offset/cursor pagination.

## RTM — Real-Time Collaboration

**Injected requirement:** Multiple clients observe updates without manual refresh; handle stale state.

**Required verification:** 20 connected clients; measured delay, reconnects, and event authorization checks.

**Decisions to discuss:** Polling, SSE or WebSockets and state reconciliation.

## ASY — Asynchronous Jobs and Recovery

**Injected requirement:** Long-running operation with prompt submission, status, result, and safe failure behavior.

**Required verification:** Multiple jobs, failed job, worker interruption, duplicate request handling.

**Decisions to discuss:** In-process worker versus persistent queue, retry and idempotency.

## SEC — OWASP ZAP Security Assessment

**Injected requirement:** Scoped security plan on a controlled instance; scan, triage, remediation, and manual tests.

**Required verification:** ZAP report, explained findings, cross-user object-access tests, remediation regressions.

**Decisions to discuss:** Automated scan limits, session security, object-level authorization.

## TEN — Multi-Tenant Isolation

**Injected requirement:** Multiple organizations share the service without cross-tenant data leakage.

**Required verification:** Negative read/write/search/export tests across at least 3 organizations.

**Decisions to discuss:** Centralized tenant scoping, constraints, access policies.

## EXT — Resilient External Integration

**Injected requirement:** External service or simulator with timeout, errors, rate limits, and duplicate responses.

**Required verification:** Deterministic fault tests, bounded retries, coherent states and idempotent effects.

**Decisions to discuss:** Timeout, retry/backoff, operation state, deduplication.

## OFF — Offline Operation and Synchronization

**Injected requirement:** Selected actions work without a network and synchronize later.

**Required verification:** Airplane mode, reload, reconnect, duplicate retransmission, conflict.

**Decisions to discuss:** IndexedDB, service worker, synchronization and conflict resolution.

## WRK — Browser Worker Computation

**Injected requirement:** Expensive client-side processing without blocking interaction.

**Required verification:** UI responsiveness and computation timings before/after worker, correct result, progress/cancellation where relevant.

**Decisions to discuss:** Data transfer, thread messaging, overhead and memory.

## AUD — Auditability and Reconstruction

**Injected requirement:** Record important events with actor, time, target, action, and outcome.

**Required verification:** Reconstruct object history; prevent ordinary users from modifying audit records.

**Decisions to discuss:** Transactional audit, events, and limits of log integrity.

## Assessment and boundaries

Each package uses the same rubric: correct implementation 40%, reproducible tests/evidence 30%, alternatives and reasoning 20%, documented limitations 10%. A theoretical write-up alone is insufficient. No mandatory paid services. Attack scenarios and scans target only owned/authorized systems. The instructor may reasonably adjust indicative data volumes/load levels for hardware constraints without eliminating the experiment.
