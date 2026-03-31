import type { TResourceV2AgentState } from "./agent.types";
import type { TCommandV2AgentState } from "./command.types";
import type { IResourceV2, TResourceV2Options } from "./resource.types";
import type { ArgsOrVoid, ArgsOrVoidOrSkip, Prettify, UnionToIntersection } from "./shared.types";

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
    /** Called per createCommandV2() — return contributed methods */
    augmentCommand?<TArgs, TResult>(
        command: import("./command.types").ICommandV2<TArgs, TResult>,
        options: import("./command.types").TCommandV2Options<TArgs, TResult>,
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

/** Type-level contributions from ReactHooksPlugin for commands */
export interface IReactHooksPluginCommandContributions<TArgs, TResult> {
    useCommandV2Agent(): [
        trigger: (...args: ArgsOrVoid<TArgs>) => Promise<TResult>,
        state: TCommandV2AgentState<TArgs, TResult>,
    ];
}

/**
 * Maps a single plugin type to its contributed command methods.
 */
export type PluginCommandContributions<TPlugin, TArgs, TResult> = TPlugin extends { name: "ReactHooksPlugin" }
    ? IReactHooksPluginCommandContributions<TArgs, TResult>
    : Record<string, never>;

/**
 * Merges command contributions from all plugins in the array.
 * Used to augment the return type of createCommandV2().
 */
export type PluginCommandAugmentations<TPlugins extends readonly IPlugin[], TArgs, TResult> = Prettify<
    UnionToIntersection<PluginCommandContributions<TPlugins[number], TArgs, TResult>>
>;
