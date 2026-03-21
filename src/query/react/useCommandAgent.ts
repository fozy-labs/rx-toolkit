import { useConstant, useEventHandler } from "@/common/react";
import type { CommandAgentInstance, CommandDefinition, CommandQueryState, Prettify } from "@/query/types";
import { useSignal } from "@/signals/react";

type WithAgent<D extends CommandDefinition> = {
    createAgent: () => CommandAgentInstance<D>;
};

type TriggerFn<D extends CommandDefinition> = (args: D["Args"]) => Promise<D["Data"]>;
type Result<D extends CommandDefinition> = [TriggerFn<D>, Prettify<CommandQueryState<D>>];

/**
 * React hook для работы с командой (Command).
 *
 * Возвращает кортеж `[trigger, state]`:
 * - `trigger(args)` — инициирует выполнение команды и возвращает Promise с результатом.
 * - `state` — реактивное состояние выполнения команды.
 *
 * @example
 * ```tsx
 * const [updateUser, state] = useCommandAgent(api.updateUser);
 *
 * const handleSubmit = async () => {
 *   const result = await updateUser({ id: 1, name: 'New Name' });
 * };
 * ```
 */
export function useCommandAgent<D extends CommandDefinition>(op: WithAgent<D>): Result<D> {
    const agent = useConstant(() => op.createAgent());

    const state = useSignal(agent.state$);
    const trigger = useEventHandler((args: D["Args"]) => {
        agent.initiate(args);

        return new Promise<D["Data"]>((resolve, reject) => {
            const sub = agent.state$.obs.subscribe((s) => {
                if (s.isDone && !s.isLoading) {
                    sub.unsubscribe();
                    if (s.isSuccess) {
                        resolve(s.data as D["Data"]);
                    } else {
                        reject(s.error);
                    }
                }
            });
        });
    });

    return [trigger, state] as const;
}
