import type { Subscription } from "rxjs";

import { shallowEqual } from "@/common/utils/shallowEqual";
import { createCacheMap } from "@/query-v2/core/CacheMap/createCacheMap";
import { LifecycleHooks } from "@/query-v2/core/LifecycleHooks";
import { stableStringify } from "@/query-v2/lib/stableStringify";
import type {
    ArgsOrVoid,
    IResourceV2,
    IResourceV2CacheEntry,
    TCompareArgsFn,
    TMachineInstance,
    TResourceV2Options,
} from "@/query-v2/types";
import { Signal } from "@/signals";
import { Batcher } from "@/signals/base/Batcher";

import { ResourceV2Agent } from "./ResourceV2Agent";
import { ResourceV2CacheEntry } from "./ResourceV2CacheEntry";

export class ResourceV2<TArgs, TData> implements IResourceV2<TArgs, TData> {
    private _cache;
    private _queryFn;
    private _compareArgsFn;
    private _lifecycleHooks;
    private _cacheLifetime;
    private _key;

    private _pendingInitialMachine: TMachineInstance<TArgs, TData> | undefined;
    private _lastEntry$ = Signal.state<ResourceV2CacheEntry<TArgs, TData> | null>(null, {
        isDisabled: true,
    });

    readonly status$ = Signal.state<"idle" | "ready">("idle", {
        isDisabled: true,
    });

    constructor(options: TResourceV2Options<TArgs, TData>) {
        this._queryFn = options.queryFn;
        this._compareArgsFn = options.compareArg ?? (shallowEqual as TCompareArgsFn<TArgs>);
        this._cacheLifetime = options.cacheLifetime ?? 60_000;
        this._lifecycleHooks = new LifecycleHooks<TArgs, TData>(options.onCacheEntryAdded, options.onQueryStarted);
        this._key = options.key;

        const keyStrategy = options.compareArg ? ("compare" as const) : ("serialize" as const);

        this._cache = createCacheMap<TArgs, ResourceV2CacheEntry<TArgs, TData>>({
            keyStrategy,
            factory: (args) => this._entryFactory(args),
            serializeArgs: options.serializeArgs ?? stableStringify,
            compareArg: options.compareArg,
            doCacheArgs: options.doCacheArgs,
        });
    }

    createAgent(): ResourceV2Agent<TArgs, TData> {
        return new ResourceV2Agent<TArgs, TData>(
            (args) => this._getEntry$(args, true),
            (a: TArgs, b: TArgs) => this._compareArgsFn(a, b),
        );
    }

    query(...allArgs: [...ArgsOrVoid<TArgs>, doForce?: boolean]): Promise<TData> {
        const { args, doForce } = this._parseQueryArgs(allArgs);
        const entry = this._cache.getOrCreate(args);
        return entry.query(doForce);
    }

    getEntry(...args: ArgsOrVoid<TArgs>): IResourceV2CacheEntry<TArgs, TData> | null;
    getEntry(...args: [...ArgsOrVoid<TArgs>, doInitiate: true]): IResourceV2CacheEntry<TArgs, TData>;
    getEntry(...allArgs: unknown[]): IResourceV2CacheEntry<TArgs, TData> | null {
        const { args, doInitiate } = this._parseGetEntryArgs(allArgs);
        if (doInitiate) {
            return this._cache.getOrCreate(args);
        }
        return this._cache.get(args) ?? null;
    }

    getEntry$(...args: ArgsOrVoid<TArgs>): IResourceV2CacheEntry<TArgs, TData> | null;
    getEntry$(...args: [...ArgsOrVoid<TArgs>, doInitiate: true]): IResourceV2CacheEntry<TArgs, TData>;
    getEntry$(...allArgs: unknown[]): IResourceV2CacheEntry<TArgs, TData> | null {
        const { args, doInitiate } = this._parseGetEntryArgs(allArgs);
        return this._getEntry$(args, doInitiate);
    }

    invalidate(...allArgs: ArgsOrVoid<TArgs>): void {
        const args = (allArgs.length > 0 ? allArgs[0] : undefined) as TArgs;
        const entry = this._cache.get(args);
        if (entry) {
            entry.invalidate();
        }
    }

    subscribe(...allArgs: ArgsOrVoid<TArgs>): Subscription {
        const args = (allArgs.length > 0 ? allArgs[0] : undefined) as TArgs;
        const entry = this._cache.getOrCreate(args);
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
            this.status$.set("idle");
        });
    }

    cacheEntries(): IterableIterator<[string | TArgs, ResourceV2CacheEntry<TArgs, TData>]> {
        return this._cache.entries();
    }

    hydrateEntry(args: TArgs, machine: TMachineInstance<TArgs, TData>): void {
        this._pendingInitialMachine = machine;
        this._cache.getOrCreate(args);
        this._pendingInitialMachine = undefined;
    }

    hasEntry(args: TArgs): boolean {
        return this._cache.has(args);
    }

    // ── Private ──

    private _getEntry$(args: TArgs, doInitiate: true): ResourceV2CacheEntry<TArgs, TData>;
    private _getEntry$(args: TArgs, doInitiate?: boolean): ResourceV2CacheEntry<TArgs, TData> | null;
    private _getEntry$(args: TArgs, doInitiate?: boolean): ResourceV2CacheEntry<TArgs, TData> | null {
        const status = this.status$();

        if (status === "idle" && !doInitiate) return null;

        if (doInitiate) {
            return this._cache.getOrCreate(args);
        }

        return this._cache.get(args) ?? null;
    }

    private _entryFactory(args: TArgs): ResourceV2CacheEntry<TArgs, TData> {
        const initialMachine = this._pendingInitialMachine;
        this._pendingInitialMachine = undefined;

        const entry = new ResourceV2CacheEntry<TArgs, TData>({
            args,
            queryFn: this._queryFn,
            compareArgs: this._compareArgsFn,
            entryOptions: {
                keyParts: this._key ? ["Resource/", this._key] : undefined,
                cacheLifetime: this._cacheLifetime,
            },
            onDataLoaded: (a, data) => this._lifecycleHooks.resolveDataLoaded(a, data),
            onQueryStarted: (a, entry) => this._lifecycleHooks.fireQueryStarted(a, entry),
            onQueryFulfilled: (a, result) => this._lifecycleHooks.resolveQueryFulfilled(a, result),
            initialMachine,
        });

        // Subscribe to onClean$ for cache removal
        entry.onClean$.subscribe(() => {
            this._cache.delete(args);
            this._lifecycleHooks.fireCacheEntryRemoved(args);
        });

        // Fire lifecycle hook for new entry
        this._lifecycleHooks.fireCacheEntryAdded(args, entry);

        if (this.status$.peek() === "idle") {
            this.status$.set("ready");
        }

        this._lastEntry$.set(entry);

        return entry;
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
