import { Observable } from "rxjs";
import { ReadonlySignal } from "../base";

export function signalize<T>(observable: Observable<T>): ReadonlySignal<T> {
    return new ReadonlySignal((destination) => {
        return observable.subscribe(destination);
    });
}
