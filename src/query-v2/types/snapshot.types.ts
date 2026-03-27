/** Current snapshot format version */
export const CURRENT_SNAPSHOT_VERSION = 1 as const;

/** Single entry in a resource snapshot */
export interface TResourceV2SnapshotSlice<TData = unknown> {
    readonly status: "success";
    readonly args: unknown;
    readonly data: TData;
    readonly updatedAt: number;
}

/** All entries for a single resource */
export interface TResourceSnapshot {
    readonly entries: Record<string, TResourceV2SnapshotSlice>;
}

/** Full API snapshot — serializable */
export interface TApiSnapshot {
    readonly version: typeof CURRENT_SNAPSHOT_VERSION;
    readonly keyPrefix: string | null;
    readonly timestamp: number;
    readonly resources: Record<string, TResourceSnapshot>;
}
