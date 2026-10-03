// ==================== Snapshot Types ====================

export interface TResourceSnapshotEntry {
    status: string;
    args: unknown;
    data: unknown;
    updatedAt: number;
    isStale?: boolean;
}

export interface TResourceSnapshot {
    entries: Record<string, TResourceSnapshotEntry>;
}

export interface TApiSnapshot {
    version: number;
    keyPrefix: string | null;
    timestamp: number;
    resources: Record<string, TResourceSnapshot>;
}

// ==================== Sync Types ====================

export interface ISyncMessage {
    type: "REQ" | "RES";
    reqId: string;
    keys: [string, string, string];
    data?: unknown;
}

/** What the api tells its sync driver on connect. */
export interface TSyncDriverContext {
    /** The api `keyPrefix`; `""` when the api has none. */
    keyPrefix: string;
}

export interface ISyncDriver {
    connect(onMessage: (msg: ISyncMessage) => void, context: TSyncDriverContext): void;
    disconnect(): void;
    send(message: ISyncMessage): void;
}
