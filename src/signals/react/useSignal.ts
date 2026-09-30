import React from "react";

import { Signal } from "@/signals/signals/Signal";
import type { ReadonlySignal } from "@/signals/types";

export function useSignal<T>(signal$: ReadonlySignal<T>): T {
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

    // getSnapshot must stay pure: React calls it on renders it may discard
    const getSnapshot = React.useCallback(() => signal$.peek(), [signal$]);

    // The server snapshot is the current value too: on the server it is what
    // gets rendered, on the client it matches the server once the state is
    // restored before hydration (a query cache from its snapshot).
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
