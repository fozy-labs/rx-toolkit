import type { IPluginHKT } from "@/query/types";

import type { PendingQueries } from "./common";
import type {
    Children,
    ContextRequirement,
    GroupDef,
    GroupOptions,
    IsRootOnly,
    MappedIssues,
    SubmitResult,
} from "./definition";

/** Options of `unstable_formsPlugin()`: the defaults of every form defined through the api. */
export interface FormsPluginOptions<TError = unknown> {
    /** Maps a submit error to issues for a form without its own `mapSubmitError`. */
    mapSubmitError?: (error: TError) => MappedIssues;
}

/**
 * What `unstable_formsPlugin()` adds to the api. `TError` is the error type of the api;
 * `Members` are what a plugin adds to every definition (`unknown` for none).
 */
export interface FormsApi<TError, Members = unknown> {
    /**
     * A form definition, as `FormSignal.group()` creates, typed by the api: `mapSubmitError`
     * receives the api's error type. The plugin's options are its defaults.
     */
    defineForm<
        F extends Children,
        C,
        Q,
        V extends string,
        DK extends keyof F = never,
        Context = unknown,
        Name extends string = never,
        Submit extends SubmitResult = never,
        Pending extends PendingQueries = never,
        Mapped extends MappedIssues = never,
    >(
        options: GroupOptions<F, C, Q, V, DK, Context, Name, Submit, Pending, Mapped, TError>,
    ): GroupDef<F, C, Q, DK, ContextRequirement<Context, F>, Submit, IsRootOnly<Name, Submit, Pending, Mapped>> &
        Members;
}

export type FormsPluginErrorMismatch =
    "Error: the mapSubmitError of unstable_formsPlugin() does not accept the error type of the api";

/**
 * The plugin HKT: the api gets `defineForm` typed by its error type. A plugin `mapSubmitError`
 * that does not accept that type leaves `defineForm` uncallable, with the reason as its type.
 */
export interface FormsPluginHKT<TPluginError = unknown> extends IPluginHKT {
    readonly apiType: FormsApiOf<this["_TError"], TPluginError>;
}

/** `FormsApi`, or an uncallable `defineForm` when the plugin's error type does not accept the api's. */
export type FormsApiOf<TError, TPluginError, Members = unknown> = [TError] extends [TPluginError]
    ? FormsApi<TError, Members>
    : { readonly defineForm: FormsPluginErrorMismatch };
