import type { SignalOptionsOrKey } from "@/signals/types";

import { Batcher } from "../base";
import { isTracking } from "../base/core";
import { SYMBOL_DISPOSE } from "../base/disposeSymbol";
import { LiveSourceNode } from "../base/LiveSourceNode";
import { Computed } from "../signals/Computed";
import { StateNode } from "../signals/State";

import { isDraftable, produce } from "./produce";
import type { PathNode, ProxyStateSignal } from "./types";

/** Whether paths go inside `value`: Map/Set are atomic leaves for path traversal. */
function isPathContainer(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !(value instanceof Map) && !(value instanceof Set);
}

function stepInto(container: unknown, segment: string): unknown {
    return isPathContainer(container) ? container[segment] : undefined;
}

function keysOf(value: unknown): string[] {
    if (!isPathContainer(value)) return [];
    return Reflect.ownKeys(value).filter((key): key is string => typeof key === "string");
}

function sameKeys(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((key, i) => key === b[i]);
}

function readOnly(): never {
    throw new TypeError("ProxySignal: ps.root is read-only, write through mutate() or set()");
}

function getAtPath(root: unknown, segments: string[]): unknown {
    let current: unknown = root;
    for (const segment of segments) {
        current = stepInto(current, segment);
    }
    return current;
}

/**
 * A per-path source signal. It validates against the CURRENT value at its
 * path in the root: an unobserved computed that holds a link to it stays
 * truthful even after this node is pruned from the trie. When its last
 * observer leaves, the core learns it and can reap it — even in a subtree no
 * commit will ever walk again.
 */
class PathState extends LiveSourceNode<unknown> {
    get() {
        return this.read();
    }

    /** Called only inside a commit's Batcher.run. */
    set(value: unknown) {
        this.notify(value);
    }

    dispose() {}
}

interface TrieNode {
    segments: string[];
    /** Back-reference for bubbling a reap up through emptied branches. */
    parent: TrieNode | null;
    children: Map<string, TrieNode>;
    /** Materialized on first read of this path. */
    state: PathState | null;
    /** Own keys of the value at this path; materialized on the first tracked `in` / Object.keys. */
    keys: Computed<string[]> | null;
    /** Cached path proxy for this node. */
    proxy: unknown | null;
}

/**
 * The root state node of a ProxySignal. The path walk rides inside the root
 * write: `_afterAssign` runs after the value is assigned, before dependents
 * are notified and `.obs` delivers, and no user code can interpose between the
 * two (lifecycle hooks run before the assignment; `.obs` subscribers, after
 * the walk). A nested commit — from a hook or a subscriber — is a full
 * assign-then-walk of its own, so writes are totally ordered and the last
 * write's walk is the last walk: the path nodes always settle on the value
 * the root keeps.
 */
class ProxyRootNode<T> extends StateNode<T> {
    /** Called with the just-assigned value; the core walks the path trie with it. */
    onAssigned: ((value: T) => void) | null = null;

    override _afterAssign(value: T): void {
        this.onAssigned?.(value);
    }
}

class ProxySignalCore<T extends object> {
    private readonly _root: ProxyRootNode<T>;
    private readonly _trie: TrieNode = {
        segments: [],
        parent: null,
        children: new Map(),
        state: null,
        keys: null,
        proxy: null,
    };
    /** The value the path nodes reflect; the walk diffs it against an assigned root. */
    private _pathsAt: T;
    /** Nodes to reap at the end of the tick; null while no reap is scheduled. */
    private _reapQueue: Set<TrieNode> | null = null;

    constructor(initialValue: T, options?: SignalOptionsOrKey<T>) {
        this._root = new ProxyRootNode(initialValue, options);
        this._pathsAt = initialValue;
        this._root.onAssigned = (value) => {
            this._walk(this._trie, this._pathsAt, value);
            this._pathsAt = value;
        };
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
            const value = this._readPath(segments);
            return value === undefined ? initialValue : value;
        };

