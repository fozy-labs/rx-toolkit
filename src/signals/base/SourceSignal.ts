import { Subscriber, TeardownLogic } from "rxjs";

import { type ReadonlySignal } from "@/signals/types";

import { DependencyTracker } from "./DependencyTracker";
import { SyncObservable } from "./SyncObservable";

export class SourceSignal<T> {
    protected rang = 0;
    readonly obs;

    constructor(subscribe?: (subscriber: Subscriber<T>) => TeardownLogic, ...defaultValue: [defaultValue?: T]) {
        this.obs = new SyncObservable<T>(subscribe, ...defaultValue);
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

    static create<T>(
        subscribe?: (subscriber: Subscriber<T>) => TeardownLogic,
        ...defaultValue: [defaultValue?: T]
    ): ReadonlySignal<T> {
        const signal = new SourceSignal<T>(subscribe, ...defaultValue);

        function readonlySignalFn(): T {
            return signal.get();
        }

        readonlySignalFn.obs = signal.obs;
        readonlySignalFn.peek = () => signal.peek();
        readonlySignalFn.get = () => signal.get();

        return readonlySignalFn;
    }
}
