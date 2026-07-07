import { Observable } from "rxjs";

import { Batcher, DependencyTracker } from "@/signals/base";
import { SYMBOL_DISPOSE } from "@/signals/base/disposeSymbol";

import { isPlainContainer, ownKeysOf, sameKeySet } from "./helpers";
import { produce } from "./produce";
import { TrackSignal } from "./TrackSignal";
import type { DeepSignal, DeepSignalController } from "./types";

/**
 * Non-reactive escape hatch: `node[PROXY_RAW]` returns the current raw value at
 * that path without creating a dependency. Mainly for tests and tooling.
 */
export const PROXY_RAW = Symbol("proxySignal.raw");

/** @internal Attaches the backing tree to a controller for test introspection. */
export const PROXY_TREE = Symbol("proxySignal.tree");

/**
 * Property keys that must not be treated as data navigation. When the raw value
 * at a path does not own such a key, the trap yields the callable target's own
 * default (a native method or `undefined`) instead of a child proxy — so
 * stringifying, awaiting or JSON-serialising the proxy degrades gracefully
 * instead of throwing or hanging. Data keys with these exact names are therefore
 * not reactively navigable (read them via `peek()`); such names are pathological.
 */
const RESERVED_KEYS = new Set<string>([
    "then",
    "toString",
    "valueOf",
    "toJSON",
    "toLocaleString",
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
]);

const READ_ONLY_MESSAGE = "[unstable_ProxySignal] the reactive tree is read-only; use mutate() or set().";

function throwReadOnly(): never {
    throw new Error(READ_ONLY_MESSAGE);
}

/**
 * One live node of the reactive tree, keyed by path. Nodes are created lazily —
 * on reactive read for a value signal, on iteration/`in` for a keys signal, or
 * as a structural parent of a deeper live node — and pruned once cold.
 *
 * Invariant: for every live node, `value` equals the current raw slice at its
 * path. It is seeded on creation from the parent's `value` and maintained by
 * {@link ProxyTree._propagate}.
 */
class ProxyNode {
    children: Map<string, ProxyNode> | null = null;
    /** Fires on any change to the value at this exact path (incl. deep changes). */
    valueSignal: TrackSignal<unknown> | null = null;
    /** Fires when the *set* of own keys at this path changes (add/remove). */
    keysSignal: TrackSignal<number> | null = null;
    private _keysVersion = 0;

    constructor(
        readonly parent: ProxyNode | null,
        readonly key: string | null,
        public value: unknown,
    ) {}

    bumpKeys(): void {
        this._keysVersion += 1;
        this.keysSignal!.set(this._keysVersion);
    }
}

class ProxyTree<T> {
    private _raw: T;
    private readonly _root: ProxyNode;
    private _disposed = false;
    /** Public reactive proxy tree root (distinct from `_root`, the node graph). */
    readonly root: DeepSignal<T>;

    constructor(initial: T) {
        this._raw = initial;
        this._root = new ProxyNode(null, null, initial);
        this.root = this._createProxy([]) as DeepSignal<T>;
    }

    // ===== public surface =====

    peek(): T {
        this._assertLive();
        return this._raw;
    }

    get obs(): Observable<T> {
        this._assertLive();
        const signal = this._ensureValueSignal(this._root);
        return signal.obs as Observable<T>;
    }

    set(next: T): void {
        this._assertLive();
        if (Object.is(this._raw, next)) return;
        this._raw = next;
        Batcher.run(() => this._propagate(this._root, next));
    }

