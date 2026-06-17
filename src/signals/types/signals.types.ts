import { Observable } from "rxjs";

/**
 * @deprecated use ReadonlySignal<T> instead
 */
export interface ReadableSignalLike<T> {
    readonly obs: Observable<T>;
    peek(): T;
    get(): T;
}

/**
 * @deprecated
 */
export interface ReadableSignalFnLike<T> extends ReadableSignalLike<T> {
    (): T;
}

/**
 * @deprecated
 */
export interface WriteableSignalLike<T> {
    set(value: T, actionName?: string): void;
    update(updater: (value: T) => T, actionName?: string): void;
}

/**
 * @deprecated
 */
export interface ClearableSignalLike<_T> {
    clear(): void;
}

/**
 * @deprecated
 */
export interface StatefulSignalFn<T> extends ReadableSignalFnLike<T>, WriteableSignalLike<T>, ClearableSignalLike<T> {}

/**
 * @deprecated use StateSignal<T> instead
 */
export interface SignalFn<T> extends ReadableSignalFnLike<T>, WriteableSignalLike<T> {}

/**
 * @deprecated use DisposableSignal<T> instead
 */
export type ComputeFn<T> = ReadableSignalFnLike<T> & {
    /**
     * @deprecated use dispose instead
     */
    destroy(): void;
    dispose(): void;
};

// === NEW ===

export interface ReadonlySignal<T> {
    readonly obs: Observable<T>;
    peek(): T;
    get(): T;
    (): T;
}

export interface DisposableSignal<T> extends ReadonlySignal<T>, Disposable {
    dispose(): void;
}

export interface StateSignal<T> extends DisposableSignal<T> {
    set(value: T, actionName?: string): void;
    update(updater: (value: T) => T, actionName?: string): void;
}
