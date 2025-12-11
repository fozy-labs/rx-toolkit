import { Observable } from "rxjs";

export type LazySignalFn <T> = {
    (): T,
    set(value: T): void
    peek(): T
    get(): T
    obsv$: Observable<T>
    _setRang(rang: number): void;
};


export type LazyComputedFn <T> = {
    (): T,
    peek(): T
    obsv$: Observable<T>
    get(): T
};
