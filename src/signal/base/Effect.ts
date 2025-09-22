import { SubscriptionLike } from "rxjs";
import { Batcher } from "signal/base/Batcher";
import { Tracker } from "./Tracker";

export class Effect implements SubscriptionLike {
    closed = false;

    private _subscriptions: SubscriptionLike[] = [];

    constructor(
        effectFn: (runInTrackedContext: (fn: () => void) => void) => void,
        private _doLog = false
    ) {
        if (this._doLog) console.log("Run EffectFn. Reason: init");
        this._runInTrackedContext(effectFn, false);
    }

    /**
     * Выполняет функцию в tracked-контексте, подписываясь на Tracker.
     */
    private _runInTrackedContext(effectFn: (runInTrackedContext: (fn: () => void) => void) => void, doUnsubscribe = true) {
        // Отписываемся от предыдущих подписок
        if (doUnsubscribe) {
            this._subscriptions.forEach((sub) => sub.unsubscribe());
            this._subscriptions = [];
        }

        let isTrackedContext = true;
        let isWaitingBatching = false;

        // Подписываемся на Tracker. Во время выполнения подпишемся на все tracked наблюдатели.
        const trackerSub = Tracker.tracked$.subscribe((tracked$) => {
            if (!isTrackedContext) return;

            this._subscriptions.push(tracked$.subscribe(() => {
                if (isTrackedContext) {
                    return;
                }
                if (isWaitingBatching) {
                    if (this._doLog) console.log("Effect: still waiting for batching to finish", { tracked$ });
                    return;
                }

                if (Batcher.isLocked$.value) {
                    // console.log("Effect: waiting for batching to finish");
                    isWaitingBatching = true;
                    const sub = Batcher.isLocked$
                        .subscribe((isLocked) => {
                            if (isLocked) return;
                            sub.unsubscribe();
                            isWaitingBatching = false;
                            if (this._doLog) console.log("Run EffectFn. Reason: tracked observable change after batching", { tracked$ });
                            this._runInTrackedContext(effectFn);
                        });
                    return;
                }

                if (this._doLog) console.log("Run EffectFn. Reason: tracked observable change", { tracked$ });
                this._runInTrackedContext(effectFn);
            }));
        });

        effectFn((fn) => {
            if (this._doLog) console.log("Run EffectFn. Reason: manual trigger sub context");
            this._runInTrackedContext(fn, false);
        });

        trackerSub.unsubscribe();
        isTrackedContext = false;
    }

    public unsubscribe() {
        this.closed = true;
        this._subscriptions.forEach((sub) => sub.unsubscribe());
    }
}
