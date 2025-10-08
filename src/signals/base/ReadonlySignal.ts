import { Observable, Subscriber, TeardownLogic } from "rxjs";
import { SharedOptions } from "@/options/SharedOptions";
import type { ReadableSignalLike } from "./types";
import { SyncObservable } from "./SyncObservable";
import { Tracker } from "./Tracker";

export class ReadonlySignal<T> extends SyncObservable<T> implements ReadableSignalLike<T> {
    protected rang = 0;
    private readonly _devtools;
    private static _logIdIndex = 0;

    constructor(subscribe?: (this: Observable<T>, subscriber: Subscriber<T>) => TeardownLogic) {
        const stateDevtools = SharedOptions.DEVTOOLS?.state;

        const originalSubscribe = subscribe;

        if (stateDevtools && originalSubscribe) {
            subscribe = (subscriber) => {
                const wrappedSubscriber = new Subscriber<T>({
                    next: (value) => {
                        this._devtools?.(value);
                        subscriber.next(value);
                    },
                    error: (err: unknown) => subscriber.error(err),
                    complete: () => subscriber.complete()
                });

                return originalSubscribe.call(this, wrappedSubscriber);
            };
        }

        super(subscribe);

        if (stateDevtools) {
            const id = ReadonlySignal._logIdIndex++;
            const key = `ReadonlySignal:i=${id}`;
            const initialValue = this.peek();
            this._devtools = stateDevtools(key, initialValue);
        }
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
