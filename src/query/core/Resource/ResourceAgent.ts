import { Computed, Signal } from "@/signals";
import { ResourceAgentInstance, ResourceDefinition } from "@/query/types";
import type { CoreResourceQueryCache, Resource } from "./Resource"

export class ResourceAgent<D extends ResourceDefinition> implements ResourceAgentInstance<D> {
    private _resources$ = new Signal({
        previous$: null as CoreResourceQueryCache<D> | null,
        current$: null as CoreResourceQueryCache<D> | null,
    }, { isDisabled: true })

    state$ = new Computed(() => {
        const resources = this._resources$.value;
        let prevState;
        const currState = resources.current$?.value$.value;

        if (!currState?.isDone) {
            prevState = resources.previous$?.value;
        }

        // Нет текущего состояния — дефолт
        if (!currState) {
            return {
                isInitiated: false,
                isLoading: false,
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

    private _next(newCache: CoreResourceQueryCache<D>): void {
        const { previous$, current$ } = this._resources$.value;

        if (!current$) {
            this._resources$.next({
                previous$: null,
                current$: newCache,
            });
            return;
        }

        if (!current$.value.isDone && previous$?.value.isDone) {
            this._resources$.next({
                previous$: previous$,
                current$: newCache,
            });
            return;
        }

        this._resources$.next({
            previous$: current$,
            current$: newCache,
        });
    }

    initiate(args: D["Args"], force = false): void {
        const current = this._resources$.value.current$;
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

    complete() {
        this.state$.complete();
        this._resources$.complete();
    }
}
