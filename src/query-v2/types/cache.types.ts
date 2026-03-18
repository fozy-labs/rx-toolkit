import type { TMachine } from './machine.types';
import type { TSerializeArgsFn, TCompareArgsFn } from './shared.types';

/** Single reactive cache unit holding a Machine */
export interface ICacheEntry<TData, TError = Error> {
    /** Reactive signal holding current machine state */
    readonly machine$: () => TMachine<TData, TError>;

    /** Synchronous peek at current machine */
    peek(): TMachine<TData, TError>;

    /** Update machine state */
    set(machine: TMachine<TData, TError>): void;

    /** Cleanup — complete and release */
    complete(): void;

    /** Observable for cache lifetime management */
    readonly onClean$: { subscribe(cb: () => void): { unsubscribe(): void } };
}

/** Dual-strategy cache abstraction */
export interface ICacheMap<TArgs, TData, TError = Error> {
    get(args: TArgs): ICacheEntry<TData, TError> | undefined;
    set(args: TArgs, entry: ICacheEntry<TData, TError>): void;
    delete(args: TArgs): boolean;
    has(args: TArgs): boolean;
    values(): Iterable<ICacheEntry<TData, TError>>;
    entries(): Iterable<[TArgs | string, ICacheEntry<TData, TError>]>;
    clear(): void;
    readonly size: number;
}

/** Factory options for creating appropriate cache map */
export interface ICacheMapOptions<TArgs> {
    keyStrategy: 'serialize' | 'compare';
    serializeArgs: TSerializeArgsFn;
    compareArg: TCompareArgsFn;
    doCacheArgs: boolean;
}
