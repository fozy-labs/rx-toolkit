import type { ICommandV2, TCommandV2Options } from "./command.types";
import type { IPlugin, PluginAugmentations, PluginCommandAugmentations } from "./plugin.types";
import type { IResourceV2, TCompareArgsFn, TResourceV2Options, TSerializeArgsFn } from "./resource.types";
import type { TApiSnapshot } from "./snapshot.types";

/** API-level options — generic over plugins for type inference */
export interface ICreateApiOptions<TPlugins extends readonly IPlugin[] = readonly IPlugin[]> {
    readonly keyPrefix?: string | null;
    readonly keyStrategy?: "serialize" | "compare";
    readonly serializeArgs?: TSerializeArgsFn;
    readonly compareArg?: TCompareArgsFn;
    readonly cacheLifetime?: number;
    readonly plugins?: TPlugins;
    readonly initialSnapshot?: TApiSnapshot | null;
    readonly maxSnapshotDataAge?: number;
    readonly doCacheArgs?: boolean;
}

/** API instance — generic over plugins for type-safe augmentation */
export interface IApi<TPlugins extends readonly IPlugin[] = readonly IPlugin[]> {
    createResourceV2<TArgs = void, TData = unknown>(
        options: TResourceV2Options<TArgs, TData>,
    ): IResourceV2<TArgs, TData> & PluginAugmentations<TPlugins, TArgs, TData>;

    createCommandV2<TArgs = void, TResult = unknown>(
        options: TCommandV2Options<TArgs, TResult>,
    ): ICommandV2<TArgs, TResult> & PluginCommandAugmentations<TPlugins, TArgs, TResult>;

    /** Reset all resources, clear saved snapshot */
    resetAll(): void;

    /** Capture snapshot of all resources (throws if keyStrategy: "compare") */
    getSnapshot(): TApiSnapshot;
}
