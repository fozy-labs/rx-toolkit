// ==================== SKIP Sentinel ==

/**
 * Sentinel value passed as resource arguments to indicate that the query
 * should be skipped (not executed). Useful for conditional fetching.
 */
export const SKIP = Symbol("SKIP");

// ==================== Keyed Brand ====================

/**
 * Unique brand symbol used to distinguish {@link TKeyed} wrappers
 * from plain argument objects at runtime.
 */
export const KEYED_BRAND: unique symbol = Symbol("KEYED_BRAND");

// ==================== Snapshot Version ====================

/**
 * Current serialization version used by the snapshot/restore mechanism.
 *
 * History:
 * - `1` — initial format.
 * - `2` (0.13.0) — machine status strings renamed: `refreshing` → `invalidating`,
 *   `refresh-error` → `invalidate-error`. Snapshots written by an older version are
 *   translated on hydration (see `Snapshotter.hydrateResource`).
 */
export const CURRENT_SNAPSHOT_VERSION = 2;
