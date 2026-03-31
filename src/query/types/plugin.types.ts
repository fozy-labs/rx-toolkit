import type { TResourceAgentState } from "./agent.types";
import type { TCommandAgentState } from "./command.types";
import type { IResource, TResourceOptions } from "./resource.types";
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
    /** Called per createResource() — return contributed methods */
    augmentResource?<TArgs, TData>(
        resource: IResource<TArgs, TData>,
        options: TResourceOptions<TArgs, TData>,
    ): Record<string, unknown>;
    /** Called per createCommand() — return contributed methods */
    augmentCommand?<TArgs, TResult>(
        command: import("./command.types").ICommand<TArgs, TResult>,
        options: import("./command.types").TCommandOptions<TArgs, TResult>,
    ): Record<string, unknown>;
}

/** Type-level contributions from ReactHooksPlugin */
export interface IReactHooksPluginContributions<TArgs, TData> {
    useResourceAgent(...args: ArgsOrVoidOrSkip<TArgs>): TResourceAgentState<TArgs, TData>;
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
 * Used to augment the return type of createResource().
 */
export type PluginAugmentations<TPlugins extends readonly IPlugin[], TArgs, TData> = Prettify<
    UnionToIntersection<PluginResourceContributions<TPlugins[number], TArgs, TData>>
>;

/** Type-level contributions from ReactHooksPlugin for commands */
export interface IReactHooksPluginCommandContributions<TArgs, TResult> {
    useCommandAgent(): [
        trigger: (...args: ArgsOrVoid<TArgs>) => Promise<TResult>,
        state: TCommandAgentState<TArgs, TResult>,
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
 * Used to augment the return type of createCommand().
 */
export type PluginCommandAugmentations<TPlugins extends readonly IPlugin[], TArgs, TResult> = Prettify<
    UnionToIntersection<PluginCommandContributions<TPlugins[number], TArgs, TResult>>
>;
