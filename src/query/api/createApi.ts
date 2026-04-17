import type { IApi, IPlugin, TCreateApiOptions } from "@/query/types";

import { Api } from "../core/api";

export function createApi<const TPlugins extends readonly IPlugin[] = readonly IPlugin[]>(
    options?: TCreateApiOptions<TPlugins>,
): IApi<TPlugins> {
    // Safe cast: Api implements IApi (with default plugins). At runtime,
    // plugin augmentations are applied via Object.assign in Api.createResource/createCommand.
    // The generic TPlugins only affects the compile-time type of the returned object.
    return new Api(options) as unknown as IApi<TPlugins>;
}

/** @internal — re-exported for unit testing only */
export { mergeHooks } from "../core/api";
