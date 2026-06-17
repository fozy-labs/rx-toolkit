import { Observable, Subscriber, TeardownLogic } from "rxjs";

const empty = Symbol("EMPTY");

/**
 * Внутренний маркер отсутствия значения по умолчанию. Наличие default определяется
 * по длине rest-аргумента, поэтому валидный `undefined` в роли default отличается
 * от «default не передан» (когда синхронное чтение без эмиссии бросает).
 */
const NO_DEFAULT: unique symbol = Symbol("rx-toolkit/no-default");

export class SyncObservable<T> extends Observable<T> {
    private readonly _defaultValue: T | typeof NO_DEFAULT;

    constructor(subscribe?: (subscriber: Subscriber<T>) => TeardownLogic, ...defaultValue: [defaultValue?: T]) {
        super(subscribe);
        this._defaultValue = defaultValue.length > 0 ? (defaultValue[0] as T) : NO_DEFAULT;
    }

    get value(): T {
        let value: T | symbol = empty;

        const sub = this.subscribe((v) => {
            value = v;
        });

        sub.unsubscribe();

        if (value === empty) {
            if (this._defaultValue !== NO_DEFAULT) {
                return this._defaultValue;
            }

            throw new Error("No value emitted");
        }

        return value as T;
    }
}
