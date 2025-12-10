export type LazySignalFn <T> = {
    (): T,
    set(value: T): void
    peek(): T

    /** @deprecated */
    next(v: T): void
    /** @deprecated */
    value: T
    /** @deprecated */
    get(): T
};


export type LazyComputedFn <T> = {
    (): T,
    peek(): T

    /** @deprecated */
    get(): T
    /** @deprecated */
    value: T
};
