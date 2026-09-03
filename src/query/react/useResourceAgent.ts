import React from "react";

import { useIsomorphicLayoutEffect } from "@/common/react";
import type { Args, ArgsOrVoidOrSkip, IResource, IResourceAgent } from "@/query/types";

import { SKIP } from "../constants";

interface Committed<TArgs, TData, TError> {
    resource: IResource<TArgs, TData, TError>;
    agent: IResourceAgent<TArgs, TData, TError>;
}

/**
 * The agent behind `useResource` / `useSuspenseResource`: one agent per
 * `(resource, args key)`, created during render and started after commit.
 *
 * Render stays pure on purpose. Mutating a single long-lived agent from render
 * (`agent.set(args)`) is a side effect on a store shared by every render of the
 * component — including the concurrent ones React keeps in flight at the same
 * time. With an args change inside a transition, the transition render pushes
 * the new args into the store, the store notifies, React synchronously
 * re-renders the *committed* tree (still on the old args), which pushes the old
 * args back, and so on until the transition times out. A fresh agent per args
 * gives every render lane its own object: nothing is shared, nothing loops.
 *
 * SWR across an args change is preserved by handing the stale data over from
 * the last committed agent to its successor (`adoptPrevious`). The handoff
 * source is a ref written in the layout effect, so a discarded render never
 * leaks into the committed tree and a successor always continues from what is
 * actually on screen.
 *
 * @param startDuringRender - Start the query when the agent is created (the
 *   Suspense hook: a suspended render aborts its effects, so a deferred start
 *   would leave the fallback hanging forever). Otherwise the query starts in a
 *   layout effect, once the render is committed.
 */
export function useResourceAgent<TArgs, TData, TError>(
    resource: IResource<TArgs, TData, TError>,
    args: ArgsOrVoidOrSkip<TArgs>,
    startDuringRender: boolean,
): IResourceAgent<TArgs, TData, TError> {
    const key = args === SKIP ? SKIP : resource.serialize(args as Args<TArgs>);
    const committedRef = React.useRef<Committed<TArgs, TData, TError> | null>(null);

    // Keyed by the serialized args, not their identity: an inline `{ id }`
    // literal is a new object every render but the same agent.
    const agent = React.useMemo(() => {
        const next = resource.createAgent();
        const committed = committedRef.current;

        if (committed !== null && committed.resource === resource) {
            next.adoptPrevious(committed.agent);
        }

        // `mark` reports pending (or refreshing over the adopted data) instead
        // of idle while the agent waits for its start.
        next.set(args, true);

        if (startDuringRender) {
            next.start();
        }

        return next;
        // `args` is represented by `key`; `startDuringRender` is constant per hook.
    }, [resource, key]);

    useIsomorphicLayoutEffect(() => {
        committedRef.current = { resource, agent };
        // Idempotent: a no-op for an agent already started during render.
        agent.start();
    }, [resource, agent]);

    return agent;
}
