import { Observable } from "rxjs";

/**
 * A callable node of the reactive tree. Invoking it reads the value at this path
 * and, inside a tracking context, subscribes to it.
 */
export interface SignalNode<T> {
    (): T;
}

// Broad "any function" matcher — intentional here, this is a type-level guard.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type AnyFunction = Function;

/**
 * Values treated as opaque leaves: navigation stops here, reactivity is by
 * whole-reference replacement only. Mirrors the runtime `isPlainContainer` rule.
 */
type LeafValue =
    | AnyFunction
    | Map<unknown, unknown>
    | Set<unknown>
    | WeakMap<object, unknown>
    | WeakSet<object>
    | Date
    | RegExp
    | Promise<unknown>;

type IsLeaf<T> = [NonNullable<T>] extends [LeafValue] ? true : false;

/**
 * Recursive projection of a state shape `T` onto the reactive proxy tree. Every
 * node is callable (`node()` reads + subscribes to that exact path) and, for
 * container nodes, indexable to navigate deeper.
 *
 * Notes on the type-level model:
 * - Nullable containers (`{ a?: {...} }`) stay navigable: fields come from
 *   `NonNullable<T>`, while the call signature still returns the nullable `T`
 *   (the runtime read may be `undefined` when the path is absent).
 * - Arrays expose numeric index access and a reactive `length`.
 * - Leaves (functions, `Map`/`Set`, `Date`, primitives) are call-only.
 */
export type DeepSignal<T> = SignalNode<T> & DeepFields<T>;

type DeepFields<T> =
    IsLeaf<T> extends true
        ? unknown
        : [NonNullable<T>] extends [readonly (infer U)[]]
          ? { readonly [index: number]: DeepSignal<U> } & { readonly length: SignalNode<number> }
          : [NonNullable<T>] extends [object]
            ? { readonly [K in keyof NonNullable<T>]-?: DeepSignal<NonNullable<T>[K]> }
            : unknown;

/**
 * Public handle returned by `unstable_ProxySignal.state`. Reads flow through `root`
 * (the reactive tree); writes flow through `set` / `mutate`.
 */
export interface DeepSignalController<T> extends Disposable {
    /** Root of the reactive proxy tree. */
    readonly root: DeepSignal<T>;
    /** Whole-tree observable — emits the root value on any change. */
    readonly obs: Observable<T>;
    /** Non-reactive snapshot of the whole tree. */
    peek(): T;
    /** Replace the whole tree. Diffs against the previous tree by reference. */
    set(next: T): void;
    /** Mutate through a copy-on-write draft; only touched paths notify. */
    mutate(recipe: (draft: T) => void): void;
    dispose(): void;
}
