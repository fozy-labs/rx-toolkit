import { Subject } from "rxjs";

export type Prettify<T> = {[KeyType in keyof T]: T[KeyType]} & {};

export type FallbackOnNever<T, F> = [T] extends [never] ? F : T;

export type CacheEntryAddedTools<DATA> = {
    /** Функция для ожидания загрузки данных в кеш */
    $cacheDataLoaded: Promise<void>
    /** Функция для ожидания удаления кеша */
    $cacheEntryRemoved: Promise<void>
    dataChanged$: Subject<DATA>
}

export type QueryStartedTools<DATA> = {
    /** Функция для уведомления об успешном завершении запроса */
    $queryFulfilled: Promise<{
        data: DATA,
        error: undefined
        isError: false
    } | {
        data: undefined,
        error: unknown
        isError: true
    }>;
}

export type OnCacheEntryAdded<ARGS, DATA> = (args: ARGS, tools: CacheEntryAddedTools<DATA>) => void;
export type OnQueryStarted<ARGS, DATA> = (args: ARGS, tools: QueryStartedTools<DATA>) => void;
