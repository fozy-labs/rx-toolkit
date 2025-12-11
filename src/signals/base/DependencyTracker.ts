import { Observable } from "rxjs";

type DependencyRecord = {
    rang: number;
    obsv$: Observable<unknown>;
}

export class DependencyTracker {
    private static _currentHandler: ((arg: DependencyRecord) => void) | null = null;

    static track(dep: DependencyRecord) {
        this._currentHandler?.(dep);
    }

    static start(handler: (arg: DependencyRecord) => void) {
        if (this._currentHandler !== null) {
            throw new Error("DependencyCollector is already started.");
        }

        this._currentHandler = handler;

        return () => {
            this._currentHandler = null;
        };
    }
}
