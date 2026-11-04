# ADR 001 — API and money representation

## Problem
Bids, prices and increments need exact numeric semantics; floats leak rounding errors into min-increment comparisons, which is a business invariant.

## Alternatives
1. JavaScript floats (Number) end-to-end.
2. Decimal strings end-to-end, parsed per operation.
3. Store integer cents; expose decimal at the API boundary.

## Decision
Option 3. `amountCents` INTEGER everywhere in the DB; routes accept decimal strings (`'110.00'`) and convert with `utils/money.js:toCents` (round-half-up); responses carry both `amount` (major units) and `amountCents`. Min-increment checks compare integers only.

## Experiment / tests
`test/models.test.js` (constraint behavior), `test/bidding.test.js` (min-increment edge: `1.10 < 1.50` rejected), `test/fxRoutes.test.js` (150.00 EUR → 162.78 USD).

## Limitations
Max representable cents = 2^53 (irrelevant here); display formatting left to the SPA.