import { Subscriber, TeardownLogic } from "rxjs";

import { type ReadonlySignal } from "@/signals/types";

import { DependencyTracker } from "./DependencyTracker";
import { SyncObservable } from "./SyncObservable";

export class SourceSignal<T> {
    protected rang = 0;
    readonly obs;

    constructor(subscribe?: (subscriber: Subscriber<T>) => TeardownLogic) {
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

    static create<T>(subscribe?: (subscriber: Subscriber<T>) => TeardownLogic): ReadonlySignal<T> {
        const signal = new SourceSignal<T>(subscribe);

        function readonlySignalFn(): T {
            return signal.get();
        }

        readonlySignalFn.obs = signal.obs;
        readonlySignalFn.peek = () => signal.peek();
        readonlySignalFn.get = () => signal.get();

        return readonlySignalFn;
    }
}
