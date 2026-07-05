import type { ICacheMap } from "@/query/types";
import { Signal } from "@/signals";

/** Simple key→value container mapping string keys to cache entries. */
export class CacheMap<TValue> implements ICacheMap<TValue> {
    private readonly _map = new Map<string, TValue>();

    /**
     * Reactivity anchor: bumped on every mutation that changes the map's contents
     * (set / effective delete / non-empty clear). Reactive reads via {@link get$}
     * track it, so observers re-evaluate when an entry is added or removed — even a
     * "non-last" entry whose removal touches no other signal.
     */
    private readonly _version$ = Signal.state(0, { isDisabled: true });

    /** Number of entries currently stored. */
    get size(): number {
        return this._map.size;
    }

    /** Return entry by key, or `undefined` if absent. Non-reactive. */
    get(key: string): TValue | undefined {
        return this._map.get(key);
    }

    /**
     * Reactive variant of {@link get}: establishes a signal dependency on the map's
     * version, so callers in a reactive context (`Signal.compute` / `Signal.effect`)
     * re-evaluate when any entry is added or removed.
     */
    get$(key: string): TValue | undefined {
        this._version$();
        return this._map.get(key);
    }

    /** Store an entry under the given key. */
    set(key: string, value: TValue): void {
        this._map.set(key, value);
        this._bump();
    }

    /** Remove an entry. Returns `true` if the entry existed. */
    delete(key: string): boolean {
        const existed = this._map.delete(key);
        if (existed) this._bump();
        return existed;
    }

    /** Check whether an entry with the given key exists. */
    has(key: string): boolean {
        return this._map.has(key);
    }

    /** Remove all entries. */
    clear(): void {
        if (this._map.size === 0) return;
        this._map.clear();
        this._bump();
    }

    /** Iterate over all stored values. */
    values(): IterableIterator<TValue> {
        return this._map.values();
    }

    /** Invalidate reactive readers. Only called on an actual content change. */
    private _bump(): void {
        this._version$.update((v) => v + 1);
    }
}
