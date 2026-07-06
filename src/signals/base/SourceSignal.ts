import { Subscriber, TeardownLogic } from "rxjs";

import { type ReadonlySignal } from "@/signals/types";

import { DependencyRecord, DependencyTracker } from "./DependencyTracker";
import { SyncObservable } from "./SyncObservable";

export class SourceSignal<T> {
    protected rang = 0;
    readonly obs;
    // Стабильный record на инстанс (см. State): переиспользуется на каждом get()
    // вместо аллокации нового объекта с замыканиями.
    private readonly _depRecord: DependencyRecord;

    constructor(subscribe?: (subscriber: Subscriber<T>) => TeardownLogic, ...defaultValue: [defaultValue?: T]) {
        this.obs = new SyncObservable<T>(subscribe, ...defaultValue);
        this._depRecord = {
            getRang: () => this.rang,
            obs: this.obs,
            peek: () => this.peek(),
        };
    }

    get(): T {
        if (DependencyTracker.isTracking) {
            DependencyTracker.track(this._depRecord);
        }
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
