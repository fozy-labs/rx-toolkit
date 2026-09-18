import React from "react";

import { useIsomorphicLayoutEffect } from "@/common/react";
import type { IResource, IResourceClutch, TArgsOrKeyed, TArgsOrVoidOrSkip } from "@/query/types";

import { SKIP } from "../constants";

interface Committed<TArgs, TData, TError> {
    resource: IResource<TArgs, TData, TError>;
    clutch: IResourceClutch<TArgs, TData, TError>;
}

/**
 * The clutch behind `useResource` / `useSuspenseResource`: one clutch per
 * `(resource, args key)`, created during render and started after commit.
 *
 * Render stays pure on purpose. Mutating a single long-lived clutch from render
 * (`clutch.switch(args)`) is a side effect on a store shared by every render of
 * the component — including the concurrent ones React keeps in flight at the
 * same time. With an args change inside a transition, the transition render pushes
 * the new args into the store, the store notifies, React synchronously
 * re-renders the *committed* tree (still on the old args), which pushes the old
 * args back, and so on until the transition times out. A fresh clutch per args
 * gives every render lane its own object: nothing is shared, nothing loops.
 *
 * SWR across an args change is preserved by handing the stale data over from
 * the last committed clutch to its successor (`adoptPrevious`). The handoff
 * source is a ref written in the layout effect, so a discarded render never
 * leaks into the committed tree and a successor always continues from what is
 * actually on screen.
 *
 * @param startDuringRender - Start the query when the clutch is created (the
 *   Suspense hook: a suspended render aborts its effects, so a deferred start
 *   would leave the fallback hanging forever). Otherwise the query starts in a
 *   layout effect, once the render is committed.
 */
export function useResourceClutch<TArgs, TData, TError>(
    resource: IResource<TArgs, TData, TError>,
    args: TArgsOrVoidOrSkip<TArgs>,
    startDuringRender: boolean,
): IResourceClutch<TArgs, TData, TError> {
    const key = args === SKIP ? SKIP : resource.serialize(args as TArgsOrKeyed<TArgs>);
    const committedRef = React.useRef<Committed<TArgs, TData, TError> | null>(null);

    // Keyed by the serialized args, not their identity: an inline `{ id }`
    // literal is a new object every render but the same clutch.
    const clutch = React.useMemo(() => {
        const next = resource.createClutch();
        const committed = committedRef.current;

        if (committed !== null && committed.resource === resource) {
            next.adoptPrevious(committed.clutch);
        }

        // `markPending` reports `status: "pending"` instead of `idle` while the
        // clutch waits for its start — over the adopted data when there is any
        // (`dataSource: "previous"`), with nothing to show otherwise.
        next.switch(args, { markPending: true });

        if (startDuringRender) {
            next.start();
        }

        return next;
        // `args` is represented by `key`; `startDuringRender` is constant per hook.
    }, [resource, key]);

    useIsomorphicLayoutEffect(() => {
        committedRef.current = { resource, clutch };
        // Idempotent: a no-op for a clutch already started during render.
        clutch.start();
    }, [resource, clutch]);

    return clutch;
}
