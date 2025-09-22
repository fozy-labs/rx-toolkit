import { Observable, Subscriber, TeardownLogic } from "rxjs";
import { SyncObservable } from "./SyncObservable";
import { Tracker } from "./Tracker";
import type { ReadableSignalLike } from "./types";

export class ReadonlySignal<T> extends SyncObservable<T> implements ReadableSignalLike<T> {
    constructor(subscribe?: (this: Observable<T>, subscriber: Subscriber<T>) => TeardownLogic) {
        super(subscribe);
    }

    get value(): T {
        Tracker.next(this);
        return super.value;
    }

    peek(): T {
        return super.value;
    }

    /**
     * @deprecated
     */
    get(): T {
        return this.value;
    }
}
