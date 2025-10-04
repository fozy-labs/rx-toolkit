import React from "react";
import { useEventHandler } from "react-hooks";
import { ReadableSignalLike } from "signals";

export function useSignal<T>(signal$: ReadableSignalLike<T>): T {
    const subscribe = React.useCallback((update: () => void) => {
        const subscription = signal$.subscribe(update)

        return () => {
            subscription.unsubscribe()
        }
    }, [signal$])

    const getSnapshot = useEventHandler(() => signal$.peek());

    return React.useSyncExternalStore(subscribe, getSnapshot)
}
