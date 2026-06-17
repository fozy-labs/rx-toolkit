import { Observable } from "rxjs";

import { SourceSignal } from "../base";
import { type ReadonlySignal } from "../types";

export function signalize<T>(observable: Observable<T>): ReadonlySignal<T>;
export function signalize<T>(observable: Observable<T>, defaultValue: T): ReadonlySignal<T>;
export function signalize<T>(observable: Observable<T>, ...defaultValue: [defaultValue?: T]): ReadonlySignal<T> {
    return SourceSignal.create((destination) => observable.subscribe(destination), ...defaultValue);
}
