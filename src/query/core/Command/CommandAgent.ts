import type { ReactiveCache } from "@/query/lib/ReactiveCache";
import type { CommandAgentInstance, CommandDefinition } from "@/query/types";
import { Computed, Signal } from "@/signals";
import type { CoreCommandQueryState, Command } from "./Command";

export class CommandAgent<D extends CommandDefinition> implements CommandAgentInstance<D> {
    private _commands$ = Signal.state({
        current$: null as ReactiveCache<CoreCommandQueryState<D>> | null,
    }, { isDisabled: true });

    state$ = Computed.create(() => {
        const commands = this._commands$.get();
        const currState = commands.current$?.value$.get();

        // Нет текущего состояния — дефолт
        if (!currState) {
            return {
                isLoading: false,
                isDone: false,
                isSuccess: false,
                isError: false,
                error: undefined,
                data: undefined,
                args: undefined as D["Args"],
            };
        }

        return {
            isLoading: currState.isLoading,
            isDone: currState.isDone,
            isSuccess: currState.isSuccess,
            isError: currState.isError,
            error: currState.error ?? undefined,
            data: currState.data ?? undefined,
            args: currState.arg as D["Args"],
        };
    }, { isDisabled: true });

    constructor(
        private _command: Command<D>,
    ) {}

    private _next(newCache: ReactiveCache<CoreCommandQueryState<D>>): void {
        this._commands$.set({
            current$: newCache,
        });
    }

    initiate(args: D["Args"]): void {
        const cache = this._command.getQueryCache(args);

        if (!cache) {
            const newCache = this._command.initiate(args);
            this._next(newCache);
            return;
        }

        // Всегда запускаем команду заново, так как команды обычно не кэшируются как ресурсы
        const newCache = this._command.initiate(args, { cache });
        this._next(newCache);
    }

    createAgent(): CommandAgentInstance<D> {
        return new CommandAgent(this._command);
    }
}
