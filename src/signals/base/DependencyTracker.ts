import { Observable } from "rxjs";

export type DependencyRecord = {
    /**
     * Правило: getRang() должен вызываться только ПОСЛЕ подписки на obs,
     * чтобы гарантировать корректный порядок рангов при ленивой инициализации.
     */
    getRang(): number;
    /**
     * Change notifications for dependents. A signal's own error state (a
     * failed computeFn) must arrive as a value, not as an RxJS `error`:
     * dependents meet it when they read. An RxJS `error` is treated as a
     * change after which the stream is subscribed afresh.
     */
    obs: Observable<unknown>;
    peek: () => unknown;
    /**
     * Зарезервировано для отладки и логирования.
     */
    meta?: any;
};

export class DependencyTracker {
    private static _currentHandler: ((arg: DependencyRecord) => void) | null = null;

    /**
     * Активна ли сейчас подписка на зависимости.
     */
    static get isTracking(): boolean {
        return this._currentHandler !== null;
    }

    static track(dep: DependencyRecord) {
        this._currentHandler?.(dep);
    }

    static start(handler: (arg: DependencyRecord) => void) {
        const prevHandler = this._currentHandler;

        this._currentHandler = handler;

        return () => {
            this._currentHandler = prevHandler;
        };
    }
}
