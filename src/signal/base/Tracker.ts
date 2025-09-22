import { type Observable, Subject } from "rxjs";

export const Tracker = {
    tracked$: new Subject<Observable<unknown>>(),
    next(value: Observable<unknown>) {
        Tracker.tracked$.next(value);
    },
}
