import type { ICacheMap } from "@/query/types";

/** Simple key→value container mapping string keys to cache entries. */
export class CacheMap<TValue> implements ICacheMap<TValue> {
    private readonly _map = new Map<string, TValue>();

    /** Number of entries currently stored. */
    get size(): number {
        return this._map.size;
    }

    /** Return entry by key, or `undefined` if absent. */
    get(key: string): TValue | undefined {
        return this._map.get(key);
    }

    /** Store an entry under the given key. */
    set(key: string, value: TValue): void {
        this._map.set(key, value);
    }

    /** Remove an entry. Returns `true` if the entry existed. */
    delete(key: string): boolean {
        return this._map.delete(key);
    }

    /** Check whether an entry with the given key exists. */
    has(key: string): boolean {
        return this._map.has(key);
    }

    /** Remove all entries. */
    clear(): void {
        this._map.clear();
    }

    /** Iterate over all stored values. */
    values(): IterableIterator<TValue> {
        return this._map.values();
    }
}
