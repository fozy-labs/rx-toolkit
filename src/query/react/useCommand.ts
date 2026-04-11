import React from "react";

import { useConstant, useEventHandler } from "@/common/react";
import type { ICommand, TCommandAgentState } from "@/query/types";
import { useSignal } from "@/signals/react";

export function useCommand<TArgs, TData>(
    command: ICommand<TArgs, TData>,
    key?: string,
): [trigger: (args: TArgs) => Promise<TData>, state: TCommandAgentState<TArgs, TData>] {
    const agent = useConstant(() => command.createAgent(key), [command]);

    React.useEffect(() => {
        if (key !== undefined) {
            agent.setKey(key);
        }
    }, [agent, key]);

    const state = useSignal(agent.state$);

    const trigger = useEventHandler((args: TArgs) => agent.trigger(args));

    return [trigger, state];
}
