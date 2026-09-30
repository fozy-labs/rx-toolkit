import React from "react";

import { Signal } from "@/signals/signals/Signal";
import type { ReadonlySignal } from "@/signals/types";

/**
 * {@link useSignal} for a store whose server-rendered value differs from its
 * client value: `serverSignal$` is read on the server and in the hydration
 * render, `signal$` everywhere else. React re-renders with `signal$` right
 * after hydration if the two differ. Internal: the query hooks use it.
 */
export function useSignalWithServerSnapshot<T>(signal$: ReadonlySignal<T>, serverSignal$: ReadonlySignal<T>): T {
    // An engine effect, not `.obs`: an error does not end it, and it notifies
    // synchronously, inside the write — a controlled input keeps its caret.
    const subscribe = React.useCallback(
        (onChange: () => void) => {
            let first = true;
            const effect = Signal.effect(() => {
                try {
                    signal$();
                } catch {
                    // An error is a change too: getSnapshot rethrows it into the ErrorBoundary
                }
                if (first) first = false;
                else onChange();
            });
            return () => effect.unsubscribe();
        },
        [signal$],
    );

    // Both must stay pure: React calls them on renders it may discard
    const getSnapshot = React.useCallback(() => signal$.peek(), [signal$]);
    const getServerSnapshot = React.useCallback(() => serverSignal$.peek(), [serverSignal$]);

    return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
