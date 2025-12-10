import React from "react";
import { Observable } from "rxjs";
import { useEventHandler } from "@/common/react";

type SignalLike<T> = {
    value: T,
    obsv$?: Observable<T>,
    peek?: () => T
}

export function useSignalValue<T>(signal$: SignalLike<T>): T {
    const subscribe = React.useCallback((update: () => void) => {
        const subscription = signal$.obsv$?.subscribe(() => {
            update();
        });

        return () => {
            subscription?.unsubscribe();
        }
    }, [signal$]);

    const getSnapshot = useEventHandler(() => {
        return signal$.peek ? signal$.peek() : signal$.value;
    });

    return React.useSyncExternalStore(subscribe, getSnapshot);
}
