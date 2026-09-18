import type { IResource, TArgsOrVoid, TSuspenseResourceState } from "@/query/types";
import { useSignal } from "@/signals/react";

import { useResourceClutch } from "./useResourceClutch";

/**
 * Suspense-enabled variant of `useResource`.
 *
 * Instead of returning loading/error flags, the hook integrates with React
 * Suspense and Error Boundaries, in this order:
 *
 * 1. `hasData` — anything to show (fresh, previous or placeholder data) is
 *    returned, so `data` is guaranteed non-null;
 * 2. `status === "error"` — a failure with nothing to show is thrown → the
 *    nearest Error Boundary catches it;
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
    // Started during render: a suspended render aborts its effects, so a
    // deferred start would leave the fallback hanging forever.
    const clutch = useResourceClutch(resource, args, true);

    const state = useSignal(clutch.state$);

    // 1. Something to show → render it, whatever the query is doing.
    if (state.hasData) {
        return state;
    }

    // 2. Failed with nothing to fall back on → let an Error Boundary handle it.
    if (state.status === "error") {
        throw state.error;
    }

    // 3. Idle or loading with nothing to show → suspend until the clutch has
    //    data or fails with nothing to show (the same condition as step 1 / 2).
    throw clutch.whenSettled();
}
