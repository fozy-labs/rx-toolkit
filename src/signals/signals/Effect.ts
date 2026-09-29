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
    // в Batcher до того, как эффект был отписан.
    private readonly _scheduledFn = () => {
        if (this.closed) return;
        this._runInTrackedContext();
    };

    // Reaction to a dependency change. The rang is read at emission time: a
    // subscription outlives the run that created it, so the rang must not be
    // captured.
    private readonly _onDependencyChange = () => {
        if (this._isRunning) return;
        Batcher.scheduler(this._rang).schedule(this._scheduledFn);
    };

    constructor(effectFn: EffectFn) {
        this._effectFn = effectFn;
        try {
            this._runInTrackedContext();
        } catch (error) {
            // The caller has no handle to unsubscribe yet, so an effect whose
            // first run throws is released right away.
            this.unsubscribe();
            throw error;
        }
    }

    /**
     * Выполняет функцию в tracked-контексте, подписываясь на Tracker.
     *
     * A throwing effectFn leaves the effect alive: it stays subscribed to the
     * dependencies read in this run before the throw and re-runs when they
     * change. The error goes to whoever triggered the run. So does the error
     * of a throwing teardown, after the run: the effect still re-runs.
     */
    private _runInTrackedContext() {
        let teardownError: { error: unknown } | null = null;
        try {
            this._callTeardown();
        } catch (error) {
            teardownError = { error };
        }

        // A closed effect ends every run with no subscriptions: the teardown
        // may have unsubscribed it (which released them) — the run stops here.
        if (this.closed) {
            if (teardownError) throw teardownError.error;
            return;
        }

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
                // An errored stream is closed: it can no longer notify, so a
                // fresh subscription replaces it.
                if (!legacySub.closed) {
                    this._subscriptions.set(obs, legacySub);
                    return;
                }
            }

            // An error the dependency hits while starting belongs to this read:
            // it is rethrown here, synchronously.
            let isSubscribing = true;
            let startError: { error: unknown } | null = null;
            const sub: SubscriptionLike = obs.subscribe({
                next: this._onDependencyChange,
                error: (error: unknown) => {
                    if (isSubscribing) {
                        startError = { error };
                        return;
                    }
                    // A dependency whose stream failed is a changed dependency:
                    // the dead subscription is dropped and the effect re-runs,
                    // meeting the failure when it reads the signal again.
                    if (this._subscriptions.get(obs) === sub) this._subscriptions.delete(obs);
                    this._onDependencyChange();
                },
            });

            isSubscribing = false;

            if (startError) throw (startError as { error: unknown }).error;

            this._subscriptions.set(obs, sub);
            return sub;
        };

        this._isRunning = true;
        const stopTracking = DependencyTracker.start((dependency) => {
            // Unsubscribed by its own body: later reads are no dependencies.
            if (this.closed) return;

            checkSubscription(dependency.obs);

            const dependencyRang = dependency.getRang();

            if (dependencyRang >= this._rang) {
                this._rang = dependencyRang + 1;
            }
        });

        let optionalTeardown: void | Teardown = undefined;

        try {
            optionalTeardown = this._effectFn();
        } catch (error) {
            // The teardown failed first: its error is the one to surface.
            if (!teardownError) throw error;
        } finally {
            // Восстановление глобального tracker обязано выполняться и при ошибке,
            // иначе все последующие чтения сигналов утекут в этот эффект.
            stopTracking();
            this._isRunning = false;

            // Subscriptions of the previous run that this run did not read
            // are no longer dependencies — also when the run threw.
            legacySubscriptions.forEach((sub) => {
                sub.unsubscribe();
            });

            if (this.closed) {
                this._subscriptions.forEach((sub) => sub.unsubscribe());
                this._subscriptions.clear();
            }
        }

        // Сохраняем teardown функцию, если она была возвращена
        if (typeof optionalTeardown === "function") {
            if (!this.closed) {
                this._teardown = optionalTeardown;
            } else {
                // The body unsubscribed its own effect: the teardown it
                // returned has no later run or unsubscribe() to wait for.
                try {
                    optionalTeardown();
                } catch (error) {
                    teardownError ??= { error };
                }
            }
        }

        if (teardownError) throw teardownError.error;
    }

    unsubscribe() {
        if (this.closed) return;
        this.closed = true;

        // Teardown before closing; a throwing teardown must not keep the
        // dependencies subscribed.
        try {
            this._callTeardown();
        } finally {
            this._subscriptions.forEach((sub) => sub.unsubscribe());
        }
    }

    _getRang() {
        return this._rang;
    }

    // Cleared before the call: a teardown runs at most once, even if it throws.
    private _callTeardown() {
        const teardown = this._teardown;
        if (!teardown) return;
        this._teardown = undefined;
        teardown();
    }

    static create(effectFn: EffectFn) {
        return new Effect(effectFn);
    }
}
