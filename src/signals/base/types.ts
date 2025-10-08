import type { Observable } from "rxjs";

export interface ReadableSignalLike<T = unknown> extends Observable<T> {
    get value(): T;
    peek(): T;

    /**
     * @deprecated use `value` instead.
     */
    get(): T;
}

export interface SignalLike<T = unknown> extends ReadableSignalLike<T> {
    set value(value: T);
    next(value: T): void;

    asReadonly(): ReadableSignalLike<T>;

    /**
     * @deprecated use `value` instead.
     */
    set(value: T): void;
}

export interface UnaryFunction<T, R> {
    (source: T): R;
}

export type SignalOperatorFn<T, R> = UnaryFunction<ReadableSignalLike<T>, ReadableSignalLike<R>>;
export type MonoTypeSignalOperatorFn<T> = SignalOperatorFn<T, T>

