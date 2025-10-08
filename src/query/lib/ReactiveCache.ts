import { finalize, Observable, ReplaySubject, share, Subject, takeUntil, timer } from "rxjs";
import { Signal } from "@/signals";

type Options<VALUE> = {
    /**
     * Начальное состояние кэша
     */
    initialState: VALUE;
    /**
     * Время жизни кэша в миллисекундах (пока нет подписок на кеш)
     * @default 60_000 (1 минута)
     */
    cacheLifeTime?: number;
}

/**
 * Класс `ReactiveCache` представляет собой реактивный кэш,
 * который позволяет управлять состоянием и временем жизни кэшированных данных.
 *
 * @template VALUE Тип значения, хранимого в кэше.
 */
export class ReactiveCache<VALUE> {
    /**
     * Время жизни кэша в миллисекундах.
     * Если значение больше 0, то кэш очищается через указанное время после отписки.
     * @private
     */
    private readonly _cacheLifeTime: number;

    /**
     * Внутренний `BehaviorSubject`, хранящий текущее состояние кэша.
     * @private
     */
    private _state$: Signal<VALUE>;

    /**
     * Текущее значение.
     * @private
     */
    private _value: VALUE;

    /**
     * Реактивное значене (Observable)
     */
    public value$: Observable<VALUE>;

    /**
     * Значение без сайд-эффектов (для использования в DevTools)
     */
    public spy$: Observable<VALUE>;

    /**
     * Subject, уведомляющий об очистке кэша.
     */
    public onClean$ = new Subject<VALUE>();

    /**
     * Создает новый экземпляр `ReactiveCacheItem`.
     *
     * @param options Параметры для настройки элемента кэша.
     * @param options.initialState Начальное состояние кэша.
     * @param options.cacheLifeTime Время жизни кэша в миллисекундах (по умолчанию 60_000).
     */
    constructor(options: Options<VALUE>) {
        this._cacheLifeTime = options.cacheLifeTime || 60_000;
        this._state$ = new Signal(options.initialState, { disableDevtools: true });
        this._value = options.initialState;

        this.spy$ = this._state$.pipe(
            takeUntil(this.onClean$)
        );

        this.value$ = this._state$.pipe(
            finalize(() => {
                this.complete();
            }),
            share({
                connector: () => new ReplaySubject(1),
                /**
                 * Если lifetime больше 0,
                 * то очистим кэш значения по истечении этого времени,
                 * иначе очищаем сразу после отписки.
                 */
                resetOnRefCountZero: this._cacheLifeTime > 0
                    ? () => timer(this._cacheLifeTime)
                    : true,
                resetOnComplete: true,
            }),
        );
    }

    /**
     * Возвращает текущее значение кэша.
     * @returns {VALUE} Текущее значение кэша.
     */
    get value(): VALUE {
        return this._state$.value;
    }

    /**
     * Возвращает текущее значение кэша.
     * @returns {VALUE} Текущее значение кэша.
     */
    peek(): VALUE {
        return this._value;
    }

    /**
     * Устанавливает новое значение в кэш и обновляет поток состояния.
     *
     * @param value Новое значение для кэша.
     */
    next(value: VALUE): void {
        this._value = value;
        this._state$.next(value);
    }

    /**
     * Завершает работу кэша, закрывая все потоки и уведомляя об очистке.
     */
    complete() {
        this._state$.complete();
        this.onClean$.next(this._value);
        this.onClean$.complete();
    }
}
