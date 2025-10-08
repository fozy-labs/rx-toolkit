import React from "react";
import { ReadableSignalLike } from "@/signals";
import { useEventHandler } from "./useEventHandler";

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
