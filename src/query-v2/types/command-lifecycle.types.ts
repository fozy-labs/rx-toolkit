export interface ICommandCacheEntryAddedTools<TResult> {
    readonly $cacheDataLoaded: Promise<TResult>;
    readonly $cacheEntryRemoved: Promise<void>;
}

export interface ICommandQueryStartedTools<TResult> {
    readonly $queryFulfilled: Promise<{ data: TResult }>;
}

export type TOnCommandCacheEntryAdded<TResult> = (tools: ICommandCacheEntryAddedTools<TResult>) => void | Promise<void>;

export type TOnCommandQueryStarted<TArgs, TResult> = (
    args: TArgs,
    tools: ICommandQueryStartedTools<TResult>,
) => void | Promise<void>;
