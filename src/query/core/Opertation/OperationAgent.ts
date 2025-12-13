import type { ReactiveCache } from "@/query/lib/ReactiveCache";
import { OperationAgentInstanse, OperationDefinition } from "@/query/types";
import { Computed, Signal } from "@/signals";
import type { CoreOperationQueryState, Operation } from "./Operation";

export class OperationAgent<D extends OperationDefinition> implements OperationAgentInstanse<D> {
    private _operations$ = new Signal({
        current$: null as ReactiveCache<CoreOperationQueryState<D>> | null,
    }, { isDisabled: true });

    state$ = new Computed(() => {
        const operations = this._operations$.get();
        const currState = operations.current$?.value$.get();

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
        private _operation: Operation<D>,
    ) {}

    private _next(newCache: ReactiveCache<CoreOperationQueryState<D>>): void {
        this._operations$.set({
            current$: newCache,
        });
    }

    initiate(args: D["Args"]): void {
        const cache = this._operation.getQueryCache(args);

        if (!cache) {
            const newCache = this._operation.initiate(args);
            this._next(newCache);
            return;
        }

        // Всегда запускаем операцию заново, так как операции обычно не кэшируются как ресурсы
        const newCache = this._operation.initiate(args, { cache });
        this._next(newCache);
    }

    createAgent(): OperationAgentInstanse<D> {
        return new OperationAgent(this._operation);
    }
}
