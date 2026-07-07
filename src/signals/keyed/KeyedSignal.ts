import { BehaviorSubject, map, Observable } from "rxjs";

import { Batcher, DependencyTracker, type DependencyRecord } from "../base";
import { SYMBOL_DISPOSE } from "../base/disposeSymbol";
import { State } from "../signals/State";

import type { KeyedSignal } from "./types";

/**
 * A reactive per-key node. Reactivity is fine-grained: an observer of one key
 * is never woken by changes to another. `peek` reads the live value from the
 * owning collection (not this local subject) so that a dormant Computed's
 * ComputeCache stays truthful even after this node is reaped and, later,
 * recreated with a different subject.
 */
class KeyNode<V> {
    private readonly _bs$: BehaviorSubject<V | undefined>;
    readonly depRecord: DependencyRecord;
    private _refCount = 0;

    constructor(initialValue: V | undefined, peekLive: () => V | undefined, onIdle: () => void) {
        this._bs$ = new BehaviorSubject<V | undefined>(initialValue);
        // Precise per-key refcount: each reactive observer subscribes here; when
        // the last one leaves, the collection is notified so it can reap a node
        // whose key is gone (otherwise nodes for churned keys would accumulate).
        const obs = new Observable<V | undefined>((subscriber) => {
            this._refCount++;
            const sub = this._bs$.subscribe(subscriber);
            return () => {
                sub.unsubscribe();
                if (--this._refCount === 0) onIdle();
            };
        });
        this.depRecord = { getRang: () => 0, obs, peek: peekLive };
    }

    get observed(): boolean {
        return this._refCount > 0;
    }

    /** Reactive read: tracks this node in the current tracking context. */
    read(): V | undefined {
        if (DependencyTracker.isTracking) DependencyTracker.track(this.depRecord);
        return this._bs$.getValue();
    }

    /** Push a new value to observers. Must run inside a Batcher.run (the caller wraps). */
    notify(value: V | undefined): void {
        if (Object.is(value, this._bs$.getValue())) return;
        this._bs$.next(value);
    }

    dispose(): void {
        this._bs$.complete();
    }
}

/**
 * Backing implementation for {@link unstable_KeyedSignal}. Exposed for internal
 * tests (node lifecycle); consumers use the `.state()` factory.
 */
export class KeyedStore<V> {
    /** Source of truth for present entries — non-reactive reads and iteration. */
    private readonly _present = new Map<string, V>();
    /** Reactive nodes, materialized lazily; a superset of observed keys only. */
    private readonly _nodes = new Map<string, KeyNode<V>>();
    /** Bumped on add/remove — structural reactivity (values$). */
    private readonly _structVersion$ = new State(0, { isDisabled: true });
    /** Bumped on every change (incl. value replacement) — whole-snapshot reactivity. */
    private readonly _anyVersion$ = new State(0, { isDisabled: true });
    /** Memoized whole-collection snapshot, invalidated on any write. */
    private _snapshot: Record<string, V> | null = null;

    readonly obs: Observable<Readonly<Record<string, V>>>;

    constructor(initial?: Record<string, V> | Iterable<readonly [string, V]>) {
        if (initial) {
            // A plain object → its own entries; anything iterable (array of
            // pairs, Map) → its entries directly. Pure init: no version bump,
            // no nodes — there are no observers yet.
            const entries: Iterable<readonly [string, V]> =
                Symbol.iterator in initial ? initial : Object.entries(initial);
            for (const [key, value] of entries) this._present.set(key, value);
        }
        this.obs = this._anyVersion$.obs.pipe(map(() => this.snapshot()));
    }

    get size(): number {
        return this._present.size;
    }

    /** Reactive whole-collection read: tracks any change, returns the snapshot. */
    readAll(): Readonly<Record<string, V>> {
        this._anyVersion$.get();
        return this.snapshot();
    }

    get(key: string): V | undefined {
        return this._present.get(key);
    }

    get$(key: string): V | undefined {
        // Materialize a node only under tracking: an untracked call gains no
        // reactivity, so allocating a node (and the creation-reap churn that
        // follows for an absent key) would be pure waste.
        if (!DependencyTracker.isTracking) return this._present.get(key);
        return this._ensureNode(key).read();
    }

    has(key: string): boolean {
        return this._present.has(key);
    }

    set(key: string, value: V): void {
        Batcher.run(() => {
            const existed = this._present.has(key);
            if (existed && Object.is(this._present.get(key), value)) return;
            this._present.set(key, value);
            this._snapshot = null;
            this._nodes.get(key)?.notify(value);
            this._anyVersion$.update((v) => v + 1);
            if (!existed) this._structVersion$.update((v) => v + 1);
        });
    }

    delete(key: string): boolean {
        return Batcher.run(() => {
            if (!this._present.delete(key)) return false;
            this._snapshot = null;
            const node = this._nodes.get(key);
            if (node) {
                node.notify(undefined);
                // No live value and no observers → drop the node immediately.
                if (!node.observed) {
                    node.dispose();
                    this._nodes.delete(key);
                }
            }
            this._anyVersion$.update((v) => v + 1);
            this._structVersion$.update((v) => v + 1);
            return true;
        });
    }