    mutate(recipe: (draft: T) => void): void {
        this._assertLive();
        const next = produce(this._raw, recipe);
        if (Object.is(this._raw, next)) return;
        this._raw = next;
        Batcher.run(() => this._propagate(this._root, next));
    }

    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        this._disposeNode(this._root);
    }

    // ===== proxy construction =====

    private _createProxy(path: readonly string[]): unknown {
        // Callable arrow target: invocable (apply), with no `prototype` own key
        // to complicate the ownKeys invariant. Trap methods are arrows so `this`
        // stays the tree without aliasing.
        const target = () => undefined;

        return new Proxy(target, {
            apply: () => this._readValue(path),
            get: (t, prop) => {
                if (prop === PROXY_RAW) return this._peek(path);
                if (typeof prop === "symbol") return undefined;
                if (RESERVED_KEYS.has(prop)) {
                    const raw = this._peek(path);
                    if (!(isPlainContainer(raw) && Object.prototype.hasOwnProperty.call(raw, prop))) {
                        return Reflect.get(t, prop);
                    }
                }
                return this._createProxy([...path, prop]);
            },
            has: (_t, prop) => {
                if (typeof prop === "symbol") return false;
                return this._hasKey(path, prop);
            },
            ownKeys: () => this._ownKeys(path),
            getOwnPropertyDescriptor: (_t, prop) => {
                if (typeof prop === "symbol") return undefined;
                return this._descriptor(path, prop);
            },
            // Every mutating trap is blocked so the tree stays strictly
            // read-only. This deliberately includes defineProperty /
            // preventExtensions / setPrototypeOf: without them, Object.defineProperty
            // and Object.freeze fall through to the internal callable target and
            // permanently corrupt the (stable root) proxy via invariant violations.
            // preventExtensions throwing also aborts Object.freeze at its first
            // step, before the target is ever mutated.
            set: throwReadOnly,
            deleteProperty: throwReadOnly,
            defineProperty: throwReadOnly,
            setPrototypeOf: throwReadOnly,
            preventExtensions: throwReadOnly,
        });
    }

    // ===== reactive reads =====

    private _readValue(path: readonly string[]): unknown {
        this._assertLive();
        if (!DependencyTracker.isTracking) return this._peek(path);
        const node = this._ensureNode(path);
        this._ensureValueSignal(node).track();
        return node.value;
    }

    private _hasKey(path: readonly string[], key: string): boolean {
        this._assertLive();
        if (DependencyTracker.isTracking) this._ensureKeysSignal(this._ensureNode(path)).track();
        const raw = this._peek(path);
        return isPlainContainer(raw) && Object.prototype.hasOwnProperty.call(raw, key);
    }

    private _ownKeys(path: readonly string[]): string[] {
        this._assertLive();
        if (DependencyTracker.isTracking) this._ensureKeysSignal(this._ensureNode(path)).track();
        return ownKeysOf(this._peek(path)) as string[];
    }

    private _descriptor(path: readonly string[], key: string): PropertyDescriptor | undefined {
        this._assertLive();
        if (DependencyTracker.isTracking) this._ensureKeysSignal(this._ensureNode(path)).track();
        const raw = this._peek(path);
        if (isPlainContainer(raw) && Object.prototype.hasOwnProperty.call(raw, key)) {
            return {
                enumerable: true,
                configurable: true,
                writable: false,
                value: this._createProxy([...path, key]),
            };
        }
        return undefined;
    }

    // ===== raw access =====

    /** Own-property walk of the raw tree; `undefined` for absent/inherited paths. */
    private _peek(path: readonly string[]): unknown {
        let value: unknown = this._raw;
        for (const key of path) {
            if (!isPlainContainer(value)) return undefined;
            if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
            value = (value as Record<string, unknown>)[key];
        }
        return value;
    }

    // ===== node lifecycle =====

    private _ensureNode(path: readonly string[]): ProxyNode {
        let node = this._root;
        for (const key of path) {
            let child = node.children?.get(key);
            if (!child) {
                const childValue = isPlainContainer(node.value)
                    ? (node.value as Record<string, unknown>)[key]
                    : undefined;
                child = new ProxyNode(node, key, childValue);
                (node.children ??= new Map()).set(key, child);
            }
            node = child;
        }
        return node;
    }

    private _ensureValueSignal(node: ProxyNode): TrackSignal<unknown> {
        return (node.valueSignal ??= new TrackSignal<unknown>(node.value, () => this._maybePrune(node)));
    }

    private _ensureKeysSignal(node: ProxyNode): TrackSignal<number> {
        return (node.keysSignal ??= new TrackSignal<number>(0, () => this._maybePrune(node)));
    }

    /** Detach a cold node (no observed signals, no children) and cascade upward. */
    private _maybePrune(node: ProxyNode): void {
        if (this._disposed) return;
        if (node === this._root) return;
        if (node.valueSignal?.observed || node.keysSignal?.observed) return;
        if (node.children && node.children.size > 0) return;

        node.valueSignal?.dispose();
        node.keysSignal?.dispose();
        node.valueSignal = null;
        node.keysSignal = null;

        const parent = node.parent!;
        parent.children!.delete(node.key!);
        if (parent.children!.size === 0) parent.children = null;

        this._maybePrune(parent);
    }

    /**
     * Push a new tree value into the live node graph. Recurses only where the
     * reference actually changed (structural sharing prunes untouched subtrees),
     * firing each existing node's value signal, and its keys signal only when the
     * own-key set changed. Runs inside a single {@link Batcher.run}.
     */
    private _propagate(node: ProxyNode, newValue: unknown): void {
        const oldValue = node.value;
        if (Object.is(oldValue, newValue)) return;

        node.value = newValue;
        node.valueSignal?.set(newValue);
        if (node.keysSignal && !sameKeySet(oldValue, newValue)) {
            node.bumpKeys();
        }

        if (!node.children) return;
        const container = isPlainContainer(newValue) ? (newValue as Record<string, unknown>) : null;
        // Snapshot: a fired signal can schedule an effect that (on flush) prunes
        // siblings; iterate a copy so the live map can mutate safely.
        for (const child of [...node.children.values()]) {
            this._propagate(child, container ? container[child.key!] : undefined);
        }
    }

    private _disposeNode(node: ProxyNode): void {
        node.valueSignal?.dispose();
        node.keysSignal?.dispose();
        node.valueSignal = null;
        node.keysSignal = null;
        if (node.children) {
            for (const child of node.children.values()) this._disposeNode(child);
            node.children = null;
        }
    }

    private _assertLive(): void {
        if (this._disposed) {
            throw new Error("[unstable_ProxySignal] the signal has been disposed.");
        }
    }

    // ===== test/tooling introspection =====

    /** Number of live nodes in the tree (root included). Internal, for tests. */
    debugNodeCount(): number {
        const count = (node: ProxyNode): number => {
            let total = 1;
            if (node.children) for (const child of node.children.values()) total += count(child);
            return total;
        };
        return count(this._root);
    }
}

