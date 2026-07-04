import { Observable, SubscriptionLike } from "rxjs";

import { Batcher, DependencyTracker } from "../base";

type Teardown = () => void;
type EffectFn = () => void | Teardown;

export class Effect implements SubscriptionLike {
    private _subscriptions = new Map<Observable<any>, SubscriptionLike>();
    private _teardown?: () => void;
    closed = false;
    private _rang = 0;
    private _isRunning = false;
    private readonly _effectFn: EffectFn;

    // Стабильная функция для планирования выполнения эффекта. Подписки
    // переиспользуются между запусками, поэтому всё, что их колбэки замыкают,
    // обязано жить на уровне инстанса, а не конкретного запуска: иначе ломается
    // дедупликация в Batcher (по identity функции) и устаревает ранг.
    // Проверка closed нужна, потому что перезапуск мог быть запланирован
    // в Batcher до того, как эффект был отписан или умер из-за ошибки.
    private readonly _scheduledFn = () => {
        if (this.closed) return;
        this._runInTrackedContext();
    };

    constructor(effectFn: EffectFn) {
        this._effectFn = effectFn;
        this._runInTrackedContext();
    }

    /**
     * Выполняет функцию в tracked-контексте, подписываясь на Tracker.
     */
    private _runInTrackedContext() {
        this._callTeardown();

        this._rang = 0;
        const legacySubscriptions = this._subscriptions;
        this._subscriptions = new Map();

        // Функция для проверки и создания подписки на зависимость
        const checkSubscription = (obs: Observable<unknown>) => {
            if (this._subscriptions.has(obs)) {
                return;
            }

            const legacySub = legacySubscriptions.get(obs);

            if (legacySub) {
                legacySubscriptions.delete(obs);
                this._subscriptions.set(obs, legacySub);
                return;
            }

            const sub = obs.subscribe(() => {
                if (this._isRunning) {
                    return;
                }

                // Ранг читается в момент эмиссии: подписка переживает запуск,
                // в котором была создана, поэтому замыкать ранг нельзя
                Batcher.scheduler(this._rang).schedule(this._scheduledFn);
            });

            this._subscriptions.set(obs, sub);
            return sub;
        };

        this._isRunning = true;
        const stopTracking = DependencyTracker.start((dependency) => {
            checkSubscription(dependency.obs);

            const dependencyRang = dependency.getRang();

            if (dependencyRang >= this._rang) {
                this._rang = dependencyRang + 1;
            }
        });

        let optionalTeardown: void | Teardown;

        try {
            optionalTeardown = this._effectFn();
        } catch (error) {
            // Эффект, чей effectFn бросил, считается мёртвым: отписываем всё,
            // что успели собрать в этом запуске, и остатки предыдущего.
            this._subscriptions.forEach((sub) => sub.unsubscribe());
            this._subscriptions.clear();
            legacySubscriptions.forEach((sub) => sub.unsubscribe());
            this.closed = true;
            throw error;
        } finally {
            // Восстановление глобального tracker обязано выполняться и при ошибке,
            // иначе все последующие чтения сигналов утекут в этот эффект.
            stopTracking();
            this._isRunning = false;
        }

        // Сохраняем teardown функцию, если она была возвращена
        if (typeof optionalTeardown === "function") {
            this._teardown = optionalTeardown;
        }

        legacySubscriptions.forEach((sub) => {
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
