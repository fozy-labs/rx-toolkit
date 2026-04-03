import type { IPlugin, PluginAugmentations } from "./plugin.types";
import type { IResource, TCompareArgsFn, TResourceOptions, TSerializeArgsFn } from "./resource.types";
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
    createResource<TArgs = void, TData = unknown>(
        options: TResourceOptions<TArgs, TData>,
    ): IResource<TArgs, TData> & PluginAugmentations<TPlugins, TArgs, TData>;

    /** Reset all resources, clear saved snapshot */
    resetAll(): void;

    /** Capture snapshot of all resources (throws if keyStrategy: "compare") */
    getSnapshot(): TApiSnapshot;
}
