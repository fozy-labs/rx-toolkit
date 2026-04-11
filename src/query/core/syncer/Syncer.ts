import type { ISyncDriver, ISyncMessage, TResourceOptions } from "@/query/types";

import type { Resource } from "../resource/Resource";

export interface ISyncerConfig {
    syncDriver: ISyncDriver;
    keyPrefix: string | null;
    defaultSync: "none" | "resources" | "all";
    resourcesByKey: Map<string, Resource<any, any>>;
}

/**
 * Encapsulates cross-tab sync (REQ/RES) logic previously inlined in createApi.
 */
export class Syncer {
    private static readonly SYNC_TIMEOUT_MS = 150;

    private readonly pendingRequests = new Map<
        string,
        {
            resolve: (result: { data: unknown } | null) => void;
            timer: ReturnType<typeof setTimeout>;
        }
    >();

    private readonly syncDriver: ISyncDriver;
    private readonly keyPrefix: string | null;
    private readonly defaultSync: string;
    private readonly resourcesByKey: Map<string, Resource<any, any>>;

    constructor(config: ISyncerConfig) {
        this.syncDriver = config.syncDriver;
        this.keyPrefix = config.keyPrefix;
        this.defaultSync = config.defaultSync;
        this.resourcesByKey = config.resourcesByKey;
    }

    /** Connect the sync driver and start listening for messages. */
    connect(): void {
        this.syncDriver.connect(this.handleIncomingSyncMessage);
    }

    /** Create a beforeQuery hook for resource config. */
    get beforeQuery(): (resourceKey: string, entryKey: string) => Promise<{ data: unknown } | null> {
        return (resourceKey, entryKey) => this.requestDataFromOtherTabs(resourceKey, entryKey);
    }

    /** Check whether sync is enabled for a given resource options. */
    isResourceSyncEnabled(opts: TResourceOptions<any, any>): boolean {
        if (opts.sync !== undefined) return opts.sync;
        return this.defaultSync === "resources" || this.defaultSync === "all";
    }

    /** Clear pending requests and reconnect the sync driver (used by resetAll). */
    cleanup(): void {
        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.resolve(null);
        }
        this.pendingRequests.clear();

        this.syncDriver.disconnect();
        this.syncDriver.connect(this.handleIncomingSyncMessage);
    }

    // ── Private ──

    private handleIncomingSyncMessage = (msg: ISyncMessage): void => {
        if (msg.type === "REQ") {
            if (msg.keys[0] !== (this.keyPrefix ?? "")) return;

            const resource = this.resourcesByKey.get(msg.keys[1]);
            if (!resource) return;

            const entryKey = msg.keys[2];

            const entry = resource.getEntry(entryKey);

            if (!entry) return;

            const machine = entry.peek();
            if (machine.state.status === "success") {
                const data = machine.state.patchState ? machine.state.patchState.originalData : machine.state.data;
                this.syncDriver.send({
                    type: "RES",
                    reqId: msg.reqId,
                    keys: msg.keys,
                    data,
                });
            }
        } else if (msg.type === "RES") {
            const pending = this.pendingRequests.get(msg.reqId);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(msg.reqId);
                pending.resolve(msg.data !== undefined ? { data: msg.data } : null);
            }
        }
    };

    private requestDataFromOtherTabs(resourceKey: string, entryKey: string): Promise<{ data: unknown } | null> {
        const reqId = crypto.randomUUID();
        const keys: [string, string, string] = [this.keyPrefix ?? "", resourceKey, entryKey];

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(reqId);
                resolve(null);
            }, Syncer.SYNC_TIMEOUT_MS);

            this.pendingRequests.set(reqId, { resolve, timer });
            this.syncDriver.send({ type: "REQ", reqId, keys });
        });
    }
}
