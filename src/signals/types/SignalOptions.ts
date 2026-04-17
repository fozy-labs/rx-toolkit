export interface SignalLifecycleHook<T = any> {
    onInit?: (value: T) => void;
    onChange?: (newValue: T) => void;
    onDispose?: () => void;
}

export type TBeforeDevtoolsPushFn<T = any> = (newValue: T, push: (v: T) => void) => void;

export interface SignalOptions<T = any> {
    key?: string;
    base?: string;
    isDisabled?: boolean;
    beforeDevtoolsPush?: TBeforeDevtoolsPushFn<T>;
    hooks?: SignalLifecycleHook<T>[];
}

export type SignalOptionsOrKey<T = any> = SignalOptions<T> | string;
