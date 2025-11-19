import { Patch as ImmerPatch } from "immer";
import { ReadableSignalLike } from "@/signals";
import {
    FallbackOnNever,
    OnCacheEntryAdded,
    OnQueryStarted,
} from "./shared.types";

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
    /**
     * Время жизни кеша в миллисекундах. По умолчанию 60_000 (1 минута).
     * Если указано false - кеш не удаляется автоматически.
     */
    cacheLifetime?: number | false;
    /**
     * Хук, вызываемый при добавлении нового элемента в кеш.
     * Также позволяет отследить:
     *  - когда данные были загружены (впервые)
     *  - когда элемент был удален из кеша
     */
    onCacheEntryAdded?: OnCacheEntryAdded<D["Args"], D["Data"]>;
    /**
     * Хук, вызываемый при старте запроса.
     * Также позволяет отследить:
     * - завершение запроса с результатом или ошибкой
     */
    onQueryStarted?: OnQueryStarted<D["Args"], D["Result"]>;
    /**
     * Настройка отображения в devtools
     */
    devtoolsName?: string | false;
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
    /** Завершает работу агента, позволяя освободить ресурсы */
    complete(): void;
}

/**
 * Состояние запроса ресурса
 */
export type ResourceQueryState<D extends ResourceDefinition> = {
    /** Инициализирован ли хотя бы один запрос */
    isInitiated: boolean;
    /** Загрузка */
    isLoading: boolean;
    /** Первая загрузка */
    isInitialLoading: boolean;
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
 * Транзакция ресурса
 */
export type ResourceTransaction = {
    patches: ImmerPatch[]
    inversePatches: ImmerPatch[]
    status: 'pending' | 'committed' | 'aborted'
    abort(): void
    commit(): void
}

/**
 * Эте не ссылка в "классическом" понимании, а абстракция
 * для работы с элементом кеша ресурса.
 */
export type ResourceRefInstanse<D extends ResourceDefinition> = {
    get has(): boolean;
    lock(): { unlock: () => void };
    unlockOne(): void;
    patch(patchFn: (data: D['Data']) => void): ResourceTransaction | null;
    invalidate(): void;
    create(data: D['Data']): void;
}
