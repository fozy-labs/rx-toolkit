import React from "react";
import { useConstant, useSignal } from "react-hooks";
import { ResourceAgentInstance, ResourceDefinition, ResourceQueryState } from "../types/Resource.types";
import { shallowEqual } from "../lib/shallowEqual";
import { Prettify } from "../types/shared.types";
import { SKIP } from "../SKIP_TOKEN";

type WithAgent<D extends ResourceDefinition> = {
    createAgent: () => ResourceAgentInstance<D>;
}

type Result<D extends ResourceDefinition> = Prettify<ResourceQueryState<D>>

export function useResourceAgent<D extends ResourceDefinition>(
    res: WithAgent<D>,
    ...argss: D['Args'] extends void ? [] | [typeof SKIP] : [D['Args'] | typeof SKIP]
): Result<D>{
    const args = (argss[0] === SKIP ? SKIP : argss[0]) as D['Args'] | typeof SKIP;
    const agent = useConstant(() => {
        const agent = res.createAgent();

        if (args !== SKIP) {
            agent.initiate(args);
        }

        return agent;
    });

    React.useEffect(() => {
        if (args === SKIP) {
            return;
        }

        const state = agent.state$.peek();

        if (state.isInitiated && shallowEqual(args, state.args)) {
            return;
        }

        agent.initiate(args);
    }, [args]);

    return useSignal(agent.state$);
}
