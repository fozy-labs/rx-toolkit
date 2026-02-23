import { ReadableSignalLike } from "@/signals/types";
import { FallbackOnNever, OnCacheEntryAdded, OnQueryStarted } from "./shared.types";
import { ResourceDefinition, ResourceInstance } from "./Resource.types";

/**
 * Функция создания команды
 */
export type CommandCreateFn<
    ARGS,
    RESULT,
    SELECTED = never,
> = (
    options: CommandCreateOptions<CommandDefinition<ARGS, RESULT, SELECTED>>
) => CommandInstance<CommandDefinition<ARGS, RESULT, SELECTED>>;

/**
 * Опции создания команды
 */
export type CommandCreateOptions<D extends CommandDefinition> = {
    /** Функция селектора для преобразования результата команды */
    select?: (data: D["Result"]) => D["Selected"];
    /** Функция выполнения команды */
    queryFn: (args: D["Args"]) => Promise<D["Result"]>;
    /** Связанные ресурсы */
    link?: (link: <RD extends ResourceDefinition>(options: LinkOptions<D, RD>) => void) => void;
    /**
     * Время жизни кеша в миллисекундах. По умолчанию 1_000 (1 секунда).
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
    devtoolsName?: string | false
}

/**
 * Настройки связи команды с ресурсом
 */
export type LinkOptions<D extends CommandDefinition, RD extends ResourceDefinition> = {
    /**
     * Целевой ресурс, с которым связывается команда
     * @required
     */
    resource: ResourceInstance<RD>;

    /**
     * Функция для получения аргументов ресурса из аргументов команды.
     * Используется для определения какой именно элемент в кэше ресурса нужно обновить
     * @required
     */
    forwardArgs: (args: D["Args"]) => RD["Args"];

    /**
     * Флаг для инвалидации (очистки) кэша ресурса после выполнения команды.
     * При true - кэш будет очищен и ресурс будет перезагружен при следующем обращении
     * @optional @default false
     */
    invalidate?: boolean;

    /**
     * Флаг для блокировки ресурса во время выполнения команды.
     * При true - ресурс будет заблокирован и не сможет выполнять новые запросы
     * @optional @default false
     */
    lock?: boolean;

    /**
     * Функция для обновления кэша ресурса после успешного выполнения команды.
     * Получает draft объект для мутации, аргументы команды и результат команды
     * @optional
     */
    update?: (tools: {
        /** Immer draft объект для мутации кэша ресурса */
        draft: RD["Data"];
        /** Аргументы, с которыми была вызвана команда */
        args: D["Args"];
        /** Результат выполнения команды */
        data: D["Data"];
        }) => void | RD["Data"] | Promise<RD["Data"]>;

    /**
     * Функция для оптимистичного обновления кэша ресурса ДО выполнения команды.
     * Позволяет обновить UI немедленно, до получения ответа от сервера
     * @optional
     */
    optimisticUpdate?: (tools: {
        /** Immer draft объект для мутации кэша ресурса */
        draft: RD["Data"];
        /** Аргументы, с которыми была вызвана команда */
        args: D["Args"];
        }) => void | RD["Data"] | Promise<RD["Data"]>;

    /**
     * Функция для создания нового элемента в кэше ресурса.
     * Используется когда команда создает новую сущность, которую нужно добавить в кэш
     * @optional
     */
    create?: (tools: {
        /** Аргументы, с которыми была вызвана команда */
        args: D["Args"];
        /** Результат выполнения команды */
        data: D["Data"];
    }) => RD["Data"] | Promise<RD["Data"]>;
};

/**
 * Определение типов команды
 */
export type CommandDefinition<A = any, R = any, S = any> = {
    Args: A;
    Result: R;
    Selected: S;
    Data: FallbackOnNever<S, R>;
}

/**
 * Экземпляр команды
 */
export type CommandInstance<D extends CommandDefinition> = {
    /** Создает агента для выполнения команды */
    createAgent(): CommandAgentInstance<D>;
    /**
     * Выполняет команду с указанными аргументами
     * @deprecated
     */
    mutate: (args: D["Args"]) => Promise<D["Data"]>;
}

/**
 * Агент для выполнения команды
 */
export type CommandAgentInstance<D extends CommandDefinition> = {
    /** Observable состояния выполнения команды */
    state$: ReadableSignalLike<CommandQueryState<D>>;
    /** Инициирует выполнение команды с указанными аргументами */
    initiate(args: D["Args"]): void;
    /** Создает новый агент команды */
    createAgent(): CommandAgentInstance<D>;
}

/**
 * Состояние выполнения команды
 */
export type CommandQueryState<D extends CommandDefinition> = {
    /** Выполняется ли команда в данный момент */
    isLoading: boolean;
    /** Завершена ли команда */
    isDone: boolean;
    /** Успешно ли завершена команда (false по умолчанию) */
    isSuccess: boolean;
    /** Произошла ли ошибка при выполнении команды (false по умолчанию) */
    isError: boolean;
    /** Оригинал ошибки, если есть */
    error: unknown | undefined;
    /** Результат выполнения команды */
    data: D["Data"] | undefined;
    /** Аргументы команды */
    args: D["Args"];
}
