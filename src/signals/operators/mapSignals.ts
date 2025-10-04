import { createOperatorSubscriber } from "rxjs/internal/operators/OperatorSubscriber";
import type { SignalOperatorFn } from "../base";
import { ReadonlySignal } from "../base";


export function mapSignals<T, R, A>(project: (this: A, value: T, index: number) => R): SignalOperatorFn<T, R>;
export function mapSignals<T, R, A>(project: (this: A, value: T, index: number) => R, thisArg: A): SignalOperatorFn<T, R>;
export function mapSignals<T, R>(project: (value: T, index: number) => R, thisArg?: any): SignalOperatorFn<T, R> {
    return (source) =>
        new ReadonlySignal((destination) => {
            let index = 0;

            source.subscribe(
                createOperatorSubscriber(
                    destination,
                    (value: T) => {
                        destination.next(project.call(thisArg, value, index++));
                    }
                )
            );
        });
}