    clear(): void {
        if (this._present.size === 0) return;
        Batcher.run(() => {
            this._present.clear();
            this._snapshot = null;
            for (const [key, node] of this._nodes) {
                node.notify(undefined);
                if (!node.observed) {
                    node.dispose();
                    this._nodes.delete(key);
                }
            }
            this._anyVersion$.update((v) => v + 1);
            this._structVersion$.update((v) => v + 1);
        });
    }

    values(): IterableIterator<V> {
        return this._present.values();
    }

    /** Reactive whole-collection read: tracks structure only (add/remove). */
    values$(): V[] {
        this._structVersion$.get();
        return [...this._present.values()];
    }

    snapshot(): Readonly<Record<string, V>> {
        if (this._snapshot === null) {
            this._snapshot = Object.fromEntries(this._present) as Record<string, V>;
        }
        return this._snapshot;
    }

    dispose(): void {
        for (const node of this._nodes.values()) node.dispose();
        this._nodes.clear();
        this._present.clear();
        this._snapshot = null;
        this._structVersion$.dispose();
        this._anyVersion$.dispose();
    }

    private _ensureNode(key: string): KeyNode<V> {
        let node = this._nodes.get(key);
        if (!node) {
            node = new KeyNode<V>(
                this._present.get(key),
                () => this._present.get(key),
                () => this._reap(key),
            );
            this._nodes.set(key, node);
            // A tracked read does not guarantee a subscription: a tracker may
            // only record `peek` (e.g. a dormant Computed's ComputeCache) and
            // never subscribe, so the last-observer-leaving reap would never
            // fire for this node. Schedule a reap at creation too — if nobody
            // subscribes by the end of the tick and the key is absent, the
            // node is dropped instead of leaking until dispose().
            this._reap(key);
        }
        return node;
    }

    /**
     * Deferred reap: scheduled when a node's last observer leaves AND when a
     * node is created (a tracker may record the dependency without ever
     * subscribing — see {@link _ensureNode}). A (re-)subscribe within the same
     * tick (e.g. a Computed swapping its dependencies, or an Effect that
     * subscribes synchronously during its tracked run) lands before this
     * fires; and a node whose key is still present is kept. Only a
     * gone-and-unobserved node is dropped. The defer also prevents a
     * flickering selector from thrashing.
     */
    private _reap(key: string): void {
        queueMicrotask(() => {
            const node = this._nodes.get(key);
            if (!node || node.observed || this._present.has(key)) return;
            node.dispose();
            this._nodes.delete(key);
        });
    }
}

/**
 * @experimental A reactive keyed collection: `Map`-speed reads and O(1) writes,
 * with fine-grained per-key reactivity. Created via the signal-style factory:
 *
 * ```ts
 * // seed with initial data — a plain object, or pairs / a Map
 * const cart = unstable_KeyedSignal.state<Item>({ a: { qty: 1 } });
 * cart.set("b", { qty: 2 });
 * cart();            // reactive whole snapshot (wakes on ANY change)
 * cart.get$("a");    // reactive single key (wakes only when "a" changes)
 * cart.values$();    // reactive structure (wakes only on add/remove)
 * ```
 *
 * Three orthogonal reactive surfaces — the callable (whole snapshot), {@link
 * KeyedSignal.get$ | get$} (one key) and {@link KeyedSignal.values$ | values$}
 * (structure). Per-key nodes are materialized lazily and reaped once their key
 * is gone and nobody observes them, so memory tracks the live/observed set
 * rather than every key ever touched; non-reactive reads allocate no node.
 */
export class unstable_KeyedSignal {
    static state<V>(initial?: Record<string, V> | Iterable<readonly [string, V]>): KeyedSignal<V> {
        const core = new KeyedStore<V>(initial);

        function signalFn(): Readonly<Record<string, V>> {
            return core.readAll();
        }

        signalFn.peek = () => core.snapshot();
        signalFn.snapshot = () => core.snapshot();
        signalFn.get = (key: string) => core.get(key);
        signalFn.get$ = (key: string) => core.get$(key);
        signalFn.set = (key: string, value: V) => core.set(key, value);
        signalFn.delete = (key: string) => core.delete(key);
        signalFn.has = (key: string) => core.has(key);
        signalFn.clear = () => core.clear();
        signalFn.values = () => core.values();
        signalFn.values$ = () => core.values$();
        signalFn.obs = core.obs;
        const dispose = () => core.dispose();
        signalFn.dispose = dispose;
        (signalFn as { [SYMBOL_DISPOSE]?: () => void })[SYMBOL_DISPOSE] = dispose;
        Object.defineProperty(signalFn, "size", { get: () => core.size });

        return signalFn as unknown as KeyedSignal<V>;
    }
}
