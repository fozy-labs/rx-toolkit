import { Observable, Subscriber, TeardownLogic } from "rxjs";

const empty = Symbol('EMPTY');

export class SyncObservable<T> extends Observable<T> {
    constructor(subscribe?: (subscriber: Subscriber<T>) => TeardownLogic) {
        super(subscribe);
    }

    get value(): T {
        let value: T | Symbol = empty;

        const sub = this.subscribe((v) => {
            value = v;
        });

        sub.unsubscribe();

        if (value === empty) {
            throw new Error('No value emitted');
        }

        return value as T;
    }
}
