import type { Subscription } from "rxjs";

import type { DevtoolsLike, DevtoolsStateLike } from "@/common/devtools";
import { shallowEqual } from "@/common/utils/shallowEqual";
import { createCacheMap } from "@/query-v2/core/CacheMap/createCacheMap";
import { LifecycleHooks } from "@/query-v2/core/LifecycleHooks";
import { stableStringify } from "@/query-v2/lib/stableStringify";
import type {
    ArgsOrVoid,
    ICacheMap,
    IResourceV2,
    IResourceV2CacheEntry,
    IResourceV2Options,
    TCompareArgsFn,
    TMachineInstance,
    TQueryFn,
} from "@/query-v2/types";
import { Signal } from "@/signals";
import { Batcher } from "@/signals/base/Batcher";
import type { SignalFn } from "@/signals/types";

import { ResourceV2Agent } from "./ResourceV2Agent";
import { ResourceV2CacheEntry } from "./ResourceV2CacheEntry";

export class ResourceV2<TArgs, TData> implements IResourceV2<TArgs, TData> {
    private _cache: ICacheMap<TArgs, ResourceV2CacheEntry<TArgs, TData>>;
    private _queryFn: TQueryFn<TArgs, TData>;
    private _compareArgsFn: TCompareArgsFn<TArgs>;
    private _lifecycleHooks: LifecycleHooks<TArgs, TData>;
    private _cacheLifetime: number | false;
    private _status$: SignalFn<"idle" | "ready">;
    private _lastEntry$: SignalFn<ResourceV2CacheEntry<TArgs, TData> | null>;
    private _key: string | undefined;
    private _devtools: DevtoolsLike | undefined;
    private _devtoolsDebug: boolean;
    private _mainDevtoolsUpdater: DevtoolsStateLike | null = null;

    constructor(options: IResourceV2Options<TArgs, TData>) {
        this._queryFn = options.queryFn;
        this._cacheLifetime = options.cacheLifetime ?? 60_000;
        this._compareArgsFn = options.compareArg ?? (shallowEqual as TCompareArgsFn<TArgs>);
        this._lifecycleHooks = new LifecycleHooks<TArgs, TData>(options.onCacheEntryAdded, options.onQueryStarted);
        this._status$ = Signal.state<"idle" | "ready">("idle");
        this._lastEntry$ = Signal.state<ResourceV2CacheEntry<TArgs, TData> | null>(null);
        this._key = options.key;
        this._devtools = options.devtools;
        this._devtoolsDebug = options.devtoolsDebug ?? false;

        const keyStrategy = options.compareArg ? ("compare" as const) : ("serialize" as const);

        this._cache = createCacheMap<TArgs, ResourceV2CacheEntry<TArgs, TData>>({
            keyStrategy,
            factory: (args) => this._entryFactory(args),
            serializeArgs:
                options.serializeArgs ??
                (keyStrategy === "serialize" ? (stableStringify as (args: TArgs) => string) : undefined),
            compareArg: options.compareArg,
            doCacheArgs: options.doCacheArgs,
        });

        // Devtools: register main state entry
        if (this._devtools) {
            const name = `query-v2:${this._key ?? "unknown"}`;
            this._mainDevtoolsUpdater = this._devtools.state<{ status: string; data: unknown; error: unknown }>(name, {
                status: "idle",
                data: null,
                error: null,
            });

            // Debug mode: register internal signals
            if (this._devtoolsDebug) {
                const statusUpdater = this._devtools.state(`query-v2:${this._key ?? "unknown"}/status$`, "idle");
                const origStatusSet = this._status$.set.bind(this._status$);
                this._status$.set = (v: "idle" | "ready") => {
                    origStatusSet(v);
                    statusUpdater(v);
                };

                const lastEntryUpdater = this._devtools.state<string>(
                    `query-v2:${this._key ?? "unknown"}/lastEntry$`,
                    "null",
                );
                const origLastEntrySet = this._lastEntry$.set.bind(this._lastEntry$);
                this._lastEntry$.set = (v: ResourceV2CacheEntry<TArgs, TData> | null) => {
                    origLastEntrySet(v);
                    lastEntryUpdater(v ? "entry" : "null");
                };
            }
        }
    }

