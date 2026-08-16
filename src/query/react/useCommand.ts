import React from "react";

import { useConstant, useEventHandler } from "@/common/react";
import type { ICommand, TCommandAgentState } from "@/query/types";
import { useSignal } from "@/signals/react";

/**
 * The returned `trigger` resolves with the mutation data and rejects with the
 * mapError-normalized error. The rejection is pre-handled by the agent, so
 * fire-and-forget usage (`onClick={() => trigger(args)}`) never produces an
 * unhandled rejection — the failure still surfaces through `state`.
 */
export function useCommand<TArgs, TData, TError = unknown>(
    command: ICommand<TArgs, TData, TError>,
    key?: string,
): [trigger: (args: TArgs) => Promise<TData>, state: TCommandAgentState<TArgs, TData, TError>] {
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
