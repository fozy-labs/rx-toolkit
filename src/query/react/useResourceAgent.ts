import React from "react";
import { useConstant, useUnmount } from "@/common/react";
import { useSignal } from "@/signals/react";
import {
    Prettify,
    ResourceDefinition,
    ResourceInstance,
    ResourceQueryState
} from "@/query/types";
import { SKIP } from "@/query/SKIP_TOKEN";

type Result<D extends ResourceDefinition> = Prettify<ResourceQueryState<D>>

export function useResourceAgent<D extends ResourceDefinition>(
    res: ResourceInstance<D>,
    ...argss: D['Args'] extends void ? [] | [typeof SKIP] : [D['Args'] | typeof SKIP]
): Result<D>{
    const args = (argss[0] === SKIP ? SKIP : argss[0]) as D['Args'] | typeof SKIP;

    const prevArgsRef = React.useRef<D['Args'] | typeof SKIP>(SKIP);

    const agent = useConstant(() => {
        const agent = res.createAgent();

        if (args !== SKIP) {
            agent.initiate(args);
        }

        return agent;
    });

    if (args !== SKIP && !agent.compareArgs(args, prevArgsRef.current)) {
        prevArgsRef.current = args;

        agent.initiate(args);
    }

    useUnmount(() => {
        agent.complete();
    });

    return useSignal(agent.state$);
}
