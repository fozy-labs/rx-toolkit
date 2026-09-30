import type { TBoundResource, TClutchWhenSettledOptions, TResourceClutchState } from "@/query/types";
import type { ReadonlySignal } from "@/signals/types";

// The declaration side of `queries` (keys, debounce, their checks) is in `definition.ts`.

// ==================== Instance ====================

/** The state of a query node: the resource clutch state of the bound resource, `idle` before the first key. */
export type QueryState<TBound> =
    TBound extends TBoundResource<infer TArgs, infer TData, infer TError>
        ? TResourceClutchState<TArgs, TData, TError>
        : never;

/** A query node of the instance: `queries.<k>`. */
export interface QueryNode<TBound = TBoundResource<any, any, any>> {
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

type QueryAliases<Q> = {
    readonly [K in keyof Q as `${K & string}$`]: ReadonlySignal<QueryState<Q[K]>>;
};
