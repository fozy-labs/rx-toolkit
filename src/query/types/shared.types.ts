export type Prettify<T> = {[KeyType in keyof T]: T[KeyType]} & {};

export type FallbackOnNever<T, F> = [T] extends [never] ? F : T;
