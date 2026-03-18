import { Observable } from "rxjs";

const empty = Symbol("EMPTY");

export class SyncObservable<T> extends Observable<T> {
    get value(): T {
        let value: T | symbol = empty;

        const sub = this.subscribe((v) => {
            value = v;
        });

        sub.unsubscribe();

        if (value === empty) {
            throw new Error("No value emitted");
        }

        return value as T;
    }
}
