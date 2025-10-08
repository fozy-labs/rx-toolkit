import { ReadableSignalLike } from "@/signals";
import { FallbackOnNever } from "./shared.types";
import { ResourceDefinition, ResourceInstance } from "./Resource.types";

/**
 * Функция создания операции
 */
export type OperationCreateFn<
    ARGS,
    RESULT,
    SELECTED = never,
> = (
    options: OperationCreateOptions<OperationDefinition<ARGS, RESULT, SELECTED>>
) => OperationInstance<OperationDefinition<ARGS, RESULT, SELECTED>>;

/**
 * Опции создания операции
 */
export type OperationCreateOptions<D extends OperationDefinition> = {
    /** Функция селектора для преобразования результата операции */
    select?: (data: D["Result"]) => D["Selected"];
    /** Функция выполнения операции */
    queryFn: (args: D["Args"]) => Promise<D["Result"]>;
    /** Связанные ресурсы */
    link?: (link: <RD extends ResourceDefinition>(options: LinkOptions<D, RD>) => void) => void;
}

/**
 * Настройки связи операции с ресурсом
 */
export type LinkOptions<D extends OperationDefinition, RD extends ResourceDefinition> = {
    /**
     * Целевой ресурс, с которым связывается операция
     * @required
     */
    resource: ResourceInstance<RD>;

    /**
     * Функция для получения аргументов ресурса из аргументов операции.
     * Используется для определения какой именно элемент в кэше ресурса нужно обновить
     * @required
     */
    forwardArgs: (args: D["Args"]) => RD["Args"];

    /**
     * Флаг для инвалидации (очистки) кэша ресурса после выполнения операции.
     * При true - кэш будет очищен и ресурс будет перезагружен при следующем обращении
     * @optional @default false
     */
    invalidate?: boolean;

    /**
     * Флаг для блокировки ресурса во время выполнения операции.
     * При true - ресурс будет заблокирован и не сможет выполнять новые запросы
     * @optional @default false
     */
    lock?: boolean;

    /**
     * Функция для обновления кэша ресурса после успешного выполнения операции.
     * Получает draft объект для мутации, аргументы операции и результат операции
     * @optional
     */
    update?: (tools: {
        /** Immer draft объект для мутации кэша ресурса */
        draft: RD["Data"];
        /** Аргументы, с которыми была вызвана операция */
        args: D["Args"];
        /** Результат выполнения операции */
        data: D["Data"];
        }) => void | RD["Data"] | Promise<RD["Data"]>;

    /**
     * Функция для оптимистичного обновления кэша ресурса ДО выполнения операции.
     * Позволяет обновить UI немедленно, до получения ответа от сервера
     * @optional
     */
    optimisticUpdate?: (tools: {
        /** Immer draft объект для мутации кэша ресурса */
        draft: RD["Data"];
        /** Аргументы, с которыми была вызвана операция */
        args: D["Args"];
        }) => void | RD["Data"] | Promise<RD["Data"]>;

    /**
     * Функция для создания нового элемента в кэше ресурса.
     * Используется когда операция создает новую сущность, которую нужно добавить в кэш
     * @optional
     */
    create?: (tools: {
        /** Аргументы, с которыми была вызвана операция */
        args: D["Args"];
        /** Результат выполнения операции */
        data: D["Data"];
    }) => RD["Data"] | Promise<RD["Data"]>;
};

/**
 * Определение типов операции
 */
export type OperationDefinition<A = any, R = any, S = any> = {
    Args: A;
    Result: R;
    Selected: S;
    Data: FallbackOnNever<S, R>;
}

/**
 * Экземпляр операции
 */
export type OperationInstance<D extends OperationDefinition> = {
    /** Создает агента для выполнения операции */
    createAgent(): OperationAgentInstanse<D>;
    /**
     * Выполняет операцию с указанными аргументами
     * @deprecated
     */
    mutate: (args: D["Args"]) => Promise<D["Data"]>;
}

/**
 * Агент для выполнения операции
 */
export type OperationAgentInstanse<D extends OperationDefinition> = {
    /** Observable состояния выполнения операции */
    state$: ReadableSignalLike<OperationQueryState<D>>;
    /** Инициирует выполнение операции с указанными аргументами */
    initiate(args: D["Args"]): void;
    /** Создает новый агент операции */
    createAgent(): OperationAgentInstanse<D>;
}

/**
 * Состояние выполнения операции
 */
export type OperationQueryState<D extends OperationDefinition> = {
    /** Выполняется ли операция в данный момент */
    isLoading: boolean;
    /** Завершена ли операция */
    isDone: boolean;
    /** Успешно ли завершена операция (false по умолчанию) */
    isSuccess: boolean;
    /** Произошла ли ошибка при выполнении операции (false по умолчанию) */
    isError: boolean;
    /** Оригинал ошибки, если есть */
    error: unknown | undefined;
    /** Результат выполнения операции */
    data: D["Data"] | undefined;
    /** Аргументы операции */
    args: D["Args"];
}
