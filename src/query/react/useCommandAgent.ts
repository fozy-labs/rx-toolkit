import { useConstant, useEventHandler } from "@/common/react";
import { useSignal } from "@/signals";
import type { ArgsOrVoid, ICommand, TCommandAgentState } from "@/query/types";

export function useCommandAgent<TArgs, TResult>(
    command: ICommand<TArgs, TResult>,
): [trigger: (...args: ArgsOrVoid<TArgs>) => Promise<TResult>, state: TCommandAgentState<TArgs, TResult>] {
    const agent = useConstant(() => command.createAgent(), [command]);

    const state = useSignal(agent.state$);

    const trigger = useEventHandler((...args: ArgsOrVoid<TArgs>) => {
        return agent.trigger(...args)
    });

    return [trigger, state] as const;
}
