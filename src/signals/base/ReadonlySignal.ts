import { Observable, Subscriber, TeardownLogic } from "rxjs";
import { ReadableSignalFnLike, ReadableSignalLike } from "@/signals/types";
import { SyncObservable } from "./SyncObservable";
import { DependencyTracker } from "./DependencyTracker";

export class ReadonlySignal<T> implements ReadableSignalLike<T> {
    protected rang = 0;
    readonly obs;

    constructor(subscribe?: (this: Observable<T>, subscriber: Subscriber<T>) => TeardownLogic) {
        this.obs = new SyncObservable<T>(subscribe);
    }

    get(): T {
        DependencyTracker.track({
            getRang: () => this.rang,
            obs: this.obs,
            peek: () => this.peek(),
        });
        return this.obs.value;
    }

    peek(): T {
        return this.obs.value;
    }

    static create<T>(subscribe?: (this: Observable<T>, subscriber: Subscriber<T>) => TeardownLogic): ReadableSignalFnLike<T> {
        const signal = new ReadonlySignal<T>(subscribe);

        function readonlySignalFn(): T {
            return signal.get();
        }

        readonlySignalFn.obs = signal.obs;
        readonlySignalFn.peek = () => signal.peek();
        readonlySignalFn.get = () => signal.get();

        return readonlySignalFn;
    }
}
