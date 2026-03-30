import type { ICacheMap, ICacheMapOptions, TCacheMapFactory } from "@/query-v2/types";

/**
 * CacheMap implementation using Map with reference identity.
 * Used when keyStrategy = "compare" (e.g., for non-serializable args).
 */
export class CompareCacheMap<TArgs, TEntry> implements ICacheMap<TArgs, TEntry> {
    private _map = new Map<TArgs, TEntry>();
    private _factory: TCacheMapFactory<TArgs, TEntry>;
    private _counter = 0;
    private _devtoolsKey: ((args: TArgs) => string) | undefined;

    constructor(options: ICacheMapOptions<TArgs, TEntry>) {
        this._factory = options.factory;
        this._devtoolsKey = options.devtoolsKey;
    }

    get(args: TArgs): TEntry | undefined {
        return this._map.get(args);
    }

    create(args: TArgs, factory: (argsKey: string) => TEntry): TEntry {
        const argsKey = this._devtoolsKey ? this._devtoolsKey(args) : String(this._counter++);
        const entry = factory(argsKey);
        this._map.set(args, entry);
        return entry;
    }

    getOrCreate(args: TArgs): TEntry {
        let entry = this._map.get(args);
        if (entry) return entry;

        const argsKey = this._devtoolsKey ? this._devtoolsKey(args) : String(this._counter++);

        entry = this._factory(args, argsKey);
        this._map.set(args, entry);
        return entry;
    }

    delete(args: TArgs): boolean {
        return this._map.delete(args);
    }

    has(args: TArgs): boolean {
        return this._map.has(args);
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
