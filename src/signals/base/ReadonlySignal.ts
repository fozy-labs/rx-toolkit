import { Observable, Subscriber, TeardownLogic } from "rxjs";
import { SyncObservable } from "./SyncObservable";
import { DependencyTracker } from "./DependencyTracker";

export class ReadonlySignal<T> extends SyncObservable<T> {
    protected rang = 0;
    readonly obsv$;

    constructor(subscribe?: (this: Observable<T>, subscriber: Subscriber<T>) => TeardownLogic) {
        super(subscribe);
        this.obsv$ = this;
    }

    get(): T {
        DependencyTracker.track({
            getRang: () => this.rang,
            obsv$: this,
        });
        return super.value;
    }

    peek(): T {
        return super.value;
    }
}
