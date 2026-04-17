// ==================== SKIP Sentinel ==

/**
 * Sentinel value passed as resource arguments to indicate that the query
 * should be skipped (not executed). Useful for conditional fetching.
 */
export const SKIP = Symbol("SKIP");

// ==================== Keyed Brand ====================

/**
 * Unique brand symbol used to distinguish {@link Keyed} wrappers
 * from plain argument objects at runtime.
 */
export const KEYED_BRAND: unique symbol = Symbol("KEYED_BRAND");

// ==================== Snapshot Version ====================

/** Current serialization version used by the snapshot/restore mechanism. */
export const CURRENT_SNAPSHOT_VERSION = 1;
