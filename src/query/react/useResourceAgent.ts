import React from "react";

import { useConstant } from "@/common/react";
import type { ArgsOrVoidOrSkip, IResource, TResourceAgentState } from "@/query/types";
import { useSignal } from "@/signals";

export function useResourceAgent<TArgs, TData>(
    resource: IResource<TArgs, TData>,
    ...args: ArgsOrVoidOrSkip<TArgs>
): TResourceAgentState<TArgs, TData> {
    const agent = useConstant(() => resource.createAgent());

    // Start agent in effect — fires on mount and when args change
    React.useEffect(() => {
        agent.start(...args);
    }, args);

    return useSignal(agent.state$);
}
