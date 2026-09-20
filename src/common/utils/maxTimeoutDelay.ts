/**
 * Largest delay `setTimeout` can represent: the delay is kept in a signed
 * 32-bit integer, and anything above this overflows and fires immediately
 * instead of far in the future.
 *
 * What that means is the caller's decision, and the two callers differ on
 * purpose: `LocalStateStorage` clamps a long interval to the limit and
 * re-checks when it fires, while a query cache entry reads an over-limit
 * `retentionTime` as "no timer at all" — the only reading under which the
 * entry is actually retained rather than evicted at once.
 */
export const MAX_TIMEOUT_DELAY = 2_147_483_647;
