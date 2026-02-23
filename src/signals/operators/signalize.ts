import { Observable } from "rxjs";
import { ReadableSignalFnLike } from "@/signals/types";
import { ReadonlySignal } from "../base";

export function signalize<T>(observable: Observable<T>): ReadableSignalFnLike<T> {
    return ReadonlySignal.create((destination) => {
        return observable.subscribe(destination);
    });
}
