import type { Subscription } from "rxjs";

import { shallowEqual } from "@/common/utils/shallowEqual";
import { createCacheMap } from "@/query-v2/core/CacheMap/createCacheMap";
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
    private _onCacheEntryAdded;
    private _onQueryStarted;
    private _beforeDevtoolsPush;
    private _cacheLifetime;
    private _key;
    private _keyStrategy;

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
        this._onCacheEntryAdded = options.onCacheEntryAdded;
        this._onQueryStarted = options.onQueryStarted;
        this._beforeDevtoolsPush = options.beforeDevtoolsPush;
        this._key = options.key;

        const keyStrategy = options.compareArg ? ("compare" as const) : ("serialize" as const);
        this._keyStrategy = keyStrategy;

        this._cache = createCacheMap<TArgs, ResourceV2CacheEntry<TArgs, TData>>({
            keyStrategy,
            factory: (args, argsKey) => this._entryFactory(args, argsKey),
            serializeArgs: options.serializeArgs ?? stableStringify,
            compareArg: options.compareArg,
            doCacheArgs: options.doCacheArgs,
            devtoolsKey: options.devtoolsKey,
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
            this._lastEntry$.set(null);
            this.status$.set("idle");
        });
    }

    cacheValues(): IterableIterator<ResourceV2CacheEntry<TArgs, TData>> {
        return this._cache.values();
    }

    get keyStrategy(): "serialize" | "compare" {
        return this._keyStrategy;
    }

    hydrateEntry(args: TArgs, machine: TMachineInstance<TArgs, TData>): void {
        this._cache.create(args, (argsKey) => this._entryFactory(args, argsKey, machine));
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

    private _entryFactory(
        args: TArgs,
        argsKey: string,
        initialMachine?: TMachineInstance<TArgs, TData>,
    ): ResourceV2CacheEntry<TArgs, TData> {
        const entry = new ResourceV2CacheEntry<TArgs, TData>({
            args,
            argsKey,
            queryFn: this._queryFn,
            compareArgs: this._compareArgsFn,
            entryOptions: {
                keyParts: this._key ? ["Resource/", `${this._key}/`, argsKey] : undefined,
                beforeDevtoolsPush: this._beforeDevtoolsPush,
                cacheLifetime: this._cacheLifetime,
            },
            onCacheEntryAdded: this._onCacheEntryAdded,
            onQueryStarted: this._onQueryStarted,
            initialMachine,
        });

        // Subscribe to onClean$ for cache removal
        entry.onClean$.subscribe(() => {
            this._cache.delete(args);
        });

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
