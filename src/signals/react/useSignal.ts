import React from "react";
import { config, Observable, Subscription } from "rxjs";

type SignalLike<T> = {
    obs: Observable<T>;
    peek: () => T;
};

/** The subscription of a mounted hook; `failed` — the stream ended with an error and may be renewed. */
type Listener = { failed: boolean; listen: () => void };

const bump = (n: number) => n + 1;

/** Reports an error nobody can handle the way RxJS does for a subscriber without an error callback. */
function reportUnhandledError(error: unknown) {
    if (config.onUnhandledError) {
        config.onUnhandledError(error);
        return;
    }
    setTimeout(() => {
        throw error;
    });
}

export function useSignal<T>(signal$: SignalLike<T>): T {
    const [, forceRender] = React.useReducer(bump, 0);
    const listenerRef = React.useRef<Listener | null>(null);

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
            let subscription: Subscription | null = null;

            const flush = () => {
                scheduled = false;
                if (unsubscribed) return;
                update();
                // An RxJS error ends the subscription: the signal entered its
                // error state. The forced render either throws the error into
                // the nearest ErrorBoundary or — the signal recovered
                // meanwhile, possibly to the committed value — commits, and
                // the effect below listens again.
                if (listener.failed) forceRender();
            };

            const notify = () => {
                if (scheduled) return;
                scheduled = true;
                queueMicrotask(flush);
            };

            // An error at subscribe time is no new notification. If the
            // snapshot throws too, the signal is failing and the forced render
            // takes the error to the ErrorBoundary; if it reads fine, the
            // stream is broken apart from the value — the error is reported
            // and the stream is not renewed, instead of a render/resubscribe
            // loop.
            const listener: Listener = {
                failed: false,
                listen: () => {
                    listener.failed = false;
                    let syncError: { error: unknown } | null = null;
                    let isSubscribing = true;
                    subscription = signal$.obs.subscribe({
                        next: notify,
                        error: (error: unknown) => {
                            if (isSubscribing) {
                                syncError = { error };
                                return;
                            }
                            listener.failed = true;
                            notify();
                        },
                    });
                    isSubscribing = false;
                    if (!syncError) return;
                    try {
                        signal$.peek();
                    } catch {
                        listener.failed = true;
                        notify();
                        return;
                    }
                    reportUnhandledError((syncError as { error: unknown }).error);
                },
            };

            listener.listen();
            listenerRef.current = listener;

            return () => {
                unsubscribed = true;
                if (listenerRef.current === listener) listenerRef.current = null;
                subscription?.unsubscribe();
            };
        },
        [signal$],
    );

    // getSnapshot must stay pure: any side effect here runs on speculative
    // renders too and can swallow the only notification React would get.
    const getSnapshot = React.useCallback(() => signal$.peek(), [signal$]);

    const value = React.useSyncExternalStore(subscribe, getSnapshot);

    // After every commit: a render that did not throw means the signal is
    // readable again, so a subscription that ended with an error is renewed
    // (an immediate error is handled in listen()).
    React.useEffect(() => {
        const listener = listenerRef.current;
        if (listener?.failed) listener.listen();
    });

    return value;
}
