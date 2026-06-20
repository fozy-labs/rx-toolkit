import { Observable } from "rxjs";

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

export interface LocalStateSignal<T> extends ReadonlySignal<T> {
    set(value: T, actionName?: string): void;
    update(updater: (value: T) => T, actionName?: string): void;
    clear(): void;
}
