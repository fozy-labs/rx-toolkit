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
