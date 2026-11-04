> An universitar / Academic year: **2026–2027**  
> Disciplina / Course: **Tehnologii Web / Web Technologies**  
> Statut / Status: **Draft v2.0 — pentru revizuire / for review**

---

# General Project Specification — EN

## 1. Goal and outcome

Develop a working full-stack web application for the assigned topic through AI-assisted software engineering. Students must specify requirements, design components, inspect agent-proposed changes, implement, debug, test, measure performance, and explain the result. The team remains accountable for all code and behavior regardless of AI assistance.

**Team size:** one to **three students**. The project contributes **25% of the overall course grade**; examination and tutorial assessment remain separate.

## 2. Standard technology

- **JavaScript**, ECMAScript modules; **no TypeScript**.
- **Node.js LTS** with **Express** for the HTTP/JSON REST API.
- **React + Vite** SPA; React Router where needed.
- **Sequelize** with **SQLite** or another justified/approved relational database.
- Native web APIs (`fetch`, browser storage, etc.) when appropriate.
- **Git** for contribution history and integration.
- An AI coding agent (e.g., Codex), with diff review and independent validation.
- Additional libraries are permitted when justified. Microservices, containers, and paid cloud services are not mandatory.

## 3. Mandatory functionality

1. At least two roles with distinct permissions, including real server-side authentication and authorization.
2. Related relational entities with integrity constraints.
3. At least three complete user workflows with acceptance criteria.
4. A multistate business workflow with explicit transitions/rules.
5. Server validation, consistent errors, and UI loading/error states.
6. Filtering, sorting, and pagination for at least one relevant collection.
7. One meaningful external API/service integration or an approved substitute with a clear integration contract; local simulated services are acceptable for free, reproducible failure experiments.
8. Responsive frontend; no arbitrary minimum page or endpoint count.

At least one critical **business invariant** must be enforced at the server/database boundary, not merely in the UI.

## 4. Quality, tests, and coverage

- Automated unit tests for business rules, integration tests for API/persistence, negative validation/authorization tests, and at least one automated end-to-end workflow.
- Explicit tests for topic-critical invariants and assigned architectural-package scenarios.
- Submit **statement coverage** and **branch coverage** for student-authored backend application code.
- **Proposed thresholds:** ≥70% statements, ≥60% branches. These are draft grading thresholds, not proof of correctness.
- Document justified exclusions for generated code, dependencies, migrations, and configuration.
- Briefly identify important untested behavior and associated risk.

## 5. Baseline performance and capacity planning

Each topic defines data volume, concurrent clients, workload mix, and latency/error objectives. Run a reproducible load test (e.g. k6 or Artillery) at **three load levels**; report throughput, p50/p95 latency, errors, and observable resource usage, with the test environment recorded. Estimate sustainable capacity against the stated service objective and identify a likely bottleneck. **Do not compare raw RPS across different students' machines.** SCL adds deeper saturation analysis and optimization.

## 6. Baseline security

Never store plaintext passwords. Protect secrets, validate untrusted input, enforce permissions on sensitive operations and objects, and prevent data disclosure through responses or logs. Use database constraints and parameterized queries. Document CORS, cookies/tokens, and error-handling policy. **SEC** adds OWASP ZAP scanning and remediation evidence; scanners do not replace manual authorization testing. Security tests must only target controlled/authorized instances.

## 7. Injected architectural challenges

Every topic assigns **exactly two mandatory packages** listed in its topic sheet. These add to, rather than replace, baseline requirements. Each package requires a concise architectural decision record (ADR: problem, alternatives, selection, experiment/test, limitations). Complexity for its own sake is not rewarded.

## 8. AI-assisted work and individual accountability

Submit a concise AI tool usage summary and **one significant engineering case per student**: requirement, agent contribution, inspection, issue/limitation or verification, correction, and outcome. Full chat transcripts are not required. Each student must explain important code paths, their contribution, and their tests.

## 9. Git, delivery, reproducibility

Use a shared repository with incremental commits, identifiable contributions, and reviewable integration. Include `README.md`, secret-free `.env.example`, lockfile, and setup, database/seed, run, tests, coverage, load-test, and production-build/start instructions. Reproducible local/containerized production-mode deployment is acceptable if public hosting is impractical. Paid services are not required.

**Minimum docs:** `docs/requirements.md`, `docs/architecture.md`, `docs/adr/`, `docs/testing.md`, `docs/capacity.md`, `docs/ai-usage.md`, `docs/packages/`. Code organization is flexible.

## 10. Milestones

| Milestone | Verifiable deliverables |
|---|---|
| **M1 — Analysis/design** | Repository and team; requirements/roles/workflows; invariants; initial schema and API; architecture sketch; alternatives for both packages; workload assumptions; test plan; runnable skeleton. |
| **M2 — Backend/tests** | Working API/persistence; baseline security; core rules; unit+integration tests; initial coverage report; first verifiable architectural scenario. |
| **M3 — Final delivery** | Integrated application; E2E test; both packages verified; coverage and gap analysis; load and capacity report; ADRs; docs; demonstration and individual contributions. |

**There is no surprise instructor-issued final change request**. Mandatory scenarios are published in advance. Exact milestone dates are announced separately.

## 11. Proposed grading (100 project points)

| Criterion | Points |
|---|---:|
| Core features and business correctness | 30 |
| Architectural package 1: solution, tests, reasoning | 20 |
| Architectural package 2: solution, tests, reasoning | 20 |
| Test quality, overall coverage, gap analysis | 10 |
| Git, collaboration, AI process, individual contribution | 10 |
| Docs, baseline capacity, reproducibility, defense | 10 |
| **Total** | **100** |

Internally, each package is assessed for correct behavior (40%), reproducible verification (30%), architectural reasoning (20%), and evidence/limitations (10%). Non-running systems cannot receive full functionality credit, but demonstrable partial components may be assessed. Exact late penalties and grade caps will be announced before M1.
