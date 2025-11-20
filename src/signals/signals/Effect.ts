import { SubscriptionLike } from "rxjs";
import { Batcher, Tracker } from "../base";
import { SharedOptions } from "@/common/options/SharedOptions";

export class Effect implements SubscriptionLike {
    private _subscriptions: SubscriptionLike[] = [];
    protected readonly _scopeDestroyedSub = SharedOptions.getScopeDestroyed$?.()?.subscribe(() => {
        this.complete();
    });
    closed = false;
    _rang = 0;

    constructor(
        effectFn: (ctx: (fn: () => void) => void) => void,
        private _onComplete?: () => void,
    ) {
        this._runInTrackedContext(effectFn, false);
    }

    /**
     * Выполняет функцию в tracked-контексте, подписываясь на Tracker.
     */
    private _runInTrackedContext(
        effectFn: (ctx: (fn: () => void) => void) => void,
        isAsyncRun = false,
    ) {
        let prevSubscriptions;

        if (!isAsyncRun) {
            this._rang = 0;
            prevSubscriptions = this._subscriptions;
            this._subscriptions = [];
        }

        let isTrackedContext = true;
        // TODO подумать как организовать планировщик при асинхронном запуске
        let scheduler: ReturnType<typeof Batcher.scheduler> | undefined;

        const scheduledFn = () => {
            this._runInTrackedContext(effectFn);
        }

        // Подписываемся на Tracker. Во время выполнения подпишемся на все tracked наблюдатели.
        const trackerSub = Tracker.tracked$.subscribe({
            next: (tracked) => {
                if (!isTrackedContext) return;

                if (tracked.rang <= this._rang) {
                    this._rang = tracked.rang + 1;
                }

                this._subscriptions.push(tracked.obsv$.subscribe(() => {
                    if (isTrackedContext) {
                        return;
                    }

                    scheduler!.schedule(scheduledFn);
                }));
            },
            complete: () => {
                this.complete();
            },
            error: (err) => {
                console.error(err);
                this.complete();
            },
        });

        effectFn((fn) => {
            this._runInTrackedContext(fn, true);
        });

        trackerSub.unsubscribe();
        isTrackedContext = false;
        scheduler = Batcher.scheduler(this._rang);
        prevSubscriptions?.forEach((sub) => sub.unsubscribe());
    }

    complete() {
        if (this.closed) return;
        this.closed = true;
        this._subscriptions.forEach((sub) => sub.unsubscribe());
        this._scopeDestroyedSub?.unsubscribe();
        this._onComplete?.();
    }

    /**
     * @deprecated Use `complete()` method instead.
     */
    unsubscribe() {
        this.complete();
    }
}
