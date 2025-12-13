import { Observable } from "rxjs";

export interface ReadableSignalLike<T> {
    readonly obsv$: Observable<T>;
    peek(): T;
    get(): T;
}

export interface WriteableSignalLike<T> {
    set(value: T): void;
}

export interface SignalFn<T> extends ReadableSignalLike<T>, WriteableSignalLike<T> {
    (): T,
}


export interface ComputedFn<T> extends ReadableSignalLike<T> {
    (): T,
}
