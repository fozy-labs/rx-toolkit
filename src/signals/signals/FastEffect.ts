import { Observable, SubscriptionLike } from "rxjs";
import { Batcher, DependencyTracker } from "../base";

type Teardown = () => void
type EffectFn = () => void | Teardown

export class FastEffect implements SubscriptionLike {
    private _subscriptions = new Map<Observable<any>, SubscriptionLike>();
    private _teardown?: () => void;
    closed = false;
    private _rang = 0;

    constructor(
        effectFn: EffectFn,
    ) {
        this._runInTrackedContext(effectFn);
    }

    /**
     * Выполняет функцию в tracked-контексте, подписываясь на Tracker.
     */
    private _runInTrackedContext(effectFn: EffectFn) {
        this._callTeardown();

        this._rang = 0;
        let isTrackedContext = true;
        this._subscriptions = new Map();
        const legacySubscriptions = this._subscriptions;

        let scheduler: ReturnType<typeof Batcher.scheduler> | undefined;

        const scheduledFn = () => {
            this._runInTrackedContext(effectFn);
        }

        const stopTracking = DependencyTracker.start((dependency) => {
            if (dependency.rang <= this._rang) {
                this._rang = dependency.rang + 1;
            }

            if (this._subscriptions.has(dependency.obsv$)) {
                return;
            }

            const legacySub = legacySubscriptions?.get(dependency.obsv$);

            if (legacySub) {
                legacySubscriptions!.delete(dependency.obsv$);
                this._subscriptions.set(dependency.obsv$, legacySub);
                return;
            }

            const sub = dependency.obsv$.subscribe(() => {
                if (isTrackedContext) {
                    return;
                }

                scheduler!.schedule(scheduledFn);
            });

            this._subscriptions.set(dependency.obsv$, sub);
        });

        const effectReturn = effectFn();

        stopTracking();

        // Сохраняем teardown функцию, если она была возвращена
        if (typeof effectReturn === 'function') {
            this._teardown = effectReturn;
        }

        isTrackedContext = false;
        scheduler = Batcher.scheduler(this._rang);
        legacySubscriptions?.forEach((sub) => sub.unsubscribe());
    }

    unsubscribe() {
        if (this.closed) return;
        this.closed = true;

        // Вызываем teardown перед завершением эффекта
        this._callTeardown();

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

    private _callTeardown() {
        if (this._teardown) {
            this._teardown();
            this._teardown = undefined;
        }
    }
}
