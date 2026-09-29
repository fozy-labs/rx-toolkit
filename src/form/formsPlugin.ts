import type { IApi, IPlugin } from "@/query/types";

import { createGroupDef } from "./core/definition/createGroupDef";
import type { FormsPluginHKT, FormsPluginOptions } from "./types";

/**
 * The forms plugin of `createApi`: adds `api.defineForm(...)`. Its options are the defaults of
 * every form defined through the api. `unstable_formsReactPlugin` extends it and replaces it:
 * both add `defineForm`, so the api rejects the two together.
 */
export class unstable_FormsPlugin<TError = unknown> implements IPlugin {
    readonly name: string = "FormsPlugin";

    declare readonly _hkt: FormsPluginHKT<TError>;

    constructor(readonly options: FormsPluginOptions<TError> = {}) {}

    install(): void {
        // no-op
    }

    augmentApi(api: IApi): Record<string, unknown> {
        return { defineForm: (options: unknown) => this.defineForm(api, options) };
    }

    /** `api.defineForm(options)`: a group definition with the api and the plugin's defaults. */
    protected defineForm(api: IApi, options: unknown): object {
        return createGroupDef(options, {
            api,
            mapSubmitError: this.options.mapSubmitError as ((error: unknown) => unknown) | undefined,
            members: (definition) => this.definitionMembers(definition),
            instanceMembers: (definition, instance) => this.instanceMembers(definition, instance),
        });
    }

    /** Members a subclass adds to every definition it creates, before the definition is frozen. */
    protected definitionMembers(_definition: object): Readonly<Record<string, unknown>> {
        return {};
    }

    /**
     * Members a subclass adds to every instance whose root is a definition it created, as
     * property descriptors (a getter may create its value lazily), before the instance is frozen.
     */
    protected instanceMembers(_definition: object, _instance: object): PropertyDescriptorMap {
        return {};
    }
}

/** The forms plugin: `createApi({ plugins: [unstable_formsPlugin({ mapSubmitError })] })`. */
export function unstable_formsPlugin<TError = unknown>(
    options?: FormsPluginOptions<TError>,
): unstable_FormsPlugin<TError> {
    return new unstable_FormsPlugin(options);
}
