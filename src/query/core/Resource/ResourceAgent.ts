import { Computed, Effect, Signal } from "@/signals";
import { ResourceAgentInstance, ResourceDefinition, ResourceQueryState } from "@/query/types";
import type { CoreResourceQueryCache, Resource } from "./Resource"

export class ResourceAgent<D extends ResourceDefinition> implements ResourceAgentInstance<D> {
    private _resources$ = new Signal({
        previous$: null as CoreResourceQueryCache<D> | null,
        current$: null as CoreResourceQueryCache<D> | null,
    }, { isDisabled: true });

    // private _effect = new Effect(() => {
    //     const current$ = this._resources$.get().current$;
    //     const args = current$?.value.args!;
    //
    //     // Если ресурс который мы слушаем очистился, то инициируем его заново с теми же аргументами
    //     const sub = current$?.onClean$.subscribe(() => {
    //         this._resources$.set({
    //             previous$: null,
    //             current$: null,
    //         });
    //
    //         this.initiate(args);
    //     });
    //
    //     return () => {
    //         sub?.unsubscribe();
    //     }
    // });

    state$ = new Computed(() => {
        const resources = this._resources$.get();
        let prevState;
        const currState = resources.current$?.value$.get();

        if (!currState?.isDone) {
            prevState = resources.previous$?.value;
        }

        // Нет текущего состояния — дефолт
        if (!currState) {
            return {
                isInitiated: false,
                isLoading: false,
                isInitialLoading: false,
                isDone: false,
                isSuccess: false,
                isError: false,
                isLocked: false,
                isReloading: false,
                error: undefined,
                data: undefined,
                args: undefined as D["Args"],
            };
        }

        // Если идёт загрузка, но есть успешные данные из прошлого запроса — показываем их
        const isShowPrev = currState.isLoading && prevState && prevState.isSuccess;

        return {
            isInitiated: currState.isInitiated || !!prevState,
            isLoading: currState.isLoading,
            isInitialLoading: currState.isLoading && !currState.isDone && !prevState?.isDone,
            isDone: currState.isDone,
            isSuccess: currState.isSuccess,
            isError: currState.isError,
            isLocked: currState.isLocked,
            isReloading: currState.isReloading,
            error: isShowPrev ? prevState!.error ?? undefined : currState.error ?? undefined,
            data: isShowPrev ? prevState!.data ?? undefined : currState.data ?? undefined,
            args: currState.args ?? undefined,
        };
    }, { isDisabled: true });

    constructor(
        private _resource: Resource<D>,
    ) {}

    getState(values: D["Args"]): ResourceQueryState<D> {
        const cache = this._resource.getQueryCache(values);

        if (!cache) {
            return {
                isInitiated: false,
                isLoading: false,
                isInitialLoading: false,
                isDone: false,
                isSuccess: false,
                isError: false,
                isLocked: false,
                isReloading: false,
                error: undefined,
                data: undefined,
                args: undefined as D["Args"],
            };
        }

        const state = cache.value;

        return {
            isInitiated: state.isInitiated,
            isLoading: state.isLoading,
            isInitialLoading: state.isLoading && !state.isDone,
            isDone: state.isDone,
            isSuccess: state.isSuccess,
            isError: state.isError,
            isLocked: state.isLocked,
            isReloading: state.isReloading,
            error: state.error ?? undefined,
            data: state.data ?? undefined,
            args: state.args ?? undefined,
        };
    }

    initiate(args: D["Args"], force = false): void {
        const current = this._resources$.peek().current$;
        const cache = this._resource.getQueryCache(args);

        if (!cache) {
            const newCache = this._resource.initiate(args);
            this._next(newCache);
            return;
        }

        if (force || !(cache.value.isDone || cache.value.isLoading)) {
            this._resource.initiate(args, { cache });
        }

        if (current !== cache) {
            this._next(cache);
        }
    }

    compareArgs(args: D["Args"], otherArgs: D["Args"]): boolean {
        return this._resource.compareArgs(args, otherArgs);
    }

    private _next(newCache: CoreResourceQueryCache<D>): void {
        const { previous$, current$ } = this._resources$.peek();

        if (!current$) {
            this._resources$.set({
                previous$: null,
                current$: newCache,
            });
            return;
        }

        if (!current$.value$.peek().isDone && previous$?.value$.peek().isDone) {
            this._resources$.set({
                previous$: previous$,
                current$: newCache,
            });
            return;
        }

        this._resources$.set({
            previous$: current$,
            current$: newCache,
        });
    }
}
