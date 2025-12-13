import { Observable } from "rxjs";

export type DependencyRecord = {
    /**
     * Правило: getRang() должен вызываться только ПОСЛЕ подписки на obsv$,
     * чтобы гарантировать корректный порядок рангов при ленивой инициализации.
     */
    getRang(): number;
    obsv$: Observable<unknown>;
    /**
     * Зарезервировано для отладки и логирования.
     */
    meta?: any;
}

export class DependencyTracker {
    private static _currentHandler: ((arg: DependencyRecord) => void) | null = null;

    static track(dep: DependencyRecord) {
        this._currentHandler?.(dep);
    }

    static start(handler: (arg: DependencyRecord) => void) {
        let prevHandler = this._currentHandler;

        this._currentHandler = handler;

        return () => {
            this._currentHandler = prevHandler;
        };
    }
}
