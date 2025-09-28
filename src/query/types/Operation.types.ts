import { ReadableSignalLike } from "signal";
import { FallbackOnNever } from "query/types/shared.types";
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
    resource: ResourceInstance<RD>,
    forwardArgs: (args: D["Args"]) => RD["Args"],
    invalidate?: boolean,
    lock?: boolean,
    update?: (tools: {
        draft: RD["Data"],
        args: D["Args"]
        data: D["Data"]
    }) => void | RD["Data"] | Promise<RD["Data"]>,
    optimisticUpdate?: (tools: {
        draft: RD["Data"],
        args: D["Args"]
    }) => void | RD["Data"] | Promise<D["Data"]>
    create?: (tools: {
        args: D["Args"]
        data: D["Data"]
    }) => RD["Data"] | Promise<RD["Data"]>
}

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
