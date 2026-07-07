import { BehaviorSubject, Observable } from "rxjs";

import type { SignalOptionsOrKey } from "@/signals/types";

import { Batcher, DependencyTracker, type DependencyRecord } from "../base";
import { SYMBOL_DISPOSE } from "../base/disposeSymbol";
import { State } from "../signals/State";

import { isDraftable, produce } from "./produce";
import type { PathNode, ProxyStateSignal } from "./types";

function stepInto(container: unknown, segment: string): unknown {
    if (container === null || typeof container !== "object") return undefined;
    // Map/Set are atomic leaves for path traversal.
    if (container instanceof Map || container instanceof Set) return undefined;
    return (container as any)[segment];
}

function getAtPath(root: unknown, segments: string[]): unknown {
    let current: unknown = root;
    for (const segment of segments) {
        current = stepInto(current, segment);
    }
    return current;
}

/**
 * A per-path source signal. `peek` reads the CURRENT value from the root by
 * path (not the local subject): dependency records captured by a dormant
 * Computed's ComputeCache must stay truthful even after this node is pruned
 * from the trie, otherwise the cache would validate against a stale value.
 */
class PathState {
    private readonly bs$: BehaviorSubject<unknown>;
    readonly depRecord: DependencyRecord;
    private _refCount = 0;

    constructor(initialValue: unknown, peekLive: () => unknown, onIdle: () => void) {
        this.bs$ = new BehaviorSubject(initialValue);
        // Precise per-node refcount: each reactive observer subscribes through
        // this wrapper, so the core learns when a node's last observer leaves
        // and can reap it — even in a subtree no commit will ever walk again.
        const obs = new Observable((subscriber) => {
            this._refCount++;
            const sub = this.bs$.subscribe(subscriber);
            return () => {
                sub.unsubscribe();
                if (--this._refCount === 0) onIdle();
            };
        });
        this.depRecord = {
            getRang: () => 0,
            obs,
            peek: peekLive,
        };
    }

    get observed() {
        return this._refCount > 0;
    }

    get() {
        if (DependencyTracker.isTracking) {
            DependencyTracker.track(this.depRecord);
        }
        return this.bs$.getValue();
    }

    /** Called only inside a commit's Batcher.run. */
    set(value: unknown) {
        if (Object.is(value, this.bs$.getValue())) return;
        this.bs$.next(value);
    }

    dispose() {
        this.bs$.complete();
    }
}

interface TrieNode {
    segments: string[];
    /** Back-reference for bubbling a reap up through emptied branches. */
    parent: TrieNode | null;
    children: Map<string, TrieNode>;
    /** Materialized on first read of this path. */
    state: PathState | null;
    /** Cached path proxy for this node. */
    proxy: unknown | null;
}

class ProxySignalCore<T extends object> {
    private readonly _root: State<T>;
    private readonly _trie: TrieNode = { segments: [], parent: null, children: new Map(), state: null, proxy: null };

    constructor(initialValue: T, options?: SignalOptionsOrKey<T>) {
        this._root = new State(initialValue, options);
    }

    get() {
        return this._root.get();
    }

    peek() {
        return this._root.peek();
    }

    get obs() {
        return this._root.obs;
    }

    set(value: T, actionName?: string) {
        this._commit(value, actionName);
    }

    update(updater: (value: T) => T, actionName?: string) {
        this._commit(updater(this._root.peek()), actionName);
    }

    mutate(recipe: (draft: T) => void, actionName?: string) {
        const base = this._root.peek();
        if (!isDraftable(base)) {
            throw new TypeError("ProxySignal.mutate: state must be a plain object, an array, a Map or a Set");
        }
        const next = produce(base, recipe);
        if (Object.is(next, base)) return;
        this._commit(next, actionName);
    }

    dispose() {
        this._root.dispose();
        ProxySignalCore._disposeSubtree(this._trie);
    }

    rootProxy(): unknown {
        return this._pathProxy([]);
    }

    /**
     * Proxies close over `segments` and re-resolve the trie node on every
     * access: a proxy the consumer kept around stays functional even after
     * its node was pruned — the node (and its signal) is recreated lazily.
     */
    private _pathProxy(segments: string[]): unknown {
        const node = this._nodeFor(segments);
        if (node.proxy) return node.proxy;

        const pathRead = (initialValue?: unknown) => {
            const value = this._ensureState(this._nodeFor(segments)).get();
            return value === undefined ? initialValue : value;
        };

        node.proxy = new Proxy(pathRead, {
            get: (target, prop) => {
                if (typeof prop === "symbol") return Reflect.get(target, prop);
                return this._pathProxy([...segments, prop]);
            },
        });
        return node.proxy;
    }

