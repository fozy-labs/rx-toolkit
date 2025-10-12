import { Observable, Subscriber, TeardownLogic } from "rxjs";
import type { ReadableSignalLike } from "./types";
import { SyncObservable } from "./SyncObservable";
import { Tracker } from "./Tracker";

export class ReadonlySignal<T> extends SyncObservable<T> implements ReadableSignalLike<T> {
    protected rang = 0;

    constructor(subscribe?: (this: Observable<T>, subscriber: Subscriber<T>) => TeardownLogic) {
        super(subscribe);
    }

    get value(): T {
        Tracker.next(this.rang, this);
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
