import { z, ZodType } from "zod/v4";
import { Observable } from "rxjs";
import { Computed } from "../base";
import { signalize } from "../operators";

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
}

const NullOrString = z.string().nullable();

const NONE = Symbol('NONE');

export class LocalSignal<T = string | null | number | undefined> extends Computed<T> {
    static KEY_PREFIX = '__LSValue__'
    static DRIVER = localStorage;

    private static _getStorageValue(options: Options<any>) {
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

    constructor(private _options: Options<T>) {
        const validator$ = _options.validator$;
        const checkEffect = _options.checkEffect;
        const defaultValue = _options.defaultValue;

        const validatorSignal$ = validator$ && signalize(validator$);

        super(() => {
            const value = LocalSignal._getStorageValue(_options);
            if (value === NONE) return defaultValue;

            if (validatorSignal$) {
                const validator = validatorSignal$.value;

                if (!validator(value)) {
                    return defaultValue;
                }
            }

            if (checkEffect) {
                return checkEffect(value) ? value : defaultValue;
            }

            return value;
        }, { devtoolsName: 'LocalSignal' } );
    }

    protected _onChange(value: T) {
        LocalSignal._setStorageValue(this._options, value);
        return super._onChange(value);
    }
}
