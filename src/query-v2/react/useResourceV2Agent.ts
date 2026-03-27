import React from "react";

import { useConstant, useEventHandler } from "@/common/react";
import { SKIP, type SKIP_TOKEN } from "@/query-v2/lib/SKIP_TOKEN";
import type { ArgsOrVoidOrSkip, IResourceV2, IResourceV2Agent, IResourceV2AgentState } from "@/query-v2/types";

export function useResourceV2Agent<TArgs, TData>(
    resource: IResourceV2<TArgs, TData>,
    ...args: ArgsOrVoidOrSkip<TArgs>
): IResourceV2AgentState<TArgs, TData> {
    const rawArg = args.length > 0 ? (args as [TArgs | SKIP_TOKEN])[0] : undefined;
    const effectiveArg = rawArg === SKIP ? SKIP : rawArg;

    const agent = useConstant(() => resource.createAgent());

    // Start agent in effect — fires on mount and when args change
    React.useEffect(() => {
        startAgent(agent, effectiveArg);
    }, [effectiveArg]);

    // Dispose agent subscriptions on unmount (GC refcount cleanup)
    React.useEffect(() => {
        return () => {
            agent.dispose();
        };
    }, [agent]);

    const subscribe = React.useCallback(
        (onStoreChange: () => void) => {
            const subscription = agent.state$.obs.subscribe(() => {
                onStoreChange();
            });
            return () => {
                subscription.unsubscribe();
            };
        },
        [agent],
    );

    const getSnapshot = useEventHandler(() => {
        return agent.state$.peek();
    });

    return React.useSyncExternalStore(subscribe, getSnapshot);
}

function startAgent<TArgs, TData>(agent: IResourceV2Agent<TArgs, TData>, arg: TArgs | SKIP_TOKEN | undefined): void {
    if (arg === SKIP) {
        agent.start(SKIP);
    } else if (arg !== undefined) {
        (agent.start as (...a: unknown[]) => void)(arg);
    } else {
        // void args — call start with no arguments
        (agent.start as (...a: unknown[]) => void)();
    }
}