        // `in`, Object.keys and property descriptors answer for the value at
        // the path; symbols stay with the function target.
        node.proxy = new Proxy(pathRead, {
            get: (target, prop) => {
                if (typeof prop === "symbol") return Reflect.get(target, prop);
                // Not a path: a node with a callable `then` is a thenable that
                // never settles, so `await node` would hang.
                if (prop === "then") return undefined;
                return this._pathProxy([...segments, prop]);
            },
            has: (target, prop) => {
                if (typeof prop === "symbol") return Reflect.has(target, prop);
                const value = this._readKeys(segments);
                return isPathContainer(value) && prop in value;
            },
            ownKeys: () => keysOf(this._readKeys(segments)),
            getOwnPropertyDescriptor: (target, prop) => {
                if (typeof prop === "symbol") return Reflect.getOwnPropertyDescriptor(target, prop);
                const value = this._readKeys(segments);
                const desc = isPathContainer(value) ? Reflect.getOwnPropertyDescriptor(value, prop) : undefined;
                if (desc === undefined) return undefined;
                // An accessor: Object.keys asks for the descriptor of every
                // key, and a child path is built only when it is read.
                const get = () => this._pathProxy([...segments, prop]);
                return { get, set: undefined, enumerable: desc.enumerable, configurable: true };
            },
            set: readOnly,
            deleteProperty: readOnly,
            defineProperty: readOnly,
            setPrototypeOf: readOnly,
            preventExtensions: readOnly,
        });
        return node.proxy;
    }

    /** An untracked read gains no reactivity, so it allocates no node. */
    private _readPath(segments: string[]): unknown {
        if (!isTracking()) return getAtPath(this._root.peek(), segments);
        return this._ensureState(this._nodeFor(segments)).get();
    }

    /**
     * The value at a path, for its keys. A tracked read depends on the key
     * set only, so a change of a value under an existing key wakes nobody.
     */
    private _readKeys(segments: string[]): unknown {
        if (isTracking()) {
            const node = this._nodeFor(segments);
            node.keys ??= new Computed(() => keysOf(this._readPath(segments)), { isDisabled: true, equals: sameKeys });
            node.keys.get();
        }
        return getAtPath(this._root.peek(), segments);
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
                    keys: null,
                    proxy: null,
                };
                node.children.set(segment, child);
                // Navigation and a read by an unobserved computed create a
                // node that no observer will ever leave; it is dropped at the
                // end of the tick unless something observes it by then.
                this._scheduleReap(child);
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
     * Deferred reap, scheduled when a node is created and when its last
     * observer leaves. Deferring to the end of the tick lets an effect or a
     * computed that re-subscribes within it keep the node, so a flickering
     * selector never thrashes the trie. A still-unobserved node is pruned and
     * the reap bubbles up through ancestors left with no observer and no
     * children. An ancestor that keeps children needs no check: every node is
     * queued when created and when it goes idle, so each of those children
     * is reaped on its own. Correctness holds because PathState validates
     * live against the root, and a computed that gains an observer computes
     * afresh, linking the path's current node.
     */
    private _scheduleReap(node: TrieNode) {
        if (this._reapQueue === null) {
            const queue = new Set<TrieNode>();
            this._reapQueue = queue;
            queueMicrotask(() => {
                this._reapQueue = null;
                for (const queued of queue) this._reap(queued);
            });
        }
        this._reapQueue.add(node);
    }

    private _reap(node: TrieNode) {
        if (ProxySignalCore._hasObservers(node)) return;
        let cur = node;
        while (cur.parent) {
            const parent: TrieNode = cur.parent;
            const seg = cur.segments[cur.segments.length - 1];
            // A commit's _walk may have already pruned this node within the tick,
            // and a later read recreated the segment with a fresh, observed node.
            // Deleting by key would then orphan the live node — detach only when
            // the parent still points at *this* exact node.
            if (parent.children.get(seg) !== cur) break;
            parent.children.delete(seg);
            ProxySignalCore._disposeSubtree(cur);
            if (parent.state?.observed || parent.children.size > 0) break;
            cur = parent;
        }
    }

    /**
     * Top-down diff over the materialized trie. Object.is-equal subtrees are
     * skipped entirely — with structural sharing from mutate() the cost is
     * proportional to the changed region, not to the number of paths ever
     * read. Inside changed regions, nodes nobody observes are pruned (their
     * links stay valid thanks to PathState's live validation).
     *
     * The walk runs INSIDE the root write, after the value is assigned and
     * before dependents are notified and `.obs` delivers (see ProxyRootNode):
     * a delivery always meets fresh path nodes (a computed read in a
     * subscriber recomputes from them instead of trusting its stale cache,
     * and no subscriber can pull a path value ahead of the walk, which the
     * walk's `Object.is` dedupe would then swallow). Riding the write also
     * keeps the paths glued to the root under re-entrancy: walking before the
     * write would let a nested commit from a lifecycle hook run between the
     * walk and the assignment and leave the paths at a value the root never
     * keeps; walking after the write would deliver stale paths. Between the
     * assignment and the walk no user code runs, so the window in which a
     * PathState's live validation still sees the old root is unreachable.
     */
    private _commit(value: T, actionName?: string) {
        Batcher.run(() => {
            this._root.set(value, actionName);
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
        // Not disposed: an unobserved computed may still hold it, and it stays
        // truthful through the path state it reads.
        node.keys = null;
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
