import React from "react";

import { Signal } from "@/signals/signals/Signal";
import type { ReadonlySignal } from "@/signals/types";

/**
 * The last value or error of a signal, as `getSnapshot` and the subscribe
 * effect agree on it. `getSnapshot` must return the same result while the
 * store is unchanged, and a fresh `peek()` cannot promise that: a cold
 * source builds a new object per read, and an async failure read after the
 * flush would retry the upstream instead of throwing it again. The
 * subscribe effect is the only writer after the first read, so the outcome
 * mirrors the committed state of the signal.
 */
type Outcome<T> = { value: T } | { error: unknown };

interface SnapshotCache<T> {
    /** The signal `outcome` belongs to; a new signal invalidates it. */
    source: ReadonlySignal<T> | null;
    outcome: Outcome<T> | null;
}

function outcomeEquals<T>(a: Outcome<T>, b: Outcome<T>): boolean {
    if ("value" in a) return "value" in b && Object.is(a.value, b.value);
    return "error" in b && Object.is(a.error, b.error);
}

function readSnapshot<T>(cache: SnapshotCache<T>, signal$: ReadonlySignal<T>): T {
    if (cache.outcome === null) {
        try {
            cache.outcome = { value: signal$.peek() };
        } catch (error) {
            cache.outcome = { error };
        }
    }
    if ("error" in cache.outcome) throw cache.outcome.error;
    return cache.outcome.value;
}

/**
 * {@link useSignal} for a store whose server-rendered value differs from its
 * client value: `serverSignal$` is read on the server and in the hydration
 * render, `signal$` everywhere else. React re-renders with `signal$` right
 * after hydration if the two differ. Internal: the query hooks use it.
 */
export function useSignalWithServerSnapshot<T>(signal$: ReadonlySignal<T>, serverSignal$: ReadonlySignal<T>): T {
    const cache = React.useRef<SnapshotCache<T>>({ source: null, outcome: null });
    if (cache.current.source !== signal$) {
        cache.current = { source: signal$, outcome: null };
    }
    // The server snapshot is read once per `serverSignal$` — nothing
    // subscribes to it, so there is no writer to keep it current.
    const serverCache = React.useRef<SnapshotCache<T>>({ source: null, outcome: null });
    if (serverCache.current.source !== serverSignal$) {
        serverCache.current = { source: serverSignal$, outcome: null };
    }

    // An engine effect, not `.obs`: an error does not end it, and it notifies
    // synchronously, inside the write — a controlled input keeps its caret.
    const subscribe = React.useCallback(
        (onChange: () => void) => {
            let first = true;
            const effect = Signal.effect(() => {
                let outcome: Outcome<T>;
                try {
                    outcome = { value: signal$() };
                } catch (error) {
                    // An error is a change too: getSnapshot rethrows it into the ErrorBoundary
                    outcome = { error };
                }
                const current = cache.current;
                const changed = current.outcome === null || !outcomeEquals(current.outcome, outcome);
                current.outcome = outcome;
                if (first) {
                    first = false;
                    // A change between the last render and this subscription
                    // would never be seen: close the tearing gap.
                    if (!changed) return;
                }
                onChange();
            });
            return () => effect.unsubscribe();
        },
        [signal$],
    );

    // Both must stay pure: React calls them on renders it may discard. The
    // read itself is pure; its outcome is kept for the calls that follow.
    const getSnapshot = React.useCallback((): T => readSnapshot(cache.current, signal$), [signal$]);
    const getServerSnapshot = React.useCallback(
        (): T => readSnapshot(serverSignal$ === signal$ ? cache.current : serverCache.current, serverSignal$),
        [signal$, serverSignal$],
    );

    return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
