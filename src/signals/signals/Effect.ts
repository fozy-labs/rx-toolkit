import { Observable, SubscriptionLike } from "rxjs";
import { Batcher, DependencyTracker } from "../base";

type Teardown = () => void
type EffectFn = () => void | Teardown

export class Effect implements SubscriptionLike {
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
        const legacySubscriptions = this._subscriptions;
        this._subscriptions = new Map();

        let scheduler: ReturnType<typeof Batcher.scheduler> | undefined;

        // Стабильная функция для планирования выполнения эффекта
        const scheduledFn = () => {
            this._runInTrackedContext(effectFn);
        }

        // Функция для проверки и создания подписки на зависимость
        const checkSubscription = (obsv$: Observable<unknown>) => {
            if (this._subscriptions.has(obsv$)) {
                return;
            }

            const legacySub = legacySubscriptions.get(obsv$);

            if (legacySub) {
                legacySubscriptions!.delete(obsv$);
                this._subscriptions.set(obsv$, legacySub);
                return;
            }

            const sub = obsv$.subscribe(() => {
                if (isTrackedContext) {
                    return;
                }

                scheduler!.schedule(scheduledFn);
            });

            this._subscriptions.set(obsv$, sub);
            return sub;
        };

        let isTrackedContext = true;
        const stopTracking = DependencyTracker.start((dependency) => {
            checkSubscription(dependency.obsv$);

            const dependencyRang = dependency.getRang();

            if (dependencyRang >= this._rang) {
                this._rang = dependencyRang + 1;
            }
        });

        const optionalTeardown = effectFn();

        stopTracking();
        isTrackedContext = false;

        // Сохраняем teardown функцию, если она была возвращена
        if (typeof optionalTeardown === 'function') {
            this._teardown = optionalTeardown;
        }

        scheduler = Batcher.scheduler(this._rang);
        legacySubscriptions?.forEach((sub) => {
            sub.unsubscribe();
        });
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

    static create(effectFn: EffectFn) {
        return new Effect(effectFn);
    }
}
