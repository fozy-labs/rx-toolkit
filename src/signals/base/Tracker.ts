import { type Observable, Subject } from "rxjs";

type TrackedValue = {
    rang: number,
    obsv$: Observable<unknown>,
}

export const Tracker = {
    /** @deprecated */
    tracked_legacy$: new Subject<Observable<unknown>>(),
    /** @deprecated */
    next_legacy(value: Observable<unknown>) {
        Tracker.tracked_legacy$.next(value);
    },
    tracked$: new Subject<TrackedValue>(),
    next(rang: number, observable: Observable<unknown>) {
        Tracker.tracked$.next({ rang, obsv$: observable, });
    }
}
