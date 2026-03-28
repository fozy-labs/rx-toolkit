import React from "react";

import { useConstant } from "@/common/react";
import type { ArgsOrVoidOrSkip, IResourceV2, TResourceV2AgentState } from "@/query-v2/types";
import { useSignal } from "@/signals";

export function useResourceV2Agent<TArgs, TData>(
    resource: IResourceV2<TArgs, TData>,
    ...args: ArgsOrVoidOrSkip<TArgs>
): TResourceV2AgentState<TArgs, TData> {
    const agent = useConstant(() => resource.createAgent());

    // Start agent in effect — fires on mount and when args change
    React.useEffect(() => {
        agent.start(...args);
    }, args);

    return useSignal(agent.state$);
}
