import { SharedOptions } from "query/core/SharedOptions";
import { Observable, Subscriber, TeardownLogic } from "rxjs";
import { SyncObservable } from "./SyncObservable";
import { Tracker } from "./Tracker";
import type { ReadableSignalLike } from "./types";

export class ReadonlySignal<T> extends SyncObservable<T> implements ReadableSignalLike<T> {
    private readonly _devtools;
    private static _logIdIndex = 0;

    constructor(subscribe?: (this: Observable<T>, subscriber: Subscriber<T>) => TeardownLogic) {
        super(subscribe);

        const stateDevtools = SharedOptions.DEVTOOLS?.state;
        if (stateDevtools) {
            const id = ReadonlySignal._logIdIndex++;
            const key = `ReadonlySignal:i=${id}`;
            const initialValue = this.peek();
            this._devtools = stateDevtools(key, initialValue);
        }
    }

    get value(): T {
        Tracker.next_legacy(this);
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
