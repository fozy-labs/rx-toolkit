import { Signal, Computed } from '@fozy-labs/rx-toolkit';
import { createBenchmark } from '@/utils/benchmark';

export async function runSignalBench() {
  // 1. Создание и базовые операции
  await createBenchmark('Signals: Создание')
    .add('rx-toolkit Signal - создание', () => {
      const signal = new Signal(0);
      signal.unsubscribe();
    })
    .add('rx-toolkit Signal - создание с devtools', () => {
      const signal = new Signal(0, 'counter');
      signal.unsubscribe();
    })
    .run();

  // 2. Чтение значений
  await createBenchmark('Signals: Чтение значений')
    .add('rx-toolkit Signal - get value', () => {
      const signal = new Signal(42);
      const value = signal.value;
      signal.unsubscribe();
    })
    .add('rx-toolkit Signal - peek', () => {
      const signal = new Signal(42);
      const value = signal.peek();
      signal.unsubscribe();
    })
    .run();

  // 3. Запись значений
  await createBenchmark('Signals: Запись значений')
    .add('rx-toolkit Signal - set value', () => {
      const signal = new Signal(0);
      signal.value = 1;
      signal.unsubscribe();
    })
    .add('rx-toolkit Signal - next', () => {
      const signal = new Signal(0);
      signal.next(1);
      signal.unsubscribe();
    })
    .run();

  // 4. Computed signals
  await createBenchmark('Signals: Computed')
    .add('rx-toolkit Computed - создание', () => {
      const a = new Signal(1);
      const b = new Signal(2);
      const sum = new Computed(() => a.value + b.value);
      sum.unsubscribe();
      a.unsubscribe();
      b.unsubscribe();
    })
    .add('rx-toolkit Computed - чтение', () => {
      const a = new Signal(1);
      const b = new Signal(2);
      const sum = new Computed(() => a.value + b.value);
      const value = sum.value;
      sum.unsubscribe();
      a.unsubscribe();
      b.unsubscribe();
    })
    .add('rx-toolkit Computed - обновление зависимости', () => {
      const a = new Signal(1);
      const b = new Signal(2);
      const sum = new Computed(() => a.value + b.value);
      a.value = 10;
      const value = sum.value;
      sum.unsubscribe();
      a.unsubscribe();
      b.unsubscribe();
    })
    .run();

  // 5. Цепочка computed
  await createBenchmark('Signals: Цепочка Computed (5 уровней)')
    .add('rx-toolkit - создание цепочки', () => {
      const s = new Signal(1);
      const c1 = new Computed(() => s.value * 2);
      const c2 = new Computed(() => c1.value * 2);
      const c3 = new Computed(() => c2.value * 2);
      const c4 = new Computed(() => c3.value * 2);
      const c5 = new Computed(() => c4.value * 2);

      c5.unsubscribe();
      c4.unsubscribe();
      c3.unsubscribe();
      c2.unsubscribe();
      c1.unsubscribe();
      s.unsubscribe();
    })
    .add('rx-toolkit - обновление через цепочку', () => {
      const s = new Signal(1);
      const c1 = new Computed(() => s.value * 2);
      const c2 = new Computed(() => c1.value * 2);
      const c3 = new Computed(() => c2.value * 2);
      const c4 = new Computed(() => c3.value * 2);
      const c5 = new Computed(() => c4.value * 2);

      s.value = 2;
      const result = c5.value;

      c5.unsubscribe();
      c4.unsubscribe();
      c3.unsubscribe();
      c2.unsubscribe();
      c1.unsubscribe();
      s.unsubscribe();
    })
    .run();

  // 6. Множественные подписки с одним обновлением
  await createBenchmark('Signals: Множественные подписки (1 обновление)')
    .add('rx-toolkit Signal - 10 подписчиков', () => {
      const signal = new Signal(0);
      let callCount = 0;
      const subs = Array.from({ length: 10 }, () =>
        signal.subscribe(() => { callCount++; })
      );
      signal.value = 1;
      subs.forEach(sub => sub.unsubscribe());
      signal.unsubscribe();
    })
    .add('rx-toolkit Signal - 100 подписчиков', () => {
      const signal = new Signal(0);
      let callCount = 0;
      const subs = Array.from({ length: 100 }, () =>
        signal.subscribe(() => { callCount++; })
      );
      signal.value = 1;
      subs.forEach(sub => sub.unsubscribe());
      signal.unsubscribe();
    })
    .run();

  // 7. Множественные обновления с подписчиками
  await createBenchmark('Signals: Подписки (100 обновлений)')
    .add('rx-toolkit Signal - 10 подписчиков', () => {
      const signal = new Signal(0);
      let callCount = 0;
      const subs = Array.from({ length: 10 }, () =>
        signal.subscribe(() => { callCount++; })
      );

      for (let i = 0; i < 100; i++) {
        signal.value = i;
      }

      subs.forEach(sub => sub.unsubscribe());
      signal.unsubscribe();
    })
    .add('rx-toolkit Signal - 100 подписчиков', () => {
      const signal = new Signal(0);
      let callCount = 0;
      const subs = Array.from({ length: 100 }, () =>
        signal.subscribe(() => { callCount++; })
      );

      for (let i = 0; i < 100; i++) {
        signal.value = i;
      }

      subs.forEach(sub => sub.unsubscribe());
      signal.unsubscribe();
    })
    .run();

  // 8. Сложный граф зависимостей (Diamond Problem)
  await createBenchmark('Signals: Diamond граф (100 обновлений)')
    .add('rx-toolkit - без подписчиков', () => {
      const source = new Signal(1);
      const left = new Computed(() => source.value * 2);
      const right = new Computed(() => source.value * 3);
      const result = new Computed(() => left.value + right.value);

      for (let i = 0; i < 100; i++) {
        source.value = i;
        const value = result.value;
      }

      result.unsubscribe();
      right.unsubscribe();
      left.unsubscribe();
      source.unsubscribe();
    })
    .add('rx-toolkit - с подписчиком', () => {
      const source = new Signal(1);
      const left = new Computed(() => source.value * 2);
      const right = new Computed(() => source.value * 3);
      const result = new Computed(() => left.value + right.value);

      let updates = 0;
      const sub = result.subscribe(() => { updates++; });

      for (let i = 0; i < 100; i++) {
        source.value = i;
      }

      sub.unsubscribe();
      result.unsubscribe();
      right.unsubscribe();
      left.unsubscribe();
      source.unsubscribe();
    })
    .run();
}

