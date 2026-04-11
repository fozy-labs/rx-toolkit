import type { TCacheEntryAddedContext, TQueryStartedContext } from "./cache";
import type { ICommand, TCommandOptions } from "./command";
import type { CombinePluginCommandAugments, CombinePluginResourceAugments, PluginHKT } from "./plugin-hkt";
import type { IResource, TResourceOptions } from "./resource";
import type { ISyncDriver, TApiSnapshot } from "./snapshot";

// ==================== Plugin Types ====================

export interface IPluginContext {
    keyPrefix: string;
}

export interface IPlugin {
    readonly name: string;
    install(context: IPluginContext): void;
    augmentResource?<TArgs, TData>(
        resource: IResource<TArgs, TData>,
        options: TResourceOptions<TArgs, TData>,
    ): Record<string, unknown>;
    augmentCommand?<TArgs, TData>(
        command: ICommand<TArgs, TData>,
        options: TCommandOptions<TArgs, TData>,
    ): Record<string, unknown>;

    /**
     * Phantom type member. Plugins that provide typed augmentations should
     * `declare readonly _hkt: MyPluginHKT` where `MyPluginHKT extends PluginHKT`.
     * Never set at runtime — purely a compile-time protocol.
     */
    readonly _hkt?: PluginHKT;
}

// ==================== Options Types ====================

export interface TCreateApiOptions<TPlugins extends readonly IPlugin[] = readonly IPlugin[]> {
    keyPrefix?: string | null;
    plugins?: TPlugins;
    serializeArgs?: (args: unknown) => string;
    resourceRetentionTime?: number | false;
    commandRetentionTime?: number | false;
    initialSnapshot?: TApiSnapshot | null;
    snapshotValidTime?: number | false;
    defaultSync?: "none" | "resources" | "all";
    syncDriver?: ISyncDriver;
    onCacheEntryAdded?: (args: unknown, ctx: TCacheEntryAddedContext<unknown, unknown>) => void;
    onQueryStarted?: (args: unknown, ctx: TQueryStartedContext<unknown, unknown>) => void | Promise<void>;
}

// ==================== API Interface ====================

export interface IApi<TPlugins extends readonly IPlugin[] = readonly IPlugin[]> {
    createResource<TArgs = void, TData = unknown>(
        options: TResourceOptions<TArgs, TData>,
    ): IResource<TArgs, TData> & CombinePluginResourceAugments<TPlugins, TArgs, TData>;
    createCommand<TArgs = void, TData = unknown>(
        options: TCommandOptions<TArgs, TData>,
    ): ICommand<TArgs, TData> & CombinePluginCommandAugments<TPlugins, TArgs, TData>;
    getSnapshot(): TApiSnapshot;
    resetAll(): void;
}
