export interface SignalLifecycleHook<T = any> {
    onInit?: (value: T) => void;
    onChange?: (newValue: T) => void;
    onDispose?: () => void;
}

export interface SignalOptions<T = any> {
    key?: string;
    /** @deprecated use key */
    name?: string;
    base?: string;
    isDisabled?: boolean;
    beforeDevtoolsPush?: (newValue: T, push: (v: T) => void) => void;
    hooks?: SignalLifecycleHook<T>[];
}

export type SignalOptionsOrKey<T = any> = SignalOptions<T> | string;
