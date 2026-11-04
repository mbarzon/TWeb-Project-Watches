# ADR 005 — Explicit state machine vs scattered conditionals

## Problem
The auction lifecycle is a multistate business workflow with authorized actors and preconditions. Encoding it as scattered `if (status === ...)` checks invites invalid transitions and duplicative permission logic.

## Alternatives
1. Scattered conditionals in services/controllers.
2. Explicit transition table (`TRANSITIONS`) + one enforcement function.
3. Full workflow engine library (state-machine npm packages).

## Decision
Option 2: `services/auctionStateMachine.js` defines every legal edge (`DRAFT->SCHEDULED`, `SCHEDULED->ACTIVE`, `SCHEDULED->CANCELLED`, `DRAFT->CANCELLED`, `ACTIVE->ENDED`, `ACTIVE->CANCELLED`) with:
- permitted **actors** (`SELLER`, `ADMIN`, `SYSTEM`),
- **preconditions** (dates sanity, deadline reached, start window),
- pure `checkTransition` (testable without DB) + `assertTransition` (throws 409 with precise codes: `INVALID_TRANSITION`, `UNAUTHORIZED_TRANSITION`, `PRECONDITION_FAILED`).

`transitionAuction` (HTTP) and the closing runner (`SYSTEM`) both delegate to the same table; ownership of the auction is checked before the transition is allowed for SELLER. Terminal states (`ENDED`, `CANCELLED`) have no outgoing edges: repeated submissions are structurally impossible.

## Experiment / tests
`test/stateMachine.test.js`: legal/illegal edges, repeated submission rejection, unauthorized actor rejection, deadline precondition (system cannot close before endsAt), terminal states. `test/auctions.test.js`: lifecycle via HTTP including precondition failure windows and object-level 403.

## Limitations
Preconditions use a ±2 s clock tolerance to absorb inter-machine drift; documented so demos don't fight it.