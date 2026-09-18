import type { IResource, TArgsOrVoid, TSuspenseResourceState } from "@/query/types";
import { useSignal } from "@/signals/react";

import { useResourceClutch } from "./useResourceClutch";

/**
 * Suspense-enabled variant of `useResource`.
 *
 * Instead of returning loading/error flags, the hook integrates with React
 * Suspense and Error Boundaries:
 * - while the initial query is in flight it throws a promise → the nearest
 *   `<Suspense fallback>` is shown;
 * - if the initial query fails with nothing to fall back on it throws the error
 *   → the nearest Error Boundary catches it;
 * - otherwise it returns the resolved state with `data` guaranteed non-null.
 *
 * A background invalidation (SWR) never suspends: stale data stays on screen
 * while `isRefreshing` / `isRefreshError` let the UI render inline indicators.
 *
 * `SKIP` is intentionally unsupported — a component that may suspend must always
 * have arguments. For conditional queries use `useResource`.
 *
 * @param resource - The resource to observe.
 * @param args - Query arguments (or `void` when `TArgs` is `void`).
 * @returns The settled resource state with non-null `data`.
 */
export function useSuspenseResource<TArgs, TData, TError = unknown>(
    resource: IResource<TArgs, TData, TError>,
    args: TArgsOrVoid<TArgs>,
): TSuspenseResourceState<TArgs, TData, TError> {
    // Started during render: a suspended render aborts its effects, so a
    // deferred start would leave the fallback hanging forever.
    const clutch = useResourceClutch(resource, args, true);

    const state = useSignal(clutch.state$);

    // Data present (success / invalidating / invalidate-error / stale SWR) → render it.
    if (state.isSuccess || state.isRefreshing || state.isRefreshError || state.data != null) {
        return state as TSuspenseResourceState<TArgs, TData, TError>;
    }

    // Initial error with nothing to fall back on → let an Error Boundary handle it.
    if (state.isError) {
        throw state.error;
    }

    // Initial loading → suspend until the query settles.
    throw clutch.whenSettled();
}
