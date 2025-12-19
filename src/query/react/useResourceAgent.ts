import React from "react";
import { useConstant } from "@/common/react";
import { useSignal } from "@/signals/react";
import {
    Prettify, ResourceAgentInstance,
    ResourceDefinition,
    ResourceInstance,
    ResourceQueryState
} from "@/query/types";
import { SKIP } from "@/query/SKIP_TOKEN";
import { DuplicatorDefinition, ResourceDuplicator } from "@/query/core/Resource/ResourceDuplicator";
import { ReadableSignalLike } from "@/signals/types";

type Result<D extends ResourceDefinition> = Prettify<ResourceQueryState<D>>

export function useResourceAgent<D extends ResourceDefinition>(
    res: ResourceInstance<D> | ResourceDuplicator<DuplicatorDefinition<D>>,
    ...argss: D['Args'] extends void ? [] | [typeof SKIP] : [D['Args'] | typeof SKIP]
): Result<D> {
    const args = (argss[0] === SKIP ? SKIP : argss[0]) as D['Args'] | typeof SKIP;

    const prevArgsRef = React.useRef<D['Args'] | typeof SKIP>(SKIP);

    const agent = useConstant(() => {
        const agent = res.createAgent();

        if (args !== SKIP) {
            agent.initiate(args);
        }

        return agent;
    });

    if (!compare(args, prevArgsRef.current, agent)) {
        prevArgsRef.current = args;

        agent.initiate(args as D['Args']);
    }

    return useSignal(agent.state$ as ReadableSignalLike<Result<D>>);
}

function compare(args: any, prevArgs: any, agent: ResourceAgentInstance<any>): boolean {
    if (args === SKIP && prevArgs === SKIP) {
        return true;
    }

    if (args === SKIP || prevArgs === SKIP) {
        return false;
    }

    return agent.compareArgs(args, prevArgs);
}
