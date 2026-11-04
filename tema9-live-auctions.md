> An universitar / Academic year: **2026–2027**  
> Disciplina / Course: **Tehnologii Web / Web Technologies**  
> Statut / Status: **Draft v2.0 — pentru revizuire / for review**

---

# Real-Time Auction Platform — EN

**Mandatory packages:** `RTM` + `CON`  
**Common specification:** [`00-general-specifications.md`](00-general-specifications.md)  
**Package definitions:** [`01-architectural-challenges.md`](01-architectural-challenges.md)

## 1. Objective

Simulated auctions with concurrent bids, deadlines, and live updates; no real payments.

## 2. Minimum functionality

Item listing, opening auctions, bidding, minimum increments, countdown, bid history, and winner determination.

## 3. Critical invariants and rules

Every accepted bid respects the server-side current minimum and deadline; rejected bids do not change the leader; the final result is deterministic.

## 4. Data and workload scenario

20 simultaneous bidders and 100 bids in a reproducible test; at least two client events arriving out of order.

## 5. Mandatory package verification

RTM: live updates and reconnect; CON: same-price simultaneous bids with persisted bid-history verification.

## 6. Common acceptance criteria

- Ordinary users can complete their allowed workflows, but cannot perform privileged operations.
- Automated tests cover critical workflows, permissions, invalid inputs, and invariants.
- Both packages are implemented and backed by reproducible evidence; a description alone is insufficient.
- Coverage report, common load test, and capacity estimate are delivered under the general specification.
- Synthetic seed data, test scripts, an ADR per package, and demonstration instructions are provided.

## 7. Milestone deliverables

**M1:** use cases, actors, rules, schema, API, workload profile, test plan, and package alternatives.  
**M2:** API, persistence, critical rules, and initial tests; first demonstrable package scenario.  
**M3:** integrated SPA, completed tests, both packages verified, coverage/performance reports, ADRs, and demonstration.

## 8. Optional extension

Controlled deadline extension for last-second bids.

**Note:** extensions never replace mandatory requirements and must not require paid services.
