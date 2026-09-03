import type { ArgsOrVoidOrSkip, IResource, TResourceAgentState } from "@/query/types";
import { useSignal } from "@/signals/react";

import { useResourceAgent } from "./useResourceAgent";

export function useResource<TArgs, TData, TError = unknown>(
    resource: IResource<TArgs, TData, TError>,
    args: ArgsOrVoidOrSkip<TArgs>,
): TResourceAgentState<TArgs, TData, TError> {
    const agent = useResourceAgent(resource, args, false);

    return useSignal(agent.state$);
}
