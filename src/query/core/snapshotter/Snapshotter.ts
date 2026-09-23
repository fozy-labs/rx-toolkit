import type { TApiSnapshot, TResourceSnapshot, TResourceSnapshotEntry } from "@/query/types";

import { CURRENT_SNAPSHOT_VERSION } from "../../constants";
import type { Resource } from "../resource/Resource";

export interface TSnapshotterOptions {
    initialSnapshot: TApiSnapshot | null;
    snapshotValidTime: number | false;
    keyPrefix: string | null;
}

/**
 * Entry status strings written by snapshot version 1, mapped to their current
 * spelling. Version 2 (0.13.0) renamed the invalidation statuses; every other
 * status string kept its name across versions.
 */
const LEGACY_STATUSES_V1: Readonly<Record<string, string>> = {
    refreshing: "invalidating",
    "refresh-error": "invalidate-error",
};

/**
 * Translates a persisted entry status into the vocabulary of
 * {@link CURRENT_SNAPSHOT_VERSION}.
 *
 * Only snapshots strictly older than the current version are translated. A snapshot
 * whose `version` is newer than this build is read as-is: the renames it may carry
 * are unknown here, so guessing them would be a misread. Statuses this build does not
 * recognize simply do not hydrate — `hydrateResource` revives `success` and
 * `invalidate-error` entries and skips everything else.
 */
function normalizeSnapshotStatus(status: string, snapshotVersion: number): string {
    if (snapshotVersion >= CURRENT_SNAPSHOT_VERSION) return status;
    return LEGACY_STATUSES_V1[status] ?? status;
}

export class Snapshotter {
    private readonly _initialSnapshot: TApiSnapshot | null;
    private readonly _snapshotValidTime: number | false;
    private readonly _keyPrefix: string | null;

    constructor(options: TSnapshotterOptions) {
        this._initialSnapshot = options.initialSnapshot;
        this._snapshotValidTime = options.snapshotValidTime;
        this._keyPrefix = options.keyPrefix;
    }

    /**
     * Build hydration entries for a resource from the initial snapshot.
     * Returns `undefined` when no matching snapshot data exists.
     */
    hydrateResource(
        snapshotKey: string | undefined,
        resourceSnapshotValidTime?: number | false,
    ): TResourceSnapshot | undefined {
        const initialSnapshot = this._initialSnapshot;
        if (!initialSnapshot || !snapshotKey || !initialSnapshot.resources[snapshotKey]) {
            return undefined;
        }

        const resSnapshot = initialSnapshot.resources[snapshotKey];
        const entries: Record<string, TResourceSnapshotEntry> = {};
        const now = Date.now();
        const effectiveSnapshotValidTime =
            resourceSnapshotValidTime !== undefined ? resourceSnapshotValidTime : this._snapshotValidTime;

        for (const [entryKey, snapEntry] of Object.entries(resSnapshot.entries)) {
            const status = normalizeSnapshotStatus(snapEntry.status, initialSnapshot.version);
            if (status !== "success" && status !== "invalidate-error") continue;

            // An invalidate-error entry's data is last-known-good (a successful
            // fetch that a later invalidation failed to update). The error itself is
            // transient and not worth reviving, so hydrate it as a stale success:
            // the data shows immediately and a refetch follows the first hold.
            // Likewise an entry the writing side had already marked for
            // revalidation (`isStale` persisted by `getSnapshot`): however fresh
            // its `updatedAt`, that side no longer vouched for the data.
            let isStale = status === "invalidate-error" || snapEntry.isStale === true;
            if (!isStale && effectiveSnapshotValidTime !== false && typeof snapEntry.updatedAt === "number") {
                isStale = snapEntry.updatedAt + effectiveSnapshotValidTime < now;
            }

            entries[entryKey] = {
                // Normalize to "success" — downstream hydration only revives
                // with-data entries and ignores the status field otherwise.
                status: "success",
                args: snapEntry.args,
                data: snapEntry.data,
                updatedAt: snapEntry.updatedAt,
                isStale,
            };
        }

        return Object.keys(entries).length > 0 ? { entries } : undefined;
    }

    /**
     * Collects a serializable snapshot of all registered resources.
     */
    getSnapshot(resources: Resource<any, any>[]): TApiSnapshot {
        const resourcesMap: Record<string, TResourceSnapshot> = {};

        for (const resource of resources) {
            const resourceKey = resource._key;
            if (!resourceKey) continue;
            if (!resource._snapshotable) continue;

            const entries: Record<string, TResourceSnapshotEntry> = {};
            let hasEntries = false;

            for (const entry of resource.getEntries()) {
                const state = entry.peek();

                // `invalidating` with nothing in flight: the revalidation run
                // was aborted and the entry only owes one on its next hold
                // (lazy invalidation). Its data is the last good one and
                // nothing is on its way to replace it, so it is persisted as a
                // stale success — the hydrating side re-queries it on its
                // first hold. An `invalidating` entry with a run in flight is
                // skipped, as before: that run is about to replace the data.
                const isIdleInvalidating = state.status === "invalidating" && !entry._isInFlight;
                if (state.status !== "success" && state.status !== "invalidate-error" && !isIdleInvalidating) continue;

                // A non-null patchState means unconfirmed optimistic patches are
                // still pending; `state.data` reflects them, so persist the
                // confirmed base (`originalData`) instead — mirrors Syncer.
                const data = state.patchState ? state.patchState.originalData : state.data;

                entries[entry.keyedArgs.key] = {
                    status: isIdleInvalidating ? "success" : state.status,
                    args: state.args,
                    data,
                    updatedAt: state.updatedAt,
                    // An entry marked for revalidation carries data it no longer
                    // vouches for: the hydrating side must re-query it too.
                    isStale: isIdleInvalidating || entry.isInvalidated,
                };
                hasEntries = true;
            }

            let snapshotResourceKey = resourceKey;
            if (this._keyPrefix != null && snapshotResourceKey.startsWith(`${this._keyPrefix}/`)) {
                snapshotResourceKey = snapshotResourceKey.slice(this._keyPrefix.length + 1);
            }

            if (hasEntries) {
                resourcesMap[snapshotResourceKey] = { entries };
            }
        }

        return {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: this._keyPrefix,
            timestamp: Date.now(),
            resources: resourcesMap,
        };
    }
}
