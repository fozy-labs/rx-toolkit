import { useConstant } from "@/common/react";
import type { ArgsOrVoid, IResource, TSuspenseResourceState } from "@/query/types";
import { useSignal } from "@/signals/react";

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
 * Background refreshes (SWR) never suspend: stale data stays on screen while
 * `isRefreshing` / `isRefreshError` let the UI render inline indicators.
 *
 * `SKIP` is intentionally unsupported — a component that may suspend must always
 * have arguments. For conditional queries use `useResource`.
 *
 * @param resource - The resource to observe.
 * @param args - Query arguments (or `void` when `TArgs` is `void`).
 * @returns The settled resource state with non-null `data`.
 */
export function useSuspenseResource<TArgs, TData>(
    resource: IResource<TArgs, TData>,
    args: ArgsOrVoid<TArgs>,
): TSuspenseResourceState<TArgs, TData> {
    const agent = useConstant(() => {
        const r = resource.createAgent();

        r.set(args, true);
        // Begin fetching during render: a suspended render aborts its effects,
        // so deferring start() to a layout effect (as useResource does) would
        // leave the fallback hanging forever. start() is idempotent.
        r.start();

        return r;
    }, [resource]);

    if (agent.args !== args) {
        // `_isStarted` is already true, so set() triggers the fetch for the new args.
        agent.set(args, true);
    }

    const state = useSignal(agent.state$);

    // Data present (success / refreshing / refresh-error / stale SWR) → render it.
    if (state.isSuccess || state.isRefreshing || state.isRefreshError || state.data != null) {
        return state as TSuspenseResourceState<TArgs, TData>;
    }

    // Initial error with nothing to fall back on → let an Error Boundary handle it.
    if (state.isError) {
        throw state.error;
    }

    // Initial loading → suspend until the query settles.
    throw agent.whenSettled();
}
