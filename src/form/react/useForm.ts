import React from "react";

import { useConstant } from "@/common/react/useConstant";
import { useIsomorphicLayoutEffect } from "@/common/react/useIsomorphicLayoutEffect";
import { deepEqual } from "@/common/utils/deepEqual";
import { useSignal } from "@/signals/react/useSignal";
import type { ReadonlySignal } from "@/signals/types";

import { createInstance } from "../core/createInstance";
import type { InitializeOptions } from "../types";

import type { UseFormOptions } from "./types";

/** The members of a root instance the hook drives. */
interface Root {
    readonly isSubmitting$: ReadonlySignal<boolean>;
    readonly initialize: (data: { state?: unknown; context?: unknown }, options?: InitializeOptions) => void;
}

interface Init {
    readonly state?: unknown;
    readonly context?: unknown;
    readonly key?: string;
}

/** The instance and what it was created from: the definition and the key are read once. */
interface Created {
    readonly form: Root;
    readonly definition: object;
    readonly key: string | undefined;
}

const KEEP_DIRTY_VALUES: InitializeOptions = Object.freeze({ keepDirtyValues: true });

/**
 * `Definition.useForm(init?, options?)`: one instance per component, `init` synced into it.
 *
 * The sync compares `init` with what was applied last, by `deepEqual`, so a repeated effect
 * (StrictMode, a re-show under `<Activity>`) applies nothing. `context` applies at once. `state`
 * applies only while no submit runs: a source resource with an optimistic link changes it twice
 * per submit (patch, then rollback), and a sync in flight would lose the server's field issues.
 * The hook re-renders on the submit phase, so a `state` that changed in flight is applied at idle
 * — unless it is back to what was applied at the start of the submit. Nothing is closed on
 * unmount: the instance holds no resources of its own.
 *
 * The instance is created once per mounted component, not in a `useState` initializer: StrictMode
 * calls that twice and keeps the first result, while the discarded second instance would take
 * over the devtools keys of the live one.
 */
export function useForm(definition: object, init: Init | undefined, options: UseFormOptions | undefined): object {
    const created = useConstant<Created>(() => ({
        form: createInstance(definition, init) as Root,
        definition,
        key: init?.key,
    }));
    const appliedRef = React.useRef<Init>(init ?? {});
    const warnedRef = React.useRef({ definition: false, key: false });
    const { form } = created;

    // Only for the re-render at idle; the effect reads the phase itself.
    useSignal(form.isSubmitting$);

    useIsomorphicLayoutEffect(() => {
        const warned = warnedRef.current;
        if (definition !== created.definition && !warned.definition) {
            warned.definition = true;
            console.warn(
                "[rx-toolkit] useForm(): the definition changed between renders; " +
                    "the hook keeps the instance of the first one. Remount the component (a React `key`) to switch forms.",
            );
        }
        if (init?.key !== created.key && !warned.key) {
            warned.key = true;
            console.warn(
                `[rx-toolkit] useForm(): init.key changed from ${String(created.key)} to ${String(init?.key)}; ` +
                    "the key is read once. Remount the component (a React `key`) for a new instance.",
            );
        }

        const applied = appliedRef.current;
        const next: { state?: unknown; context?: unknown } = {};
        if (init?.context !== undefined && !deepEqual(init.context, applied.context)) next.context = init.context;
        if (init?.state !== undefined && !deepEqual(init.state, applied.state) && !form.isSubmitting$.peek()) {
            next.state = init.state;
        }
        if (!("context" in next) && !("state" in next)) return;
        form.initialize(next, options?.initializeOptions ?? KEEP_DIRTY_VALUES);
        appliedRef.current = { ...applied, ...next };
    });

    return form;
}
