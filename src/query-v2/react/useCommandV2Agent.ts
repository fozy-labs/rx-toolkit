import React from "react";

import { useConstant } from "@/common/react";
import type { ArgsOrVoid, ICommandV2, TCommandV2AgentState } from "@/query-v2/types";
import { useSignal } from "@/signals";

export function useCommandV2Agent<TArgs, TResult>(
    command: ICommandV2<TArgs, TResult>,
): [trigger: (...args: ArgsOrVoid<TArgs>) => Promise<TResult>, state: TCommandV2AgentState<TArgs, TResult>] {
    const agent = useConstant(() => command.createAgent());
    const state = useSignal(agent.state$);
    const trigger = React.useCallback((...args: ArgsOrVoid<TArgs>) => agent.trigger(...args), [agent]);
    return [trigger, state];
}
