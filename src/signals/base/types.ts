import type { Observable } from "rxjs";

export interface ReadableSignalLike<T = unknown> extends Observable<T> {
    get value(): T;
    peek(): T;

    /**
     * @deprecated use `value` instead.
     */
    get(): T;
}


export interface UnaryFunction<T, R> {
    (source: T): R;
}

export type SignalOperatorFn<T, R> = UnaryFunction<ReadableSignalLike<T>, ReadableSignalLike<R>>;
export type MonoTypeSignalOperatorFn<T> = SignalOperatorFn<T, T>

