import { type TruthyTypesOf } from "rxjs";
import { createOperatorSubscriber } from "rxjs/internal/operators/OperatorSubscriber";
import type { MonoTypeSignalOperatorFn, SignalOperatorFn } from "../base";
import { ReadonlySignal } from "../base";

export function filterUpdates<T, S extends T>(predicate: (value: T, index: number) => value is S): SignalOperatorFn<T, S>;
export function filterUpdates<T>(predicate: BooleanConstructor): SignalOperatorFn<T, TruthyTypesOf<T>>;
export function filterUpdates<T>(predicate: (value: T, index: number) => boolean): MonoTypeSignalOperatorFn<T>;
export function filterUpdates<T>(predicate: (value: T, index: number) => boolean, thisArg?: any): MonoTypeSignalOperatorFn<T> {
    return (source) =>
        new ReadonlySignal((destination) => {
            let index = 0;
            let isFirst = true;

            source.subscribe(
                createOperatorSubscriber(
                    destination,
                    (value) => {
                        if (isFirst) {
                            isFirst = false;
                            destination.next(value);
                            return;
                        }

                        const result = predicate.call(thisArg, value, index++);
                        if (result) destination.next(value);
                    },
                )
            );
        });
}
