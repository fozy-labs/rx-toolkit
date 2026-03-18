/** Full API snapshot for SSR */
export interface TApiSnapshot {
    /** Format version (integer counter) */
    version: number;
    /** keyPrefix of the API instance */
    keyPrefix: string | null;
    /** Resource snapshots keyed by resource key */
    resources: Record<string, TResourceSnapshot>;
}

/** Single resource snapshot */
export interface TResourceSnapshot {
    /** Cache entries keyed by serialized args */
    entries: Record<string, TResourceV2SnapshotSlice>;
}

/** Single cache entry snapshot */
export interface TResourceV2SnapshotSlice<TData = unknown> {
    status: "success";
    args: unknown;
    data: TData;
    updatedAt: number;
}
