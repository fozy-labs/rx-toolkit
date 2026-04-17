import { useConstant, useIsomorphicLayoutEffect } from "@/common/react";
import type { ArgsOrVoidOrSkip, IResource, TResourceAgentState } from "@/query/types";
import { useSignal } from "@/signals/react";

export function useResource<TArgs, TData>(
    resource: IResource<TArgs, TData>,
    args: ArgsOrVoidOrSkip<TArgs>,
): TResourceAgentState<TArgs, TData> {
    const agent = useConstant(() => {
        const r = resource.createAgent();

        r.set(args, true);

        return r;
    }, [resource]);

    if (agent.args !== args) {
        agent.set(args, true);
    }

    useIsomorphicLayoutEffect(() => {
        agent.start();
    }, [agent]);

    return useSignal(agent.state$);
}
