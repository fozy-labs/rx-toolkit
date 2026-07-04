import React from "react";
import { Observable } from "rxjs";

type SignalLike<T> = {
    obs: Observable<T>;
    peek: () => T;
};

export function useSignal<T>(signal$: SignalLike<T>): T {
    const subscribe = React.useCallback(
        (update: () => void) => {
            // Coalesce a burst of synchronous emissions into one deferred
            // update. The deferred call must never be cancelled: React may
            // read the snapshot from renders it later discards, so only
            // useSyncExternalStore itself (which compares the snapshot
            // against the committed value) can decide that a notification
            // requires no re-render.
            let scheduled = false;
            let unsubscribed = false;

            const subscription = signal$.obs.subscribe(() => {
                if (scheduled) return;
                scheduled = true;
                queueMicrotask(() => {
                    scheduled = false;
                    if (unsubscribed) return;
                    update();
                });
            });

            return () => {
                unsubscribed = true;
                subscription.unsubscribe();
            };
        },
        [signal$],
    );

    // getSnapshot must stay pure: any side effect here runs on speculative
    // renders too and can swallow the only notification React would get.
    const getSnapshot = React.useCallback(() => signal$.peek(), [signal$]);

    return React.useSyncExternalStore(subscribe, getSnapshot);
}
