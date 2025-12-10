import { Observable, SubscriptionLike } from "rxjs";
import { Batcher, Tracker } from "../base";

type Teardown = () => void
type RunInContext = (fn: () => void) => void
type EffectFn = (ctx: RunInContext) => void | Teardown

export class Effect implements SubscriptionLike {
    private _subscriptions = new Map<Observable<any>, SubscriptionLike>();
    private _teardown?: () => void;
    closed = false;
    private _rang = 0;

    constructor(
        effectFn: () => void | Teardown,
    ) {
        this._runInTrackedContext(effectFn, false);
    }

    /**
     * Выполняет функцию в tracked-контексте, подписываясь на Tracker.
     */
    private _runInTrackedContext(
        effectFn: EffectFn,
        isAsyncRun = false,
    ) {
        let legacySubscriptions: Map<Observable<any>, SubscriptionLike> | undefined;

        if (!isAsyncRun) {
            // Вызываем teardown перед перезапуском эффекта
            this._teardown?.();
            this._teardown = undefined;

            this._rang = 0;
            legacySubscriptions = this._subscriptions;
            this._subscriptions = new Map();
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

                if (this._subscriptions.has(tracked.obsv$)) {
                    return;
                }

                const legacySub = legacySubscriptions?.get(tracked.obsv$);

                if (legacySub) {
                    legacySubscriptions!.delete(tracked.obsv$);
                    this._subscriptions.set(tracked.obsv$, legacySub);
                    return;
                }

                const obs$ = tracked.obsv$;
                const sub = obs$.subscribe(() => {
                    if (isTrackedContext) {
                        return;
                    }

                    scheduler!.schedule(scheduledFn);
                });

                this._subscriptions.set(obs$, sub);
            },
            error: (err) => {
                console.error(err);
            },
        });

        const teardown = effectFn((fn) => {
            this._runInTrackedContext(fn, true);
        });

        // Сохраняем teardown функцию, если она была возвращена
        if (typeof teardown === 'function') {
            this._teardown = teardown;
        }

        trackerSub.unsubscribe();
        isTrackedContext = false;
        scheduler = Batcher.scheduler(this._rang);
        legacySubscriptions?.forEach((sub) => sub.unsubscribe());
    }

    unsubscribe() {
        if (this.closed) return;
        this.closed = true;

        // Вызываем teardown перед завершением эффекта
        this._teardown?.();
        this._teardown = undefined;

        this._subscriptions.forEach((sub) => sub.unsubscribe());
    }

    _getRang() {
        return this._rang;
    }

    /**
     * @deprecated Use `unsubscribe()` method instead.
     */
    complete() {
        this.unsubscribe();
    }
}
