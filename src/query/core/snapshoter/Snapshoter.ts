import type { TApiSnapshot, TResourceSnapshot, TResourceSnapshotEntry } from "@/query/types";

import { CURRENT_SNAPSHOT_VERSION } from "../../constants";
import type { Resource } from "../resource/Resource";

export interface TSnapshoterOptions {
    initialSnapshot: TApiSnapshot | null;
    snapshotValidTime: number | false;
    keyPrefix: string | null;
}

export class Snapshoter {
    private readonly _initialSnapshot: TApiSnapshot | null;
    private readonly _snapshotValidTime: number | false;
    private readonly _keyPrefix: string | null;

    constructor(options: TSnapshoterOptions) {
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
        if (!this._initialSnapshot || !snapshotKey || !this._initialSnapshot.resources[snapshotKey]) {
            return undefined;
        }

        const resSnapshot = this._initialSnapshot.resources[snapshotKey];
        const entries: Record<string, TResourceSnapshotEntry> = {};
        const now = Date.now();
        const effectiveSnapshotValidTime =
            resourceSnapshotValidTime !== undefined ? resourceSnapshotValidTime : this._snapshotValidTime;

        for (const [entryKey, snapEntry] of Object.entries(resSnapshot.entries)) {
            if (snapEntry.status !== "success") continue;

            let isStale = false;
            if (effectiveSnapshotValidTime !== false && typeof snapEntry.updatedAt === "number") {
                isStale = snapEntry.updatedAt + effectiveSnapshotValidTime < now;
            }

            entries[entryKey] = {
                status: snapEntry.status,
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

            const entries: Record<string, TResourceSnapshotEntry> = {};
            let hasEntries = false;

            for (const entry of resource.getEntries()) {
                const { state } = entry.peek();
                if (state.status !== "success" && state.status !== "refresh-error") continue;

                entries[entry.keyedArgs.key] = {
                    status: state.status,
                    args: state.args,
                    data: state.data,
                    updatedAt: state.updatedAt,
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
