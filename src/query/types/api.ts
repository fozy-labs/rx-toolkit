import type { TCacheEntryAddedContext, TQueryStartedContext } from "./cache";
import type { ICommand, TCommandOptions } from "./command";
import type { CombinePluginCommandAugments, CombinePluginResourceAugments, PluginHKT } from "./plugin-hkt";
import type { IResource, TResourceOptions } from "./resource";
import type { ISyncDriver, TApiSnapshot } from "./snapshot";

// ==================== Error Mapping Types ====================

/**
 * Provenance passed to {@link TMapError} alongside the raw error. Lets a single
 * api-level mapper branch on where the failure originated without wrapping the
 * error itself.
 */
export interface TErrorContext {
    /** Which operation surfaced the error. */
    source: "query" | "command";
    /** The arguments the failing operation ran with (typed `unknown` — one api-level mapper serves resources/commands with differing arg types). */
    args: unknown;
    /** Serialized cache-entry key of the failing operation. */
    entryKey: string;
    /** Resource/command key, when one is configured. */
    key?: string;
}

/**
 * Normalizes every raw error surfaced by a query/command into the api's error
 * type. Runs exactly once per failure, at the boundary where the rejection is
 * first observed, so everything downstream — agent state, imperative-fetch
 * rejections, the Suspense throw, the command execute/trigger rejection — sees
 * the mapped value. The mapper also receives internal lifecycle errors that
 * feed the typed mutation rejection: a `CacheEntryRemovedError` when a command
 * entry is evicted mid-flight (re-execute with the same key, `reset()`), so
 * handle unknown shapes with a fallback branch. Deliberately kept raw: aborted runs (flow
 * control, never mapped) and lifecycle-hook contexts (`$queryFulfilled` rejects
 * with the raw error). The inferred return type becomes the api's `TError`.
 */
export type TMapError<TError = unknown> = (error: unknown, ctx: TErrorContext) => TError;

// ==================== Plugin Types ====================

export interface IPluginContext {
    keyPrefix: string;
}

export interface IPlugin {
    readonly name: string;
    install(context: IPluginContext): void;
    augmentResource?<TArgs, TData, TError = unknown>(
        resource: IResource<TArgs, TData, TError>,
        options: TResourceOptions<TArgs, TData>,
    ): Record<string, unknown>;
    augmentCommand?<TArgs, TData, TError = unknown>(
        command: ICommand<TArgs, TData, TError>,
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

export interface TCreateApiOptions<TPlugins extends readonly IPlugin[] = readonly IPlugin[], TError = unknown> {
    keyPrefix?: string | null;
    plugins?: TPlugins;
    serializeArgs?: (args: unknown) => string;
    resourceRetentionTime?: number | false;
    commandRetentionTime?: number | false;
    initialSnapshot?: TApiSnapshot | null;
    snapshotValidTime?: number | false;
    defaultSync?: "none" | "resources" | "all";
    syncDriver?: ISyncDriver;
    /**
     * Normalizes raw query/command errors into a typed error. When provided, the
     * `error` on every resource/command state (and every mutation rejection)
     * is typed as its return value instead of `unknown`. See {@link TMapError}.
     */
    mapError?: TMapError<TError>;
    onCacheEntryAdded?: (args: unknown, ctx: TCacheEntryAddedContext<unknown, unknown>) => void;
    onQueryStarted?: (args: unknown, ctx: TQueryStartedContext<unknown, unknown>) => void | Promise<void>;
}

// ==================== API Interface ====================

export interface IApi<TPlugins extends readonly IPlugin[] = readonly IPlugin[], TError = unknown> {
    createResource<TArgs = void, TData = unknown>(
        options: TResourceOptions<TArgs, TData>,
    ): IResource<TArgs, TData, TError> & CombinePluginResourceAugments<TPlugins, TArgs, TData, TError>;
    createCommand<TArgs = void, TData = unknown>(
        options: TCommandOptions<TArgs, TData>,
    ): ICommand<TArgs, TData, TError> & CombinePluginCommandAugments<TPlugins, TArgs, TData, TError>;
    getSnapshot(): TApiSnapshot;
    resetAll(): void;
}
