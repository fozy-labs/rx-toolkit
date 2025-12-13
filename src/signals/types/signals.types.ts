import { Observable } from "rxjs";

export interface ReadableSignalLike<T> {
    readonly obs: Observable<T>;
    peek(): T;
    get(): T;
}

export interface ReadableSignalFnLike<T> extends ReadableSignalLike<T> {
    (): T,
}

export interface WriteableSignalLike<T> {
    set(value: T): void;
}

export interface SignalFn<T> extends ReadableSignalFnLike<T>, WriteableSignalLike<T> {}
export interface ComputeFn<T> extends ReadableSignalFnLike<T> {}
