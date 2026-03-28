import type { TResourceV2AgentState } from "./agent.types";
import type { IResourceV2, TResourceV2Options } from "./resource.types";
import type { ArgsOrVoidOrSkip, Prettify, UnionToIntersection } from "./shared.types";

/** Context passed to plugin.install() */
export interface IPluginContext {
    readonly keyStrategy: "serialize" | "compare";
}

/** Plugin interface */
export interface IPlugin {
    readonly name: string;
    /** Called once when createApi() is invoked */
    install(context: IPluginContext): void;
    /** Called per createResourceV2() — return contributed methods */
    augmentResource?<TArgs, TData>(
        resource: IResourceV2<TArgs, TData>,
        options: TResourceV2Options<TArgs, TData>,
    ): Record<string, unknown>;
}

/** Type-level contributions from ReactHooksPlugin */
export interface IReactHooksPluginContributions<TArgs, TData> {
    useResourceV2Agent(...args: ArgsOrVoidOrSkip<TArgs>): TResourceV2AgentState<TArgs, TData>;
}

/**
 * Maps a single plugin type to its contributed resource methods.
 * Uses conditional types instead of declaration merging.
 * Concrete branches are added per plugin implementation.
 */
export type PluginResourceContributions<TPlugin, TArgs, TData> = TPlugin extends { name: "ReactHooksPlugin" }
    ? IReactHooksPluginContributions<TArgs, TData>
    : Record<string, never>;

/**
 * Merges resource contributions from all plugins in the array.
 * Used to augment the return type of createResourceV2().
 */
export type PluginAugmentations<TPlugins extends readonly IPlugin[], TArgs, TData> = Prettify<
    UnionToIntersection<PluginResourceContributions<TPlugins[number], TArgs, TData>>
>;
