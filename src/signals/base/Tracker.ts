import { type Observable, Subject } from "rxjs";

type TrackedValue = {
    rang: number,
    obsv$: Observable<unknown>,
}

export const Tracker = {
    tracked$: new Subject<TrackedValue>(),
    next(rang: number, observable: Observable<unknown>) {
        Tracker.tracked$.next({ rang, obsv$: observable, });
    }
}
