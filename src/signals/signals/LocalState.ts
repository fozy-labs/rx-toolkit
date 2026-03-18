import { Observable } from "rxjs";
import { z, ZodType } from "zod/v4";

import { State } from "@/signals/signals/State";
import { type SignalOptionsOrKey, type StatefulSignalFn } from "@/signals/types";

import { signalize } from "../operators";

import { Computed } from "./Computed";

type StorageLike = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
};

type Options<T> = {
    zodSchema?: ZodType<T>;
    key: string;
    userId?: string;
    /**
     * @deprecated use checkEffect instead
     */
    validator$?: Observable<(value: T) => boolean>;
    checkEffect?: (value: T) => boolean;
    driver?: StorageLike;
    defaultValue: T;
    devtoolsOptions?: SignalOptionsOrKey;
};

const NONE = Symbol("NONE");

export class LocalState<T = string | null | number | undefined> {
    private _state$;
    private _computed;
    private readonly _options;
    readonly obs;

    private get _driver() {
        return this._options.driver || LocalState.DEFAULT_DRIVER;
    }

    constructor(options: Options<T>) {
        this._options = options;

        let initialValue = this._getStorageValue(options);

        if (initialValue === NONE) {
            initialValue = options.defaultValue;
        }

        this._state$ = new State<T>(initialValue, { isDisabled: true });

        const validatorSignal$ = options.validator$ && signalize(options.validator$);

        this._computed = new Computed<T>(() => {
            const value = this._state$.get();

            if (validatorSignal$) {
                const validator = validatorSignal$.get();

                if (!validator(value)) {
                    return options.defaultValue;
                }
            }

            if (options.checkEffect) {
                return options.checkEffect(value) ? value : options.defaultValue;
            }

            return value;
        }, options.devtoolsOptions);

        this.obs = this._computed.obs;
    }

    set(value: T) {
        this._setStorageValue(this._options, value);
        this._state$.set(value);
    }

    peek() {
        return this._computed.peek();
    }

    get() {
        return this._computed.get();
    }

    clear() {
        this._deleteStorageValue(this._options);
        this._state$.set(this._options.defaultValue);
    }

    private _getStorageValue(options: Options<any>) {
        const storageKey = `${LocalState.KEY_PREFIX}:${options.key}`;
        const item = this._driver.getItem(storageKey);

        if (!item) return NONE;

        const schema = z.record(z.string(), options.zodSchema || z.any());
        const parsed = schema.safeParse(JSON.parse(item));

        if (!parsed.success) {
            console.warn(`Invalid value for key "${options.key}" in localStorage`, parsed.error);
            return NONE;
        }

        const subKey = options.userId ? `user:${options.userId}` : "common";

        if (!(subKey in parsed.data)) {
            return NONE;
        }

        return parsed.data[subKey];
    }

    private _setStorageValue<T>(options: Options<T>, value: T) {
        const storageKey = `${LocalState.KEY_PREFIX}:${options.key}`;
        const item = this._driver.getItem(storageKey) || "{}";

        const schema = z.record(z.string(), options.zodSchema || z.any());
        const parsed = schema.safeParse(JSON.parse(item));
        let data = parsed.data ?? {};

        if (!parsed.success) {
            data = {};
        }

        const subKey = options.userId ? `user:${options.userId}` : "common";
        data[subKey] = value;

        this._driver.setItem(storageKey, JSON.stringify(data));
    }

    private _deleteStorageValue(options: Options<any>) {
        const storageKey = `${LocalState.KEY_PREFIX}:${options.key}`;
        const item = this._driver.getItem(storageKey);

        if (!item) return;

        const schema = z.record(z.string(), options.zodSchema || z.any());
        const parsed = schema.safeParse(JSON.parse(item));
        const data = parsed.data ?? {};

        if (!parsed.success) {
            this._driver.removeItem(storageKey);
            return;
        }

        const subKey = options.userId ? `user:${options.userId}` : "common";

        if (!data[subKey]) return;

        delete data[subKey];

        if (Object.keys(data).length === 0) {
            this._driver.removeItem(storageKey);
            return;
        }

        this._driver.setItem(storageKey, JSON.stringify(data));
    }

    // === static ===

    static KEY_PREFIX = "__LSValue__";
    static DEFAULT_DRIVER = localStorage;

    static create<T = string | null | number | undefined>(options: Options<T>): StatefulSignalFn<T> {
        const localState = new LocalState<T>(options);

        function signalFn() {
            return localState.get();
        }

        signalFn.peek = () => localState.peek();
        signalFn.get = () => localState.get();
        signalFn.set = (value: T) => localState.set(value);
        signalFn.clear = () => localState.clear();
        signalFn.obs = localState.obs;

        return signalFn as unknown as StatefulSignalFn<T>;
    }
}

/**
 * @deprecated use LocalState instead
 */
export const LocalSignal = LocalState;