    createAgent(): ResourceV2Agent<TArgs, TData> {
        const agent = new ResourceV2Agent<TArgs, TData>(
            this.getEntry$.bind(this) as (...args: unknown[]) => ResourceV2CacheEntry<TArgs, TData> | null,
            (a: TArgs, b: TArgs) => this._compareArgsFn(a, b),
        );

        // Devtools: register agent state
        if (this._devtools) {
            const agentName = `query-v2:${this._key ?? "unknown"}/agent`;
            const agentUpdater = this._devtools.state<{ status: string; data: unknown; error: unknown }>(agentName, {
                status: "idle",
                data: null,
                error: null,
            });

            agent.state$.obs.subscribe({
                next: () => {
                    const state = agent.state$.peek();
                    agentUpdater({ status: state.status, data: state.data, error: state.error });
                },
                complete: () => {
                    agentUpdater("$DISPOSED" as any);
                },
            });
        }

        return agent;
    }

    query(...allArgs: [...ArgsOrVoid<TArgs>, doForce?: boolean]): Promise<TData> {
        const { args, doForce } = this._parseQueryArgs(allArgs);
        const entry = this._cache.getOrCreate(args);
        this._markReady();
        return entry.query(doForce);
    }

    getEntry(...args: ArgsOrVoid<TArgs>): IResourceV2CacheEntry<TArgs, TData> | null;
    getEntry(...args: [...ArgsOrVoid<TArgs>, doInitiate: true]): IResourceV2CacheEntry<TArgs, TData>;
    getEntry(...allArgs: unknown[]): IResourceV2CacheEntry<TArgs, TData> | null {
        const { args, doInitiate } = this._parseGetEntryArgs(allArgs);
        if (doInitiate) {
            return this._getOrCreateEntry(args);
        }
        return this._cache.get(args) ?? null;
    }

    getEntry$(...args: ArgsOrVoid<TArgs>): IResourceV2CacheEntry<TArgs, TData> | null;
    getEntry$(...args: [...ArgsOrVoid<TArgs>, doInitiate: true]): IResourceV2CacheEntry<TArgs, TData>;
    getEntry$(...allArgs: unknown[]): IResourceV2CacheEntry<TArgs, TData> | null {
        const { args, doInitiate } = this._parseGetEntryArgs(allArgs);
        const status = this._status$();
        if (status === "idle" && !doInitiate) return null;
        this._lastEntry$();
        if (doInitiate) {
            const entry = this._cache.getOrCreate(args);
            this._lastEntry$.set(entry);
            this._markReady();
            return entry;
        }
        return this._cache.get(args) ?? null;
    }

    invalidate(...allArgs: ArgsOrVoid<TArgs>): void {
        const args = (allArgs.length > 0 ? allArgs[0] : undefined) as TArgs;
        const entry = this._cache.get(args);
        if (entry) {
            entry.invalidate();
        }
    }

    status$(): "idle" | "ready" {
        return this._status$();
    }

    subscribe(...allArgs: ArgsOrVoid<TArgs>): Subscription {
        const args = (allArgs.length > 0 ? allArgs[0] : undefined) as TArgs;
        const entry = this._cache.getOrCreate(args);
        this._markReady();
        return entry.obs.subscribe();
    }

    // ── Internal methods (called by createApi / Snapshot) ──

    resetCache(): void {
        Batcher.run(() => {
            const entries = [...this._cache.values()];
            this._cache.clear();
            for (const entry of entries) {
                entry.complete();
            }
            this._lifecycleHooks.clearAll();
            this._lastEntry$.set(null);
            this._status$.set("idle");
        });

        // Push idle state to devtools after reset
        if (this._mainDevtoolsUpdater) {
            this._mainDevtoolsUpdater({ status: "idle", data: null, error: null });
        }
    }

