import type { SKIP } from "@/query/constants";
import type { TBoundResource, TClutchWhenSettledOptions, TResourceClutchState } from "@/query/types";
import type { ReadonlySignal } from "@/signals/types";

import type { Falsy, InvalidName, InvalidNameError } from "./common";

// ==================== Declaration ====================

/** Any bound resource: what a query key returns to run a query. */
export type AnyBoundResource = TBoundResource<any, any, any>;

/** A query key: the bound resource to observe, or a falsy value / `SKIP` to stay idle. */
export type QueryKeyFn<TCtx, TBound> = (ctx: TCtx) => (TBound & QueryKeyCheck<TBound>) | Falsy | typeof SKIP;

/** A `queries` entry: a key, or a key whose args changes are debounced by `debounce` ms. */
export type QueryOption<TCtx, TBound> =
    | QueryKeyFn<TCtx, TBound>
    | {
          bind: (ctx: TCtx) => (Homomorphic<TBound> & QueryKeyCheck<TBound>) | Falsy | typeof SKIP;
          debounce: number;
      };

// Every function has a `bind` property, so inference from a key function also reaches the
// `bind` of the object form. Inferring through a homomorphic mapped type there gives those
// candidates a lower priority, and none at all from a function, so the key's own result wins.
type Homomorphic<T> = { [K in keyof T]: T[K] };

/** The declared entry of the `queries` record under `K`: the name check, then the option. */
export type QueryEntry<K, TCtx, TBound> = K extends InvalidName ? InvalidNameError : QueryOption<TCtx, TBound>;

export type QueryKeyResultError = "Error: a query key must return `resource.bind(args)`, a falsy value or SKIP";

export type QueryResourceError = "Error: a query key must bind one resource on every run";

/**
 * Checks of the inferred key result: a bound resource, one resource per key. Its branches do
 * not mention `TBound`, so it takes no part in inference: the result is inferred, then checked.
 */
export type QueryKeyCheck<TBound> = [TBound] extends [AnyBoundResource]
    ? IsUnion<TBound> extends true
        ? { readonly [K in QueryResourceError]: never }
        : unknown
    : { readonly [K in QueryKeyResultError]: never };

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;

// ==================== Instance ====================

/** The state of a query node: the resource clutch state of the bound resource, `idle` before the first key. */
export type QueryState<TBound> =
    TBound extends TBoundResource<infer TArgs, infer TData, infer TError>
        ? TResourceClutchState<TArgs, TData, TError>
        : never;

/** A query node of the instance: `queries.<k>`. */
export interface QueryNode<TBound = AnyBoundResource> {
    readonly state$: ReadonlySignal<QueryState<TBound>>;
    /** The key has new args that have not reached the clutch yet. */
    readonly isDebouncing$: ReadonlySignal<boolean>;
    /** Resolves by the Suspense rule, or with `{ waitForDone: true }` once the node is not pending. */
    readonly whenSettled: (options?: TClutchWhenSettledOptions) => Promise<void>;
}

/** A query as a callback context sees it: no `whenSettled`, the state through `queries.<k>$`. */
export interface QueryView {
    readonly isDebouncing$: ReadonlySignal<boolean>;
}

/** `queries` of a node: the nodes and their `<k>$` aliases of `state$`. */
export type QueryNodes<Q> = { readonly [K in keyof Q]: QueryNode<Q[K]> } & QueryAliases<Q>;

/** `queries` of a callback context: the views and the `<k>$` aliases. */
export type QueryViews<Q> = { readonly [K in keyof Q]: QueryView } & QueryAliases<Q>;

export type QueryAliases<Q> = {
    readonly [K in keyof Q as `${K & string}$`]: ReadonlySignal<QueryState<Q[K]>>;
};
