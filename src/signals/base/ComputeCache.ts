import { DependencyTracker } from "./DependencyTracker";
import { SignalCycleError } from "./SignalCycleError";

/**
 * A dependency as last seen by the computation: its value, or the error its
 * read threw (a failing dependency the computeFn caught).
 */
type CachedDependency = { peek: () => unknown; lastValue: unknown; failed: boolean };

/**
 * Кеш для хранения вычисленного значения и его зависимостей
 */
export class ComputeCache<T> {
    private static _NO_VALUE = Symbol("no-value");

    private _cachedValue: T | symbol = ComputeCache._NO_VALUE;
    private _dependencies: CachedDependency[] = [];

    /**
     * Проверяет, изменились ли зависимости с момента последнего вычисления
     */
    isValid(): boolean {
        if (this._cachedValue === ComputeCache._NO_VALUE) {
            return false;
        }

        // Проверяем, что все зависимости имеют те же значения
        return this._dependencies.every((dep) => {
            let currentValue: unknown;
            try {
                currentValue = dep.peek();
            } catch (error) {
                // Still failing with the same error: the computation already saw it.
                if (dep.failed) return Object.is(error, dep.lastValue);
                // A cycle is not a stale cache: a recompute would only hit it again.
                if (error instanceof SignalCycleError) throw error;
                return false;
            }
            return !dep.failed && Object.is(currentValue, dep.lastValue);
        });
    }

    /**
     * Получает кешированное значение или вычисляет новое
     */
    getOrCompute(computeFn: () => T): T {
        if (this.isValid()) {
            return this._cachedValue as T;
        }

        // Собираем зависимости во время вычисления
        const dependencies: CachedDependency[] = [];

        const stopTracking = DependencyTracker.start((dep) => {
            // Создаем peek-функцию для этой зависимости

            dependencies.push({
                peek: dep.peek,
                lastValue: undefined, // Будет установлено после первого peek
                failed: false,
            });
        });

        try {
            // Вычисляем значение
            const result = computeFn();

            // Получаем текущие значения зависимостей
            // A dependency that throws here failed inside computeFn, which
            // caught it (it returned): the error is recorded, not rethrown.
            for (const dep of dependencies) {
                try {
                    dep.lastValue = dep.peek();
                } catch (error) {
                    dep.lastValue = error;
                    dep.failed = true;
                }
            }

            // Сохраняем результат и зависимости
            this._cachedValue = result;
            this._dependencies = dependencies;

            return result;
        } finally {
            stopTracking();
        }
    }

    clear() {
        this._cachedValue = ComputeCache._NO_VALUE;
        this._dependencies = [];
    }
}
