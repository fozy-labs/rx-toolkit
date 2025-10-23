import React from "react";
import { useConstant } from "@/common/react";
import { useSignal } from "@/signals/react";
import {
    Prettify,
    ResourceDefinition,
    ResourceInstance,
    ResourceQueryState
} from "@/query/types";
import { shallowEqual } from "@/query/lib/shallowEqual";
import { SKIP } from "@/query/SKIP_TOKEN";

type Result<D extends ResourceDefinition> = Prettify<ResourceQueryState<D>>

export function useResourceAgent<D extends ResourceDefinition>(
    res: ResourceInstance<D>,
    ...argss: D['Args'] extends void ? [] | [typeof SKIP] : [D['Args'] | typeof SKIP]
): Result<D>{
    const args = (argss[0] === SKIP ? SKIP : argss[0]) as D['Args'] | typeof SKIP;

    const prevArgsRef = React.useRef<D['Args'] | typeof SKIP>(args);

    const agent = useConstant(() => {
        const agent = res.createAgent();

        if (args !== SKIP) {
            agent.initiate(args);
        }

        return agent;
    });

    const state = agent.state$.peek();

    if (state.isInitiated && args !== SKIP && !shallowEqual(args, prevArgsRef.current)) {
        prevArgsRef.current = args;

        agent.initiate(args);
    }

    React.useEffect(() => () => {
        agent.complete();
    }, []);

    return useSignal(agent.state$);
}