    cacheEntries(): IterableIterator<[string | TArgs, ResourceV2CacheEntry<TArgs, TData>]> {
        return this._cache.entries();
    }

    hydrateEntry(args: TArgs, machine: TMachineInstance<TArgs, TData>): void {
        const entry = this._cache.getOrCreate(args);
        entry.set(machine);
        this._markReady();
    }

    hasEntry(args: TArgs): boolean {
        return this._cache.has(args);
    }

    // ── Private ──

    private _getOrCreateEntry(args: TArgs): ResourceV2CacheEntry<TArgs, TData> {
        const entry = this._cache.getOrCreate(args);
        this._lastEntry$.set(entry);
        this._markReady();
        return entry;
    }

    private _markReady(): void {
        if (this._status$.peek() === "idle") {
            this._status$.set("ready");
        }
    }

    private _entryFactory(args: TArgs): ResourceV2CacheEntry<TArgs, TData> {
        const entry = new ResourceV2CacheEntry<TArgs, TData>({
            args,
            queryFn: this._queryFn,
            compareArgs: this._compareArgsFn,
            entryOptions: {
                cacheLifetime: this._cacheLifetime,
            },
            onDataLoaded: (a, data) => this._lifecycleHooks.resolveDataLoaded(a, data),
        });

        // Subscribe to onClean$ for cache removal
        entry.onClean$.subscribe(() => {
            this._cache.delete(args);
            this._lifecycleHooks.fireCacheEntryRemoved(args);
        });

        // Devtools: push state updates for this entry
        if (this._devtools) {
            const devtools = this._devtools;

            // Main state: subscribe to machine$ (computed signal, no GC refcount impact)
            entry.machine$.obs.subscribe(() => {
                const machine = entry.peek();
                this._pushMainDevtoolsState(machine);
            });

            // Debug mode: register individual entry signals
            if (this._devtoolsDebug) {
                const entryName = `query-v2:${this._key ?? "unknown"}/entry(${stableStringify(args)})`;
                let entryUpdater: DevtoolsStateLike | null = null;

                entry.machine$.obs.subscribe(() => {
                    const machine = entry.peek();
                    const snapshot = {
                        status: machine.status,
                        data: machine.data ?? null,
                        error: machine.error ?? null,
                        args: machine.args ?? null,
                    };
                    if (!entryUpdater) {
                        entryUpdater = devtools.state(entryName, snapshot);
                    } else {
                        entryUpdater(snapshot);
                    }
                });

                entry.onClean$.subscribe(() => {
                    if (entryUpdater) entryUpdater("$CLEANED" as any);
                });
            }
        }

        // Fire lifecycle hook for new entry
        this._lifecycleHooks.fireCacheEntryAdded(args, entry);

        return entry;
    }

    private _pushMainDevtoolsState(machine: TMachineInstance<TArgs, TData>): void {
        if (this._mainDevtoolsUpdater) {
            this._mainDevtoolsUpdater({
                status: machine.status,
                data: machine.data ?? null,
                error: machine.error ?? null,
            });
        }
    }

    private _parseQueryArgs(allArgs: unknown[]): { args: TArgs; doForce?: boolean } {
        if (allArgs.length === 0) {
            return { args: undefined as TArgs };
        }
        const last = allArgs[allArgs.length - 1];
        if (typeof last === "boolean") {
            return {
                args: (allArgs.length > 1 ? allArgs[0] : undefined) as TArgs,
                doForce: last,
            };
        }
        return { args: allArgs[0] as TArgs };
    }

    private _parseGetEntryArgs(allArgs: unknown[]): { args: TArgs; doInitiate?: true } {
        if (allArgs.length === 0) {
            return { args: undefined as TArgs };
        }
        const last = allArgs[allArgs.length - 1];
        if (last === true) {
            return {
                args: (allArgs.length > 1 ? allArgs[0] : undefined) as TArgs,
                doInitiate: true,
            };
        }
        return { args: allArgs[0] as TArgs };
    }
}
