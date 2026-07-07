import type { Observable } from "rxjs";

import type { SYMBOL_DISPOSE } from "../base/disposeSymbol";

/**
 * The signal returned by {@link unstable_KeyedSignal.state}. Callable for a
 * reactive whole-collection snapshot; methods provide keyed access and the two
 * narrower reactive surfaces.
 */
export interface KeyedSignal<V> {
    /** Reactive whole-collection read: wakes on ANY change (add/remove/replace). */
    (): Readonly<Record<string, V>>;
    /** Non-reactive whole-collection snapshot (memoized until the next write). */
    peek(): Readonly<Record<string, V>>;
    /** Alias of {@link peek}. */
    snapshot(): Readonly<Record<string, V>>;
    /** Number of entries currently present. */
    readonly size: number;
    /** Return entry by key, or `undefined`. Non-reactive. */
    get(key: string): V | undefined;
    /** Reactive per-key read: wakes only when THIS key is added/removed/replaced. */
    get$(key: string): V | undefined;
    /** Store an entry. O(1). */
    set(key: string, value: V): void;
    /** Remove an entry. Returns whether it was present. O(1). */
    delete(key: string): boolean;
    /** Whether the key is present. Non-reactive. */
    has(key: string): boolean;
    /** Remove all entries. */
    clear(): void;
    /** Iterate present values. Non-reactive. */
    values(): IterableIterator<V>;
    /** Reactive structural read: wakes only on add/remove, not value replacement. */
    values$(): V[];
    /** Snapshot stream: emits the current snapshot on every change. */
    readonly obs: Observable<Readonly<Record<string, V>>>;
    dispose(): void;
    [SYMBOL_DISPOSE](): void;
}
