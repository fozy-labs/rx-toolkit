import { shallowEqual } from "@/common/utils/shallowEqual";
import { stableStringify } from "@/query-v2/lib/stableStringify";
import type { ICacheMapOptions } from "@/query-v2/types/cache.types";

import type { CacheEntry } from "./CacheEntry";

class SerializedCacheMap<TArgs, TState> {
    private readonly _map = new Map<string, CacheEntry<TState>>();
    private readonly _serializeArgs: (args: unknown) => string;
    private readonly _argsMemo: WeakMap<object, string> | null;

    constructor(serializeArgs: (args: unknown) => string, doCacheArgs: boolean) {
        this._serializeArgs = serializeArgs;
        this._argsMemo = doCacheArgs ? new WeakMap() : null;
    }

    private _serialize(args: TArgs): string {
        if (this._argsMemo && typeof args === "object" && args !== null) {
            let cached = this._argsMemo.get(args as object);
            if (cached === undefined) {
                cached = this._serializeArgs(args);
                this._argsMemo.set(args as object, cached);
            }
            return cached;
        }
        return this._serializeArgs(args);
    }

    get(args: TArgs): CacheEntry<TState> | undefined {
        return this._map.get(this._serialize(args));
    }

    set(args: TArgs, entry: CacheEntry<TState>): void {
        this._map.set(this._serialize(args), entry);
    }

    getOrCreate(args: TArgs, factory: () => CacheEntry<TState>): CacheEntry<TState> {
        const key = this._serialize(args);
        let entry = this._map.get(key);
        if (!entry) {
            entry = factory();
            this._map.set(key, entry);
        }
        return entry;
    }

    delete(args: TArgs): boolean {
        return this._map.delete(this._serialize(args));
    }

    has(args: TArgs): boolean {
        return this._map.has(this._serialize(args));
    }

    values(): Iterable<CacheEntry<TState>> {
        return this._map.values();
    }

    entries(): Iterable<[string, CacheEntry<TState>]> {
        return this._map.entries();
    }

    clear(): void {
        this._map.clear();
    }

    get size(): number {
        return this._map.size;
    }
}

class CompareCacheMap<TArgs, TState> {
    private readonly _items: Array<{ args: TArgs; entry: CacheEntry<TState> }> = [];
    private readonly _compareArg: (a: unknown, b: unknown) => boolean;

    constructor(compareArg: (a: unknown, b: unknown) => boolean) {
        this._compareArg = compareArg;
    }

    private _findIndex(args: TArgs): number {
        for (let i = 0; i < this._items.length; i++) {
            if (this._compareArg(this._items[i].args, args)) {
                return i;
            }
        }
        return -1;
    }

    get(args: TArgs): CacheEntry<TState> | undefined {
        const idx = this._findIndex(args);
        return idx >= 0 ? this._items[idx].entry : undefined;
    }

    set(args: TArgs, entry: CacheEntry<TState>): void {
        const idx = this._findIndex(args);
        if (idx >= 0) {
            this._items[idx] = { args, entry };
        } else {
            this._items.push({ args, entry });
        }
    }

    getOrCreate(args: TArgs, factory: () => CacheEntry<TState>): CacheEntry<TState> {
        const idx = this._findIndex(args);
        if (idx >= 0) {
            return this._items[idx].entry;
        }
        const entry = factory();
        this._items.push({ args, entry });
        return entry;
    }

    delete(args: TArgs): boolean {
        const idx = this._findIndex(args);
        if (idx >= 0) {
            this._items.splice(idx, 1);
            return true;
        }
        return false;
    }

    has(args: TArgs): boolean {
        return this._findIndex(args) >= 0;
    }

    *values(): Iterable<CacheEntry<TState>> {
        for (const item of this._items) {
            yield item.entry;
        }
    }

    *entries(): Iterable<[TArgs, CacheEntry<TState>]> {
        for (const item of this._items) {
            yield [item.args, item.entry];
        }
    }

    clear(): void {
        this._items.length = 0;
    }

    get size(): number {
        return this._items.length;
    }
}

export const CacheMap = {
    create<TArgs, TData>(options: ICacheMapOptions<TArgs>){
        if (options.keyStrategy === "compare") {
            return new CompareCacheMap<TArgs, TData>(options.compareArg ?? shallowEqual);
        }
        return new SerializedCacheMap<TArgs, TData>(
            options.serializeArgs ?? stableStringify,
            options.doCacheArgs,
        );
    },
};
