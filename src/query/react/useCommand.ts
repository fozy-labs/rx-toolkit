import React from "react";

import { useConstant, useEventHandler } from "@/common/react";
import type { ICommand, TCommandAgentState, TTriggerPromise } from "@/query/types";
import { useSignal } from "@/signals/react";

/**
 * The returned `trigger` never rejects: it resolves with a `TTriggerResult`
 * envelope (`{ status: "success", data }` / `{ status: "error", error }`), so
 * fire-and-forget usage (`onClick={() => trigger(args)}`) cannot produce an
 * unhandled rejection — the failure also surfaces through `state`. Call
 * `.unwrap()` for the raw throwing promise.
 */
export function useCommand<TArgs, TData, TError = unknown>(
    command: ICommand<TArgs, TData, TError>,
    key?: string,
): [trigger: (args: TArgs) => TTriggerPromise<TData, TError>, state: TCommandAgentState<TArgs, TData, TError>] {
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
