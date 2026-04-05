import { Machine } from "@/query/core/machines/Machine";
import type { TApiSnapshot, TResourceSnapshot, TResourceSnapshotSlice } from "@/query/types";
import { CURRENT_SNAPSHOT_VERSION } from "@/query/types";

import type { Resource } from "./resource/Resource";

/**
 * Capture a snapshot of all success entries across all resources.
 * Only entries in MachineSuccess state are included.
 * Throws for compare strategy resources (non-serializable keys).
 */
export function getSnapshot<TArgs = unknown, TData = unknown>(
    resources: Map<string, Resource<TArgs, TData>>,
    keyPrefix: string | null = null,
): TApiSnapshot {
    const result: Record<string, TResourceSnapshot> = {};

    for (const [resourceKey, resource] of resources) {
        if (resource.strategy === "compare") {
            throw new Error(
                `getSnapshot: Resource "${resourceKey}" uses compare strategy with non-serializable keys. ` +
                    `Only serialize strategy resources can be captured in snapshots.`,
            );
        }

        const entries: Record<string, TResourceSnapshotSlice> = {};
        let hasEntries = false;

        for (const entry of resource.cacheValues()) {
            const machine = entry.peek();
            if (machine.status === "success") {
                entries[entry.argsKey] = {
                    status: "success",
                    args: machine.args,
                    data: machine.data,
                    updatedAt: machine.updatedAt,
                };
                hasEntries = true;
            }
        }

        if (hasEntries) {
            result[resourceKey] = { entries };
        }
    }

    return {
        version: CURRENT_SNAPSHOT_VERSION,
        keyPrefix,
        timestamp: Date.now(),
        resources: result,
    };
}

/**
 * Hydrate a snapshot into resources (core-level, takes Map<string, Resource>).
 * This is an internal function — the public hydrateSnapshot takes IApi parameter
 * and is defined in the API layer.
 */
export function hydrateSnapshot<TArgs = unknown, TData = unknown>(
    resources: Map<string, Resource<TArgs, TData>>,
    snapshot: TApiSnapshot,
): void {
    if (snapshot.version !== CURRENT_SNAPSHOT_VERSION) {
        throw new Error(
            `hydrateSnapshot: Snapshot version mismatch. Expected ${CURRENT_SNAPSHOT_VERSION}, got ${snapshot.version}.`,
        );
    }

    for (const [resourceKey, resourceSnapshot] of Object.entries(snapshot.resources)) {
        const resource = resources.get(resourceKey);
        if (!resource) continue;

        for (const [_entryKey, slice] of Object.entries(resourceSnapshot.entries)) {
            try {
                const machine = Machine.fromSnapshot<TArgs, TData>({
                    status: slice.status,
                    args: slice.args as TArgs,
                    data: slice.data as TData,
                    error: null,
                    updatedAt: slice.updatedAt,
                    patchState: null,
                });
                resource.hydrateEntry(slice.args as TArgs, machine);
            } catch {
                console.warn(`hydrateSnapshot: Skipping malformed entry "${_entryKey}" in resource "${resourceKey}".`);
            }
        }
    }
}
