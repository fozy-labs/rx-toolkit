import React from "react";
import { ReadableSignalLike } from "@/signals";
import { useEventHandler } from "@/common/react";

export function useSignal<T>(signal$: ReadableSignalLike<T>): T {
    const doUpdateRef = React.useRef(false);

    const subscribe = React.useCallback((update: () => void) => {
        const subscription = signal$.subscribe(() => {
            doUpdateRef.current = true;
            queueMicrotask(() => {
                if (!doUpdateRef.current) return;
                update();
            });
        });

        return () => {
            subscription.unsubscribe();
        }
    }, [signal$]);

    const getSnapshot = useEventHandler(() => {
        doUpdateRef.current = false;
        return signal$.peek();
    });

    return React.useSyncExternalStore(subscribe, getSnapshot);
}
