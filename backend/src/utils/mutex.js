/**
 * Keyed async mutex (cooperative, in-process).
 *
 * Used to serialize per-auction DB writes. SQLite is single-writer at the
 * database level, so allowing many simultaneous BEGIN IMMEDIATE transactions
 * against one auction only generates SQLITE_BUSY storms (Sequelize opens a
 * fresh connection per transaction and its busy/retry handling degrades under
 * contention). The DB-level BEGIN IMMEDIATE + UNIQUE(auctionId, amountCents)
 * index remain the authoritative invariant backstop.
 */
export class KeyedMutex {
  #chains = new Map();

  /** Runs fn exclusively per key; rejects with fn's error. */
  runExclusive(key, fn) {
    const tail = this.#chains.get(key) ?? Promise.resolve();
    const result = tail.then(fn, fn); // run regardless of previous outcome
    const marker = result.then(
      () => undefined,
      () => undefined
    ); // chain continues only when fn fully settled
    this.#chains.set(key, marker);
    marker.then(() => {
      if (this.#chains.get(key) === marker) this.#chains.delete(key);
    });
    return result;
  }

  /** Number of keys currently tracked (tests/monitoring). */
  get size() {
    return this.#chains.size;
  }
}

export const bidMutex = new KeyedMutex();