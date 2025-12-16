import React from "react";
import { Observable } from "rxjs";
import { useEventHandler } from "@/common/react";

type SignalLike<T> = {
    obs: Observable<T>;
    peek: () => T;
};

export function useSignal<T>(signal$: SignalLike<T>): T {
    const subscribe = React.useCallback((update: () => void) => {
        const subscription = signal$.obs.subscribe(() => {
            update();
        });

        return () => {
            subscription.unsubscribe();
        }
    }, [signal$]);

    const getSnapshot = useEventHandler(() => {
        return signal$.peek();
    });

    return React.useSyncExternalStore(subscribe, getSnapshot);
}
