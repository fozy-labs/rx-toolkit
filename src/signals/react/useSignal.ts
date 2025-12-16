import React from "react";
import { Observable } from "rxjs";
import { useEventHandler } from "@/common/react";

type SignalLike<T> = {
    obs: Observable<T>;
    peek: () => T;
};

export function useSignal<T>(signal$: SignalLike<T>): T {
    const doUpdateRef = React.useRef(true);

    const subscribe = React.useCallback((update: () => void) => {
        const subscription = signal$.obs.subscribe(() => {
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
