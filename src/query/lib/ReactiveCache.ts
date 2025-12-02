import { BehaviorSubject, finalize, Observable, ReplaySubject, share, Subject, takeUntil, timer } from "rxjs";
import { ReadableSignalLike, signalize } from "@/signals";

type Options<VALUE> = {
    /**
     * Начальное состояние кэша
     */
    initialState: VALUE;
    /**
     * Время жизни кэша в миллисекундах (пока нет подписок на кеш)
     * Если указано `false`, кэш не будет очищаться автоматически.
     * Если указано `0` или меньше, кэш будет очищаться сразу после отписки от него.
     * @default 60_000 (1 минута)
     */
    cacheLifeTime?: number | false;
}

/**
 * Класс `ReactiveCache` представляет собой реактивный кэш,
 * который позволяет управлять состоянием и временем жизни кэшированных данных.
 *
 * @template VALUE Тип значения, хранимого в кэше.
 */
export class ReactiveCache<VALUE> {
    /**
     * Внутренний `BehaviorSubject`, хранящий текущее состояние кэша.
     * @private
     */
    private _state$: BehaviorSubject<VALUE>;

    /**
     * Реактивное значене (Observable)
     */
    public value$: ReadableSignalLike<VALUE>;

    /**
     * Значение без сайд-эффектов (для использования в DevTools)
     */
    public spy$: Observable<VALUE>;

    /**
     * Subject, уведомляющий об очистке кэша.
     */
    public onClean$ = new Subject<VALUE>();

    public closed = false;

    /**
     * Создает новый экземпляр `ReactiveCacheItem`.
     *
     * @param options Параметры для настройки элемента кэша.
     * @param options.initialState Начальное состояние кэша.
     * @param options.cacheLifeTime Время жизни кэша в миллисекундах (по умолчанию 60_000).
     */
    constructor(options: Options<VALUE>) {
        const cacheLifeTime = options.cacheLifeTime ?? 60_000;
        this._state$ = new BehaviorSubject(options.initialState);

        this.spy$ = this._state$.pipe(
            takeUntil(this.onClean$)
        );

        this.value$ = signalize(this._state$.pipe(
            finalize(() => {
                this.complete();
            }),
            share({
                connector: () => new ReplaySubject(1),
                resetOnRefCountZero: this._getOnRefCountZero(cacheLifeTime),
                resetOnComplete: true,
            }),
        ));
    }

    private _getOnRefCountZero(cacheLifeTime: number | false) {
        if (cacheLifeTime === false) {
            return false;
        }

        if (cacheLifeTime <= 0) {
            return true;
        }

        return () => {
            return timer(cacheLifeTime);
        };
    }

    get value(): VALUE {
        return this._state$.value;
    }

    /**
     * Устанавливает новое значение в кэш и обновляет поток состояния.
     *
     * @param value Новое значение для кэша.
     */
    next(value: VALUE): void {
        this._state$.next(value);
    }

    /**
     * Завершает работу кэша, закрывая все потоки и уведомляя об очистке.
     */
    complete() {
        if (this.closed) return;
        this.closed = true;
        this._state$.complete();
        this.onClean$.next(this._state$.value);
        this.onClean$.complete();
    }
}
