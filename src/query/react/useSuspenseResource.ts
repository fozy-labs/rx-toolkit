import type { IResource, TArgsOrVoid, TSuspenseResourceState } from "@/query/types";

import { ResourceClutch } from "../core/resource";

import { useResourceClutch, useResourceClutchState } from "./useResourceClutch";

/**
 * Suspense-enabled variant of `useResource`.
 *
 * Instead of returning loading/error flags, the hook integrates with React
 * Suspense and Error Boundaries, in this order:
 *
 * 1. `hasData` — anything to show (fresh, previous or placeholder data) is
 *    returned, so `data` is guaranteed non-null;
 * 2. `status === "error"` — a failure with nothing to show is thrown → the
 *    nearest Error Boundary catches it. The throw consumes the failure: the
 *    entry is marked for revalidation, so the remount after the boundary's
 *    reset re-queries (suspends on the re-query it is owed, step 3) instead
 *    of replaying a failure that was already thrown;
 * 3. otherwise the query is in flight with nothing to show: a promise is thrown
 *    → the nearest `<Suspense fallback>` is shown until the clutch settles.
 *
 * Only the first step returns, so the three loading flags are the right hooks
 * for inline indicators: a background invalidation (row 6) never suspends, and
 * neither does an error behind previous or placeholder data (rows 8 and 13) —
 * those states are returned with `hasError`, not thrown.
 *
 * `SKIP` is intentionally unsupported — a component that may suspend must always
 * have arguments. For conditional queries use `useResource`.
 *
 * @param resource - The resource to observe.
 * @param args - Query arguments (or `void` when `TArgs` is `void`).
 * @returns A resource state with something to show: non-null `data` and
 *   `dataSource` narrowed to `placeholder | previous | current`.
 */
export function useSuspenseResource<TArgs, TData, TError = unknown>(
    resource: IResource<TArgs, TData, TError>,
    args: TArgsOrVoid<TArgs>,
): TSuspenseResourceState<TArgs, TData, TError> {
    const clutch = useResourceClutch(resource, args);

    const state = useResourceClutchState(clutch);

    // 1. Something to show → render it, whatever the query is doing.
    if (state.hasData) {
        return state;
    }

    // 2. Failed with nothing to fall back on → let an Error Boundary handle
    //    it. Mark the entry for revalidation in a microtask: invalidate() of
    //    a held entry runs user code (queryFn), which must not run in this
    //    render; of a melting one it only sets the mark — and the entry is
    //    melting here, the render about to throw holds nothing.
    if (state.status === "error") {
        if (clutch instanceof ResourceClutch) {
            queueMicrotask(() => clutch._invalidateEntry());
        }
        throw state.error;
    }

    // 3. Idle or loading with nothing to show → suspend until the clutch has
    //    data or fails with nothing to show (the same condition as step 1 / 2).
    //    A suspended render runs no effects, so the query starts right after
    //    this render: started in it, it would create a cache entry and run
    //    user code (queryFn, lifecycle hooks) in the middle of React's render.
    //    `whenSettled` holds the entry until it settles, then keeps it for
    //    the retried render, which holds it once committed.
    const settled = clutch.whenSettled();
    queueMicrotask(() => clutch.start());
    throw settled;
}
