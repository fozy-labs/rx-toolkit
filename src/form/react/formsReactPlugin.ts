import React from "react";

import { unstable_FormsPlugin } from "../formsPlugin";
import type { FormsPluginOptions } from "../types";

import type { FormsReactPluginHKT } from "./types";
import { useForm } from "./useForm";

type ProvideComponent = React.FC<{ children?: React.ReactNode }>;

/** One React context per definition: `Provide` of its instances writes it, `useFormContext` reads it. */
const contexts = new WeakMap<object, React.Context<object | null>>();

function contextOf(definition: object): React.Context<object | null> {
    let context = contexts.get(definition);
    if (!context) {
        context = React.createContext<object | null>(null);
        contexts.set(definition, context);
    }
    return context;
}

function formLabel(definition: object): string {
    const name = (definition as { name?: string }).name;
    return name === undefined ? "the form" : `the form "${name}"`;
}

function createProvide(definition: object, instance: object): ProvideComponent {
    const Context = contextOf(definition);
    const Provide: ProvideComponent = ({ children }) =>
        React.createElement(Context.Provider, { value: instance }, children);
    Provide.displayName = `Provide(${(definition as { name?: string }).name ?? "form"})`;
    return Provide;
}

/**
 * The forms plugin with the React members: `api.defineForm(...)` as `unstable_FormsPlugin`
 * creates it, plus `useForm` and `useFormContext` on the definition and `Provide` on its
 * instances. It replaces `unstable_formsPlugin()`: the api rejects the two together.
 */
export class unstable_FormsReactPlugin<TError = unknown> extends unstable_FormsPlugin<TError> {
    override readonly name: string = "FormsReactPlugin";

    declare readonly _hkt: FormsReactPluginHKT<TError>;

    protected override definitionMembers(definition: object): Readonly<Record<string, unknown>> {
        return {
            useForm: (init?: object, options?: object) => useForm(definition, init, options),
            useFormContext: () => {
                const form = React.useContext(contextOf(definition));
                if (form === null) {
                    throw new Error(
                        `useFormContext() of ${formLabel(definition)} is called outside its <form.Provide>: ` +
                            "render the component inside the Provide of an instance of this definition.",
                    );
                }
                return form;
            },
        };
    }

    protected override instanceMembers(definition: object, instance: object): PropertyDescriptorMap {
        let Provide: ProvideComponent | undefined;
        return {
            Provide: { enumerable: true, get: () => (Provide ??= createProvide(definition, instance)) },
        };
    }
}

/** The forms plugin with React members: `createApi({ plugins: [unstable_formsReactPlugin({ mapSubmitError })] })`. */
export function unstable_formsReactPlugin<TError = unknown>(
    options?: FormsPluginOptions<TError>,
): unstable_FormsReactPlugin<TError> {
    return new unstable_FormsReactPlugin(options);
}
