export interface SignalLifecycleHook<T = any> {
    onInit?: (value: T) => void;
    onChange?: (newValue: T, actionName?: string) => void;
    onDispose?: () => void;
}

export type TBeforeDevtoolsPushFn<T = any> = (
    newValue: T,
    push: (value: T, actionName?: string) => void,
    actionName?: string,
) => void;

export interface SignalOptions<T = any> {
    key?: string;
    base?: string;
    isDisabled?: boolean;
    beforeDevtoolsPush?: TBeforeDevtoolsPushFn<T>;
    hooks?: SignalLifecycleHook<T>[];
}

export type SignalOptionsOrKey<T = any> = SignalOptions<T> | string;

export interface SignalComputeOptions<T = any> extends SignalOptions<T> {
    /**
     * Whether a recomputed value counts as unchanged. When it does, the signal
     * keeps the previous reference — for subscribers, dependents and `peek()`,
     * with or without subscribers. Called outside dependency tracking; a throw
     * is logged and `Object.is` decides instead. Defaults to `Object.is`.
     */
    equals?: (previous: T, next: T) => boolean;
}
