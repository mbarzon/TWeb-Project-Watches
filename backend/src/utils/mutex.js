/**
 * Keyed async mutex (cooperative, in-process).
 *
 * Used to serialize DB write transactions. SQLite is single-writer at the
 * FILE level: concurrent BEGIN IMMEDIATE transactions (even on different
 * auctions) contend on the write lock, generating SQLITE_BUSY storms under
 * load because Sequelize opens a fresh connection per transaction. A global
 * write queue matches the engine's concurrency model exactly, keeps every
 * invariant enforced inside the transaction, and cross-auction fairness is
 * FIFO by arrival. (Bounded busy_timeout remains as a backstop.)
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

export const dbWriteMutex = new KeyedMutex();
export const DB_WRITE_KEY = 'db:write';