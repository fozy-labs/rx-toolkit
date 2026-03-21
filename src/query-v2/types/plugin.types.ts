import type { ResourceV2 } from "@/query-v2";

import type { IApi } from "./api.types";
import type { IResourceV2Options } from "./resource.types";
import type { Prettify } from "./shared.types";

/** Plugin interface — all plugins must implement this */
export interface IPlugin {
    /** Unique plugin name */
    readonly name: string;

    /** Called once when createApi installs the plugin */
    install(context: IPluginContext): void;

    /** Called for each createResource — returns augmented resource */
    augmentResource<TArgs, TData, TError>(
        resource: ResourceV2<TArgs, TData, TError>,
        options: IResourceV2Options<TArgs, TData, TError>,
    ): Record<string, unknown>;
}

/** Context provided to plugins during install */
export interface IPluginContext {
    /** The API instance */
    readonly api: IApi<any>;
    /** Key strategy for this API */
    readonly keyStrategy: "serialize" | "compare";
}

/** Helper: converts a union to an intersection */
type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/**
 * Extract plugin contributions from a single plugin.
 * Each plugin extends PluginContributionMap via declaration merging.
 * The name property is used as the key lookup.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
export interface PluginContributionMap<TArgs, TData, TError> {}

export type ExtractPluginContributions<P extends IPlugin, TArgs, TData, TError> = P extends { name: infer N }
    ? N extends keyof PluginContributionMap<TArgs, TData, TError>
        ? PluginContributionMap<TArgs, TData, TError>[N]
        : object
    : object;

/**
 * Type-level utility: extracts and merges augmentations from a plugin tuple.
 * Uses UnionToIntersection + Prettify as per ADR-1.
 */
export type PluginAugmentations<TPlugins extends IPlugin[], TArgs, TData, TError> = TPlugins extends []
    ? object
    : Prettify<
          UnionToIntersection<
              TPlugins[number] extends infer P
                  ? P extends IPlugin
                      ? ExtractPluginContributions<P, TArgs, TData, TError>
                      : never
                  : never
          >
      >;
