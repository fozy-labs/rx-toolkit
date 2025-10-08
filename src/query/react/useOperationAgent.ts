import { useConstant, useEventHandler } from "@/common/react";
import { useSignal } from "@/signals/react";
import type { Prettify, OperationAgentInstanse, OperationDefinition, OperationQueryState } from "@/query/types";

type WithAgent<D extends OperationDefinition> = {
    createAgent: () => OperationAgentInstanse<D>;
}

type TriggerFn<D extends OperationDefinition> = (args: D['Args']) => Promise<D['Data']>
type Result<D extends OperationDefinition> = [TriggerFn<D>, Prettify<OperationQueryState<D>>]

export function useOperationAgent<D extends OperationDefinition>(op: WithAgent<D>): Result<D> {
    const agent = useConstant(() => op.createAgent())

    const state = useSignal(agent.state$);
    const trigger = useEventHandler((args: D['Args']) => {
        agent.initiate(args);

        return new Promise((resolve, reject) => {
           const sub = agent.state$.subscribe((s) => {
                if (s.isDone && !s.isLoading) {
                    sub.unsubscribe();
                    if (s.isSuccess) {
                        resolve(s.data as D['Data']);
                    } else {
                        reject(s.error);
                    }
                }
           });
        });
    });

    return [trigger, state] as const
}
