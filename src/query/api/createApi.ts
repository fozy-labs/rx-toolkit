import type { IApi, IPlugin, TCreateApiOptions } from "@/query/types";

import { Api } from "../core/api";

export function createApi<const TPlugins extends readonly IPlugin[] = readonly IPlugin[], TError = unknown>(
    options?: TCreateApiOptions<TPlugins, TError>,
): IApi<TPlugins, TError> {
    // Safe cast: Api implements IApi (with default plugins). At runtime,
    // plugin augmentations are applied via Object.assign in Api.createResource/createCommand.
    // The generics TPlugins / TError only affect the compile-time type of the returned
    // object — TError is inferred from `options.mapError`'s return type and is projected
    // onto every resource/command state through this cast plus the plugin HKT machinery.
    return new Api(options) as unknown as IApi<TPlugins, TError>;
}

/** @internal — re-exported for unit testing only */
export { mergeHooks } from "../core/api";
