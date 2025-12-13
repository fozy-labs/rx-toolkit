import { z, ZodType } from "zod/v4";
import { Observable } from "rxjs";
import { SignalFn } from "@/signals/types";
import { StateDevtoolsOptions } from "@/common/devtools";
import { signalize } from "../operators";
import { Signal } from "./Signal";
import { Computed } from "./Computed";


type Options<T> = {
    zodSchema?: ZodType<T>
    key: string;
    userId?: string;
    /**
     * @deprecated use checkEffect instead
     */
    validator$?: Observable<(value: T) => boolean>;
    checkEffect?: (value: T) => boolean;
    defaultValue: T;
    devtoolsOptions?: StateDevtoolsOptions;
}

const NullOrString = z.string().nullable();

const NONE = Symbol('NONE');

export class LocalSignal<T = string | null | number | undefined> {
    private _signal;
    private _computed;
    private readonly _options;

    constructor(options: Options<T>) {
        let initialValue = LocalSignal._getStorageValue(options);

        if (initialValue === NONE) {
            initialValue = options.defaultValue;
        }

        this._signal = new Signal<T>(initialValue, { isDisabled: true });

        const validatorSignal$ = options.validator$ && signalize(options.validator$);

        this._computed = new Computed<T>(() => {
            const value = this._signal.get();

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

        this._options = options;
    }

    set(value: T) {
        LocalSignal._setStorageValue(this._options, value);
        this._signal.set(value);
    }

    peek() {
        return this._computed.peek();
    }

    get() {
        return this._computed.get();
    }

    obsv$(): Observable<T> {
        return this._computed.obsv$;
    }

    // === static ===

    static KEY_PREFIX = '__LSValue__'
    static DRIVER = localStorage;

    static create<T = string | null | number | undefined>(options: Options<T>): SignalFn<T> {
        const localSignal = new LocalSignal<T>(options);

        function signalFn() {
            return localSignal.get();
        }

        signalFn.peek = () => localSignal.peek();
        signalFn.get = () => localSignal.get();
        signalFn.set = (value: T) => localSignal.set(value);
        signalFn.obsv$ = localSignal.obsv$;

        return signalFn as unknown as SignalFn<T>;
    }

    static _getStorageValue(options: Options<any>) {
        const storageKey = `${LocalSignal.KEY_PREFIX}:${options.key}`;
        const item = LocalSignal.DRIVER.getItem(storageKey);

        if (!item) return NONE;

        const schema = z.record(z.string(), options.zodSchema || NullOrString);
        const parsed = schema.safeParse(JSON.parse(item));

        if (!parsed.success) {
            console.warn(`Invalid value for key "${options.key}" in localStorage`, parsed.error);
            return NONE;
        }

        const subKey = options.userId ? `user:${options.userId}` : 'common';

        if (!(subKey in parsed.data)) {
            return NONE;
        }

        return parsed.data[subKey];
    }

    private static _setStorageValue<T>(options: Options<T>, value: T) {
        const storageKey = `${LocalSignal.KEY_PREFIX}:${options.key}`;
        const item = LocalSignal.DRIVER.getItem(storageKey) || '{}';

        const schema = z.record(z.string(), options.zodSchema || NullOrString);
        const parsed = schema.safeParse(JSON.parse(item));
        let data = parsed.data ?? {};

        if (!parsed.success) {
            data = {};
        }

        const subKey = options.userId ? `user:${options.userId}` : 'common';
        data[subKey] = value;

        LocalSignal.DRIVER.setItem(storageKey, JSON.stringify(data));
    }
}
