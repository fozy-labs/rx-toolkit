import { shallowEqual } from "@/common/utils/shallowEqual";
import type { ICacheMap, ICacheMapOptions, TCacheMapFactory } from "@/query-v2/types";

/**
 * CacheMap implementation using linear scan with custom comparison.
 * Used when keyStrategy = "compare" (e.g., for non-serializable args).
 */
export class CompareCacheMap<TArgs, TEntry> implements ICacheMap<TArgs, TEntry> {
    private _entries: Array<{ args: TArgs; entry: TEntry }> = [];
    private _factory: TCacheMapFactory<TArgs, TEntry>;
    private _compareArg: (a: TArgs, b: TArgs) => boolean;

    constructor(options: ICacheMapOptions<TArgs, TEntry>) {
        this._factory = options.factory;
        this._compareArg = (options.compareArg as (a: TArgs, b: TArgs) => boolean) ?? shallowEqual;
    }

    private _find(args: TArgs): { args: TArgs; entry: TEntry } | undefined {
        return this._entries.find((e) => this._compareArg(e.args, args));
    }

    get(args: TArgs): TEntry | undefined {
        return this._find(args)?.entry;
    }

    getOrCreate(args: TArgs): TEntry {
        const existing = this._find(args);
        if (existing) return existing.entry;
        const entry = this._factory(args);
        this._entries.push({ args, entry });
        return entry;
    }

    delete(args: TArgs): boolean {
        const index = this._entries.findIndex((e) => this._compareArg(e.args, args));
        if (index === -1) return false;
        this._entries.splice(index, 1);
        return true;
    }

    has(args: TArgs): boolean {
        return this._find(args) !== undefined;
    }

    clear(): void {
        this._entries = [];
    }

    get size(): number {
        return this._entries.length;
    }

    *values(): IterableIterator<TEntry> {
        for (const { entry } of this._entries) {
            yield entry;
        }
    }

    *entries(): IterableIterator<[TArgs, TEntry]> {
        for (const { args, entry } of this._entries) {
            yield [args, entry];
        }
    }
}
