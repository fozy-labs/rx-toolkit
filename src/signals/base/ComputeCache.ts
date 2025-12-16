import { DependencyTracker } from "@/signals";

/**
 * Кеш для хранения вычисленного значения и его зависимостей
 */
export class ComputeCache<T> {
    private static _NO_VALUE = Symbol('no-value');

    private _cachedValue: T | symbol = ComputeCache._NO_VALUE;
    private _dependencies: Array<{ peek: () => unknown; lastValue: unknown }> = [];

    /**
     * Проверяет, изменились ли зависимости с момента последнего вычисления
     */
    isValid(): boolean {
        if (this._cachedValue === ComputeCache._NO_VALUE) {
            return false;
        }

        // Проверяем, что все зависимости имеют те же значения
        return this._dependencies.every(dep => {
            try {
                const currentValue = dep.peek();
                return Object.is(currentValue, dep.lastValue);
            } catch {
                // Если не удалось получить значение, считаем кеш невалидным
                return false;
            }
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
        const dependencies: Array<{ peek: () => unknown; lastValue: unknown }> = [];

        const stopTracking = DependencyTracker.start((dep) => {
            // Создаем peek-функцию для этой зависимости

            dependencies.push({
                peek: dep.peek,
                lastValue: undefined, // Будет установлено после первого peek
            });
        });

        try {
            // Вычисляем значение
            const result = computeFn();

            // Получаем текущие значения зависимостей
            dependencies.forEach(dep => {
                dep.lastValue = dep.peek();
            });

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
