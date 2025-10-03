import React from 'react';
import { CounterSection } from '../components/CounterSection';
import { CodeBlock } from '../components/CodeBlock';

const signalsCode = `
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

    return (
        // ...
    );
}`;

export function SignalsPage() {
  return (
    <div className="example-page">
      <div className="example-header">
        <h1>📡 Реактивные сигналы</h1>
        <p>
          Демонстрация работы с Signal и Computed для создания реактивного состояния.
          Signal позволяет создавать изменяемые значения, а Computed автоматически
          пересчитывается при изменении зависимостей.
        </p>
      </div>

      <div className="example-content">
        <div>
          <CounterSection />
        </div>

        <div className="code-panel">
          <CodeBlock code={signalsCode} />
        </div>
      </div>
    </div>
  );
}
