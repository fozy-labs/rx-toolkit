import type React from "react";

import type { IPluginHKT } from "@/query/types";

import type { AnyGroupDef, FormContext, FormInit, FormsApiOf, InitializeOptions } from "../types";

/** Options of `useForm`. */
export interface UseFormOptions {
    /** How a new `state` in `init` is applied. Default `{ keepDirtyValues: true }`. */
    initializeOptions?: InitializeOptions;
}

/** The parameters of `useForm`: `init` is optional unless the definition requires a context. */
export type UseFormArgs<D> = D extends AnyGroupDef
    ? unknown extends FormContext<D>
        ? [init?: FormInit<D>, options?: UseFormOptions]
        : [init: FormInit<D>, options?: UseFormOptions]
    : never;

/** What `unstable_formsReactPlugin()` adds to every instance of its definitions. */
export interface FormReactInstanceMembers {
    /**
     * `<form.Provide>` puts the instance into the context of its definition, for
     * `Definition.useFormContext()`. One component per instance, created on the first read.
     */
    readonly Provide: React.FC<{ children?: React.ReactNode }>;
}

/**
 * What `unstable_formsReactPlugin()` adds to every definition. `this` is the definition, so the
 * instance type is the definition's own.
 */
export interface FormReactMembers {
    /** Phantom: the instances of the definition get `Provide`. */
    readonly __instance: FormReactInstanceMembers;
    /**
     * Creates the instance once per component and syncs `init` into it on every render:
     * `context` at once, `state` once no submit runs (`state: undefined` is ignored). The
     * definition and `init.key` are read once.
     */
    readonly useForm: (...args: UseFormArgs<this>) => this["__instance"];
    /** The instance of the nearest `<form.Provide>` of this definition; throws outside one. */
    readonly useFormContext: () => this["__instance"];
}

/** The plugin HKT: `defineForm` as in `unstable_formsPlugin()`, with the React members. */
export interface FormsReactPluginHKT<TPluginError = unknown> extends IPluginHKT {
    readonly apiType: FormsApiOf<this["_TError"], TPluginError, FormReactMembers>;
}
