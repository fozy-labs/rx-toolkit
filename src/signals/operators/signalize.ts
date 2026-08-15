import { Observable } from "rxjs";

import { SourceSignal } from "../base";
import { type ReadonlySignal } from "../types";

/**
 * @deprecated Use `Signal.from(observable)` instead. `signalize` re-subscribes
 * to the source on every read: sources without a synchronous (replayed)
 * emission are stuck at `defaultValue` forever, and stateful cold pipelines
 * restart on each read. `Signal.from` keeps the upstream subscription alive
 * (`keepAlive`) and serves hot reads from cache;
 * `Signal.from(obs, { keepAlive: "none" })` reproduces the legacy behavior.
 */
export function signalize<T>(observable: Observable<T>): ReadonlySignal<T>;
/**
 * @deprecated Use `Signal.from(observable, { default: defaultValue })` instead
 * (see the no-default overload for details).
 */
export function signalize<T>(observable: Observable<T>, defaultValue: T): ReadonlySignal<T>;
export function signalize<T>(observable: Observable<T>, ...defaultValue: [defaultValue?: T]): ReadonlySignal<T> {
    return SourceSignal.create((destination) => observable.subscribe(destination), ...defaultValue);
}
