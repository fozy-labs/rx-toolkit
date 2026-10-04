import type { TSuspenseResourcesInput, TSuspenseResourcesState } from "@/query/types";

import { ResourceClutch } from "../core/resource";

import { useResourcesStore } from "./useResourcesStore";

/**
 * Suspense-enabled variant of `useResources`. Every slot starts in the same
 * suspended render, so there is no waterfall — unlike several
 * `useSuspenseResource` calls, where the first one to suspend hides the rest
 * until it settles. In this order:
 *
 * 1. every slot has something to show → the aggregate is returned, `data` is
 *    non-null;
 * 2. a slot failed with nothing to show → its error (the first in slot order)
 *    is thrown to the nearest Error Boundary; every such slot is marked for
 *    revalidation, so the remount after the boundary's reset re-queries;
 * 3. otherwise a promise is thrown → `<Suspense fallback>` until step 1 or 2
 *    applies.
 *
 * `SKIP` is not accepted — a component that may suspend must have args for
 * every slot. For conditional slots use `useResources`.
 *
 * @param resources - A record or an array of bound resources.
 */
export function useSuspenseResources<const T extends TSuspenseResourcesInput>(
    resources: T,
): TSuspenseResourcesState<T> {
    const { store, states, state } = useResourcesStore(resources, "useSuspenseResources", false);

    // 1. Something to show in every slot → render it.
    if (state.hasData) {
        return state as TSuspenseResourcesState<T>;
    }

    // 2. A failure with nothing to show → Error Boundary. The marks are set in
    //    a microtask, as in `useSuspenseResource`: never from render.
    const failures = store.failures(states);
    if (failures.length > 0) {
        queueMicrotask(() => {
            for (const { clutch } of failures) {
                if (clutch instanceof ResourceClutch) clutch._invalidateEntry();
            }
        });
        throw failures[0].error;
    }

    // 3. Suspend until every slot has data or one fails. The wait subscribes
    //    before the start, so it holds every entry from its creation; the
    //    queries start right after this render (see `useSuspenseResource`).
    const settled = store.whenSettled();
    queueMicrotask(() => store.start());
    throw settled;
}
