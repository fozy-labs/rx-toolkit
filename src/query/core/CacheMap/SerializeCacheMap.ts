import { stableStringify } from "@/query/lib/stableStringify";
import type { ICacheMap, ICacheMapOptions, TCacheMapFactory } from "@/query/types";

/**
 * CacheMap implementation using serialized string keys.
 * Default strategy when keyStrategy = "serialize".
 */
export class SerializeCacheMap<TArgs, TEntry> implements ICacheMap<TArgs, TEntry> {
    private _map = new Map<string, TEntry>();
    private _factory: TCacheMapFactory<TArgs, TEntry>;
    private _serializeArgs: (args: TArgs) => string;
    private _argsCache: WeakMap<object, string> | null;

    constructor(options: ICacheMapOptions<TArgs, TEntry>) {
        this._factory = options.factory;
        this._serializeArgs = (options.serializeArgs as (args: TArgs) => string) ?? stableStringify;
        this._argsCache = options.doCacheArgs ? new WeakMap() : null;
    }

    private _getKey(args: TArgs): string {
        if (this._argsCache && typeof args === "object" && args !== null) {
            let cached = this._argsCache.get(args as object);
            if (cached === undefined) {
                cached = this._serializeArgs(args);
                this._argsCache.set(args as object, cached);
            }
            return cached;
        }
        return this._serializeArgs(args);
    }

    get(args: TArgs): TEntry | undefined {
        return this._map.get(this._getKey(args));
    }

    create(args: TArgs, factory: (argsKey: string) => TEntry): TEntry {
        const key = this._getKey(args);
        const entry = factory(key);
        this._map.set(key, entry);
        return entry;
    }

    getOrCreate(args: TArgs): TEntry {
        const key = this._getKey(args);
        let entry = this._map.get(key);
        if (!entry) {
            entry = this._factory(args, key);
            this._map.set(key, entry);
        }
        return entry;
    }

    delete(args: TArgs): boolean {
        return this._map.delete(this._getKey(args));
    }

    has(args: TArgs): boolean {
        return this._map.has(this._getKey(args));
    }

    clear(): void {
        this._map.clear();
    }

    get size(): number {
        return this._map.size;
    }

    *values(): IterableIterator<TEntry> {
        yield* this._map.values();
    }
}
