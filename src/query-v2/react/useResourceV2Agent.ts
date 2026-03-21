import React from "react";

import { useConstant } from "@/common/react/useConstant";
import type { ResourceV2 } from "@/query-v2/core/resource/ResourceV2";
import { SKIP, type SKIP_TOKEN } from "@/query-v2/lib/SKIP_TOKEN";
import type { IResourceV2AgentState } from "@/query-v2/types/agent.types";
import { useSignal } from "@/signals/react/useSignal";
import type { ReadableSignalLike } from "@/signals/types";

/**
 * React hook that creates a ResourceV2Agent and returns its reactive state (SWR).
 *
 * @param resource - The resource to observe.
 * @param args - Query arguments, or `SKIP_TOKEN` to skip the query.
 * @returns Reactive agent state with `data`, `error`, status flags, etc.
 * @see docs/query-v2/README.md
 */
export function useResourceV2Agent<TArgs, TData, TError>(
    resource: ResourceV2<TArgs, TData, TError>,
    args: TArgs | SKIP_TOKEN,
): IResourceV2AgentState<TArgs, TData, TError> {
    const prevArgsRef = React.useRef<TArgs | SKIP_TOKEN>(SKIP);

    const agent = useConstant(() => {
        const agent = resource.createAgent();

        if (args !== SKIP) {
            agent.start(args as TArgs);
        }

        return agent;
    });

    if (!compareArgs(args, prevArgsRef.current, resource)) {
        prevArgsRef.current = args;

        if (args !== SKIP) {
            agent.start(args as TArgs);
        }
    }

    return useSignal(agent.state$ as unknown as ReadableSignalLike<IResourceV2AgentState<TArgs, TData, TError>>);
}

function compareArgs<TArgs, TData, TError>(
    args: TArgs | SKIP_TOKEN,
    prevArgs: TArgs | SKIP_TOKEN,
    resource: ResourceV2<TArgs, TData, TError>,
): boolean {
    if (args === SKIP && prevArgs === SKIP) return true;
    if (args === SKIP || prevArgs === SKIP) return false;
    return resource.compareArgs(args as TArgs, prevArgs as TArgs);
}
