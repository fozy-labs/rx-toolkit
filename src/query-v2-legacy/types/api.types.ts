import type { IPlugin, PluginAugmentations } from "./plugin.types";
import type { IResourceV2, IResourceV2Options } from "./resource.types";
import type { TCompareArgsFn, TSerializeArgsFn } from "./shared.types";
import type { TApiSnapshot } from "./snapshot.types";

/** Options for createApi factory */
export interface ICreateApiOptions<TPlugins extends IPlugin[] = []> {
    keyPrefix?: string | null;
    keyStrategy?: "serialize" | "compare";
    serializeArgs?: TSerializeArgsFn;
    compareArg?: TCompareArgsFn;
    initialSnapshot?: TApiSnapshot | null;
    cacheLifetime?: number;
    plugins?: TPlugins;
    maxSnapshotDataAge?: number;
    doCacheArgs?: boolean;
}

/** API instance returned by createApi */
export interface IApi<TPlugins extends IPlugin[] = []> {
    createResource<TArgs, TData, TError = Error>(
        options: IResourceV2Options<TArgs, TData, TError>,
    ): IResourceV2<TArgs, TData, TError> & PluginAugmentations<TPlugins, TArgs, TData, TError>;

    resetAll(): void;
    getSnapshot(): TApiSnapshot;
}
