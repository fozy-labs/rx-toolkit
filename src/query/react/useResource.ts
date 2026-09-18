import type { IResource, TArgsOrVoidOrSkip, TResourceClutchState } from "@/query/types";
import { useSignal } from "@/signals/react";

import { useResourceClutch } from "./useResourceClutch";

/**
 * Observe a resource for the given args and re-render on every state change.
 *
 * The returned state is the full clutch state — one of the fourteen rows of the
 * state matrix. Gate the rendering of data on `hasData` rather than on
 * `status === "success"`: a background invalidation is `status: "pending"` over
 * the very data it re-checks (row 6), and a failure keeps whatever was on
 * screen (rows 8, 9, 13), so a `switch (status)` without `hasData` flashes a
 * spinner on every re-query.
 *
 * `SKIP` disengages the hook: the state drops to `idle` (row 1) and no query
 * runs. For a Suspense-driven component use `useSuspenseResource`.
 *
 * @param resource - The resource to observe.
 * @param args - Query arguments, `void` when `TArgs` is `void`, or `SKIP`.
 * @returns The live resource clutch state.
 */
export function useResource<TArgs, TData, TError = unknown>(
    resource: IResource<TArgs, TData, TError>,
    args: TArgsOrVoidOrSkip<TArgs>,
): TResourceClutchState<TArgs, TData, TError> {
    const clutch = useResourceClutch(resource, args, false);

    return useSignal(clutch.state$);
}
