import { Computed, Signal } from "@/signals";
import { ResourceAgentInstance } from "@/query/types";
import {
    CoreResourceDuplicatorCache,
    ResourceDuplicator,
    DuplicatorDefinition
} from "@/query/core/Resource/ResourceDuplicator";

export class ResourceDuplicatorAgent<D extends DuplicatorDefinition> implements ResourceAgentInstance<D['RESOURCE_DEFINITION']> {
    private _resources$ = new Signal({
        previous$: null as CoreResourceDuplicatorCache<D> | null,
        current$: null as CoreResourceDuplicatorCache<D> | null,
    }, { isDisabled: true });

    state$ = new Computed(() => {
        const resources = this._resources$.get();
        let prevState;
        const currState = resources.current$?.value$.get();

        // Отлавливаем кейс, когда ресурс был спрошен.
        // На данные момент единсвенная причина сброса - resetAllQueriesCache(),
        //  но в будущем могут быть и другие причины, что потребует доработку.
        if (currState && !currState.isInitiated) {
            this._resource.initiate(currState.args!, resources.current$!);
            return {
                isInitiated: true,
                isLoading: true,
                isInitialLoading: true,
                isDone: false,
                isSuccess: false,
                isError: false,
                isReloading: false,
                error: undefined,
                data: undefined,
                // TODO вообще нет точного представлния, как блокировака доложна работать.
                //  Мб тут стоит брать currState.isLocked.
                isLocked: false,
                args: currState.args!,
            }
        }

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
                args: undefined as unknown as D['ARGS_ITEM'][],
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
        private _resource: ResourceDuplicator<D>,
    ) {}

    initiate(args: D['ARGS_ITEM'][], force = false): void {
        const current = this._resources$.peek().current$;
        const cache = this._resource.getQueryCache(args);

        if (!cache) {
            const newCache = this._resource.initiate(args);
            this._next(newCache);
            return;
        }

        if (force || !(cache.value.isDone || cache.value.isLoading)) {
            this._resource.initiate(args, cache);
        }

        if (current !== cache) {
            this._next(cache);
        }
    }

    compareArgs(args: D['ARGS_ITEM'][], otherArgs: D['ARGS_ITEM'][]): boolean {
        return this._resource.compareArgs(args, otherArgs);
    }

    private _next(newCache: CoreResourceDuplicatorCache<D>): void {
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