    private _nodeFor(segments: string[]): TrieNode {
        let node = this._trie;
        for (const segment of segments) {
            let child = node.children.get(segment);
            if (!child) {
                child = {
                    segments: node.segments.concat(segment),
                    parent: node,
                    children: new Map(),
                    state: null,
                    proxy: null,
                };
                node.children.set(segment, child);
            }
            node = child;
        }
        return node;
    }

    private _ensureState(node: TrieNode): PathState {
        if (!node.state) {
            const segments = node.segments;
            node.state = new PathState(
                getAtPath(this._root.peek(), segments),
                () => getAtPath(this._root.peek(), segments),
                () => this._scheduleReap(node),
            );
        }
        return node.state;
    }

    /**
     * Deferred reap: runs after the synchronous commit that dropped the node's
     * last observer. Deferring is essential — a Computed recompute unsubscribes
     * old deps then subscribes new ones in the same commit; by the time the
     * microtask runs a re-subscribe has revived the node (observed again), so a
     * flickering selector never thrashes the trie. A still-cold node is pruned
     * and the reap bubbles up, dropping ancestor branches that became fully
     * unobserved. Correctness holds because PathState.peek reads live from the
     * root, so a dormant Computed's ComputeCache stays truthful after a prune.
     */
    private _scheduleReap(node: TrieNode) {
        queueMicrotask(() => this._reap(node));
    }

    private _reap(node: TrieNode) {
        let cur: TrieNode | null = node;
        while (cur && cur.parent && !ProxySignalCore._hasObservers(cur)) {
            cur.parent.children.delete(cur.segments[cur.segments.length - 1]);
            ProxySignalCore._disposeSubtree(cur);
            cur = cur.parent;
        }
    }

    /**
     * Top-down diff over the materialized trie. Object.is-equal subtrees are
     * skipped entirely — with structural sharing from mutate() the cost is
     * proportional to the changed region, not to the number of paths ever
     * read. Inside changed regions, nodes nobody observes are pruned (their
     * dependency records stay valid thanks to PathState's live peek).
     */
    private _commit(value: T, actionName?: string) {
        const previous = this._root.peek();
        Batcher.run(() => {
            this._root.set(value, actionName);
            this._walk(this._trie, previous, value);
        });
    }

    private _walk(node: TrieNode, oldValue: unknown, newValue: unknown) {
        if (Object.is(oldValue, newValue)) return;
        node.state?.set(newValue);
        for (const [segment, child] of node.children) {
            if (!ProxySignalCore._hasObservers(child)) {
                node.children.delete(segment);
                ProxySignalCore._disposeSubtree(child);
                continue;
            }
            this._walk(child, stepInto(oldValue, segment), stepInto(newValue, segment));
        }
    }

    private static _hasObservers(node: TrieNode): boolean {
        if (node.state?.observed) return true;
        for (const child of node.children.values()) {
            if (ProxySignalCore._hasObservers(child)) return true;
        }
        return false;
    }

    private static _disposeSubtree(node: TrieNode) {
        node.state?.dispose();
        node.state = null;
        node.proxy = null;
        for (const child of node.children.values()) {
            ProxySignalCore._disposeSubtree(child);
        }
        node.children.clear();
    }
}

export class unstable_ProxySignal {
    static state<T extends object>(initialValue: T, options?: SignalOptionsOrKey<T>): ProxyStateSignal<T> {
        const core = new ProxySignalCore(initialValue, options);

        function signalFn() {
            return core.get();
        }

        signalFn.peek = () => core.peek();
        signalFn.get = () => core.get();
        signalFn.set = (value: T, actionName?: string) => core.set(value, actionName);
        signalFn.update = (updater: (value: T) => T, actionName?: string) => core.update(updater, actionName);
        signalFn.mutate = (recipe: (draft: T) => void, actionName?: string) => core.mutate(recipe, actionName);
        signalFn.obs = core.obs;
        signalFn.root = core.rootProxy() as PathNode<T>;
        const dispose = () => core.dispose();
        signalFn.dispose = dispose;
        signalFn[SYMBOL_DISPOSE] = dispose;

        return signalFn;
    }
}
