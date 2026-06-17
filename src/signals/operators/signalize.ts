import { Observable } from "rxjs";

import { SourceSignal } from "../base";
import { type ReadonlySignal } from "../types";

export function signalize<T>(observable: Observable<T>): ReadonlySignal<T> {
    return SourceSignal.create((destination) => {
        return observable.subscribe(destination);
    });
}
