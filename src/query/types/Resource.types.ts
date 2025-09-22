import { ReadableSignalLike } from "signal";
import { FallbackOnNever } from "query/types/shared.types";

/**
 * Функция создания ресурса
 */
export type ResourceCreateFn<ARGS, RESULT, SELECTED = never> = (
    options: ResourceCreateOptions<ResourceDefinition<ARGS, RESULT, SELECTED>>
) => ResourceInstance<ResourceDefinition<ARGS, RESULT, SELECTED>>;

/**
 * Опции создания ресурса
 */
export type ResourceCreateOptions<D extends ResourceDefinition> = {
    /** Функция селектора для преобразования данных */
    select?: (data: D["Result"]) => D["Selected"];
    /** Функция запроса данных */
    queryFn: (args: D["Args"], tools: ResourceQueryFnTools) => Promise<D["Result"]>;
}

/**
 * Определение типов ресурса
 */
export type ResourceDefinition<A = any, R = any, S = any> = {
    Args: A;
    Result: R;
    Selected: S;
    Data: FallbackOnNever<S, R>;
}

/** Инструменты для функции запроса */
export type ResourceQueryFnTools = {
    /** Сигнал для отмены запроса */
    abortSignal?: AbortSignal;
}

/**
 * Экземпляр ресурса
 */
export type ResourceInstance<D extends ResourceDefinition> = {
    /** Создает агента для работы с ресурсом */
    createAgent(): ResourceAgentInstance<D>;

    /** Создает ссылку на ресурс с указанными аргументами */
    createRef(args: D["Args"]): ResourceRefInstanse<D>;
}

/**
 * Агент для работы с ресурсом
 */
export type ResourceAgentInstance<D extends ResourceDefinition> = {
    /** Observable состояния запроса */
    state$: ReadableSignalLike<ResourceQueryState<D>>;
    /** Инициирует запрос с указанными аргументами */
    initiate(args: D["Args"], force?: boolean): void;
    /** Создает новый агент */
    createAgent(): ResourceAgentInstance<D>;
}

/**
 * Состояние запроса ресурса
 */
export type ResourceQueryState<D extends ResourceDefinition> = {
    /** Инициализирован ли хотя бы один запрос */
    isInitiated: boolean;
    /** Первая загрузка */
    isLoading: boolean;
    /** Завершен ли запрос */
    isDone: boolean;
    /** Успешно ли завершен последний запрос (false по умолчанию) */
    isSuccess: boolean;
    /** Произошла ли ошибка последнего запроса (false по умолчанию) */
    isError: boolean;
    /** Заблокирован ли ресурс */
    isLocked: boolean;
    /** Перезагружается ли ресурс */
    isReloading: boolean;
    /** Оригинал ошибки, если есть */
    error: unknown | undefined;
    /** Данные, полученные в результате запроса (или select данных) */
    data: D["Data"] | undefined;
    /** Аргументы запроса */
    args: D["Args"] | undefined; // TODO undefined - это костыль для сведения типов, его быть не должно
}

/**
 * Эте не ссылка в "классическом" понимании, а абстракция
 * для работы с элементом кеша ресурса.
 */
export type ResourceRefInstanse<D extends ResourceDefinition> = {
    get has(): boolean;
    lock(): { unlock: () => void };
    unlockOne(): void;
    update(updateFn: (data: D['Data']) => D['Data']): { rollback: () => void };
    invalidate(): void;
    create(data: D['Data']): void;
}
