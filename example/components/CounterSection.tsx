import { Computed, Signal, useSignal } from '@fozy-labs/rx-toolkit';
import React from 'react';


class CounterStore {
    count$ = new Signal(0);
    doubled$ = new Computed(() => this.count$.value * 2);
    squared$ = new Computed(() => (this.doubled$.value / 2) ** 2);
    increment = () => this.count$.value++;
    decrement = () => this.count$.value--;
    reset = () => this.count$.value = 0;
}

const counterStore = new CounterStore();

export function CounterSection() {
    const count = useSignal(counterStore.count$);
    const doubled = useSignal(counterStore.doubled$);
    const squared = useSignal(counterStore.squared$);

    console.log('Render CounterSection');

    return (
        <div className="demo-section">
            <div className="counter-display">
                Счетчик: {count}
            </div>

            <div>
                <strong>Вычисляемые значения:</strong>
                <ul>
                    <li>Удвоенное: {doubled}</li>
                    <li>В квадрате: {squared}</li>
                </ul>
            </div>

            <div>
                <button onClick={counterStore.increment}>
                    Увеличить
                </button>
                <button onClick={counterStore.decrement}>
                    Уменьшить
                </button>
                <button onClick={counterStore.reset}>
                    Сбросить
                </button>
            </div>
        </div>
    );
}
