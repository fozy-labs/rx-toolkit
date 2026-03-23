import type { TMachineStatus } from "@/query-v2";
import { Machine, type TMachineInstance } from "@/query-v2/core/machines/Machine";
import { MachineSuccess } from "@/query-v2/core/machines/MachineSuccess";
import type { ResourceV2 } from "@/query-v2/core/resource/ResourceV2";
import type { TApiSnapshot, TResourceSnapshot, TResourceV2SnapshotSlice } from "@/query-v2/types/snapshot.types";

export const CURRENT_SNAPSHOT_VERSION = 1;

/**
 * Capture snapshot from all registered resources.
 * Only `MachineSuccess` entries are included (per design §5).
 */
export function getSnapshot(
    resources: Map<string, ResourceV2<any, any, any>>,
    keyPrefix: string | null,
    keyStrategy: "serialize" | "compare",
): TApiSnapshot {
    if (keyStrategy === "compare") {
        throw new Error(
            'getSnapshot() is not supported with keyStrategy "compare". ' +
                'SSR snapshots require keyStrategy "serialize" so that cache keys are serializable strings.',
        );
    }

    const resourceSnapshots: Record<string, TResourceSnapshot> = {};

    for (const [resourceKey, resource] of resources) {
        const entries: Record<string, TResourceV2SnapshotSlice> = {};
        let hasEntries = false;

        for (const [key, cacheEntry] of resource.cacheEntries()) {
            const machine = cacheEntry.peek();
            if (!(machine instanceof MachineSuccess)) continue;

            const state = machine.state;
            entries[key as string] = {
                status: "success",
                args: state.args,
                data: state.data,
                updatedAt: state.updatedAt,
            };
            hasEntries = true;
        }

        if (hasEntries) {
            resourceSnapshots[resourceKey] = { entries };
        }
    }

    return {
        version: CURRENT_SNAPSHOT_VERSION,
        keyPrefix,
        resources: resourceSnapshots,
    };
}

/**
 * Hydrate resources from a snapshot.
 * Validates version and keyPrefix before applying.
 */
export function hydrateSnapshot(
    snapshot: TApiSnapshot,
    resources: Map<string, ResourceV2<any, any, any>>,
    apiKeyPrefix: string | null,
    maxSnapshotDataAge: number,
): void {
    // Fatal: snapshot format incompatibility — the serialization schema has changed between versions.
    // This cannot be recovered from; the snapshot must be regenerated.
    if (snapshot.version !== CURRENT_SNAPSHOT_VERSION) {
        throw new Error(
            `Snapshot version mismatch: expected ${CURRENT_SNAPSHOT_VERSION}, got ${snapshot.version}. ` +
                `The snapshot format is incompatible with the current version of query-v2.`,
        );
    }

    // Fatal: wrong API instance — the snapshot was created by a different keyPrefix configuration.
    // Applying it would pollute the cache with data from an unrelated API.
    if (snapshot.keyPrefix !== apiKeyPrefix) {
        throw new Error(
            `Snapshot keyPrefix mismatch: expected "${apiKeyPrefix}", got "${snapshot.keyPrefix}". ` +
                `Ensure the snapshot was created by the same API instance configuration.`,
        );
    }

    const now = Date.now();

    for (const [resourceKey, resourceSnapshot] of Object.entries(snapshot.resources)) {
        const resource = resources.get(resourceKey);
        if (!resource) {
            // Non-fatal: a resource may have been removed between versions — skip gracefully.
            console.warn(`[rx-toolkit] hydrateSnapshot: unknown resource key "${resourceKey}", skipping.`);
            continue;
        }

        for (const [, slice] of Object.entries(resourceSnapshot.entries)) {
            const machine = Machine.fromSnapshot<unknown>(
                slice as unknown as { status: TMachineStatus } & Record<string, unknown>,
            ) as TMachineInstance<any, any>;

            // Reconstruct args from the slice
            const args = slice.args;

            resource.hydrateEntry(args, machine);

            // S3: stale entries trigger invalidation
            if (now - slice.updatedAt > maxSnapshotDataAge) {
                resource.invalidate(args);
            }
        }
    }
}
