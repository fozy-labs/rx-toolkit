import React from "react";

import { useConstant } from "@/common/react";
import type { ArgsOrVoid, ICommand, TCommandAgentState } from "@/query/types";
import { useSignal } from "@/signals";

export function useCommandAgent<TArgs, TResult>(
    command: ICommand<TArgs, TResult>,
): [trigger: (...args: ArgsOrVoid<TArgs>) => Promise<TResult>, state: TCommandAgentState<TArgs, TResult>] {
    const agent = useConstant(() => command.createAgent());
    const state = useSignal(agent.state$);
    const trigger = React.useCallback((...args: ArgsOrVoid<TArgs>) => agent.trigger(...args), [agent]);
    return [trigger, state];
}