/**
 * Deep reactive store built on the signals graph. A single `unstable_ProxySignal`
 * holds an immutable object/array tree and exposes it as a lazily-materialised
 * tree of per-path signals:
 *
 * ```ts
 * const ps = unstable_ProxySignal.state<Record<string, Entry>>({});
 *
 * Signal.effect(() => {
 *     const entry = ps.root[key]();    // subscribes to exactly this path
 * });
 *
 * ps.mutate((draft) => {
 *     draft[key] = value;              // wakes only observers of `key`
 * });
 * ```
 *
 * Semantics:
 * - `node()` fires on any change to its value, including deep changes — updates
 *   are copy-on-write, so a deep mutation replaces every ancestor reference.
 * - `key in node` / `Object.keys(node)` fire only when the own-key set changes.
 * - Writes are `Object.is`-deduped; a no-op `mutate` notifies nobody.
 * - Only arrays and plain objects are traversed; other values are opaque leaves.
 */
export class unstable_ProxySignal {
    static state<T>(initial: T): DeepSignalController<T> {
        const tree = new ProxyTree<T>(initial);

        const dispose = () => tree.dispose();

        return {
            root: tree.root,
            get obs() {
                return tree.obs;
            },
            peek: () => tree.peek(),
            set: (next: T) => tree.set(next),
            mutate: (recipe: (draft: T) => void) => tree.mutate(recipe),
            dispose,
            [SYMBOL_DISPOSE]: dispose,
            [PROXY_TREE]: tree,
        } as DeepSignalController<T>;
    }
}

/** @internal — count live nodes behind a controller (tests/tooling only). */
export function debugNodeCount(controller: DeepSignalController<unknown>): number {
    const tree = (controller as unknown as Record<symbol, ProxyTree<unknown>>)[PROXY_TREE];
    return tree.debugNodeCount();
}
