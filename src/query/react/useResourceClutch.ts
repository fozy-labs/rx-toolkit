import React from "react";

import { useIsomorphicLayoutEffect } from "@/common/react";
import type { IResource, IResourceClutch, TArgsOrKeyed, TArgsOrVoidOrSkip, TResourceClutchState } from "@/query/types";
import { useSignalWithServerSnapshot } from "@/signals/react/useSignalWithServerSnapshot";

import { SKIP } from "../constants";
import { ResourceClutch } from "../core/resource";

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
 * The query starts in a layout effect, once the render is committed; a
 * suspending hook starts it itself (see `useSuspenseResource`).
 */
export function useResourceClutch<TArgs, TData, TError>(
    resource: IResource<TArgs, TData, TError>,
    args: TArgsOrVoidOrSkip<TArgs>,
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

        return next;
        // `args` is represented by `key`.
    }, [resource, key]);

    useIsomorphicLayoutEffect(() => {
        committedRef.current = { resource, clutch };
        // Idempotent: a no-op for a clutch already started during render.
        clutch.start();
    }, [resource, clutch]);

    return clutch;
}

/**
 * The live state of a clutch from {@link useResourceClutch}. A hook's render
 * reads the clutch before its subscription holds the entry, and sees the
 * revalidation that hold owes; the server never holds, so it renders the entry
 * as it is, and so does the hydration render (`_serverState$`) to match it.
 */
export function useResourceClutchState<TArgs, TData, TError>(
    clutch: IResourceClutch<TArgs, TData, TError>,
): TResourceClutchState<TArgs, TData, TError> {
    const serverState$ = clutch instanceof ResourceClutch ? clutch._serverState$ : clutch.state$;

    return useSignalWithServerSnapshot(clutch.state$, serverState$);
}
