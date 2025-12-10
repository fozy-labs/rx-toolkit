import { LazySignal, LazyComputed } from '@fozy-labs/rx-toolkit';
import { createBenchmark } from '@/utils/benchmark';

export async function runLazySignalBench() {
  // 1. Создание и базовые операции
  await createBenchmark('LazySignals: Создание')
    .add('rx-toolkit LazySignal - создание', () => {
      const signal = new LazySignal(0);
    })
    .add('rx-toolkit LazySignal - создание с devtools', () => {
      const signal = new LazySignal(0, 'counter');
    })
    .run();

  // 2. Чтение значений
  await createBenchmark('LazySignals: Чтение значений')
    .add('rx-toolkit LazySignal - get', () => {
      const signal = new LazySignal(42);
      const value = signal.get();
    })
    .add('rx-toolkit LazySignal - peek', () => {
      const signal = new LazySignal(42);
      const value = signal.peek();
    })
    .run();

  // 3. Запись значений
  await createBenchmark('LazySignals: Запись значений')
    .add('rx-toolkit LazySignal - set', () => {
      const signal = new LazySignal(0);
      signal.set(1);
    })
    .run();

  // 4. LazyComputed signals
  await createBenchmark('LazySignals: LazyComputed')
    .add('rx-toolkit LazyComputed - создание', () => {
      const a = new LazySignal(1);
      const b = new LazySignal(2);
      const sum = new LazyComputed(() => a.get() + b.get());
    })
    .add('rx-toolkit LazyComputed - чтение', () => {
      const a = new LazySignal(1);
      const b = new LazySignal(2);
      const sum = new LazyComputed(() => a.get() + b.get());
      const value = sum.get();
    })
    .add('rx-toolkit LazyComputed - обновление зависимости', () => {
      const a = new LazySignal(1);
      const b = new LazySignal(2);
      const sum = new LazyComputed(() => a.get() + b.get());
      a.set(10);
      const value = sum.get();
    })
    .run();

  // 5. Цепочка computed
  await createBenchmark('LazySignals: Цепочка LazyComputed (5 уровней)')
    .add('rx-toolkit - создание цепочки', () => {
      const s = new LazySignal(1);
      const c1 = new LazyComputed(() => s.get() * 2);
      const c2 = new LazyComputed(() => c1.get() * 2);
      const c3 = new LazyComputed(() => c2.get() * 2);
      const c4 = new LazyComputed(() => c3.get() * 2);
      const c5 = new LazyComputed(() => c4.get() * 2);
    })
    .add('rx-toolkit - обновление через цепочку', () => {
      const s = new LazySignal(1);
      const c1 = new LazyComputed(() => s.get() * 2);
      const c2 = new LazyComputed(() => c1.get() * 2);
      const c3 = new LazyComputed(() => c2.get() * 2);
      const c4 = new LazyComputed(() => c3.get() * 2);
      const c5 = new LazyComputed(() => c4.get() * 2);

      s.set(2);
      const result = c5.get();
    })
    .run();

  // 6. Множественные подписки с одним обновлением
  await createBenchmark('LazySignals: Множественные подписки (1 обновление)')
    .add('rx-toolkit LazySignal - 10 подписчиков', () => {
      const signal = new LazySignal(0);
      let callCount = 0;
      const subs = Array.from({ length: 10 }, () =>
        signal.obsv$.subscribe(() => { callCount++; })
      );
      signal.set(1);
      subs.forEach(sub => sub.unsubscribe());
    })
    .add('rx-toolkit LazySignal - 100 подписчиков', () => {
      const signal = new LazySignal(0);
      let callCount = 0;
      const subs = Array.from({ length: 100 }, () =>
        signal.obsv$.subscribe(() => { callCount++; })
      );
      signal.set(1);
      subs.forEach(sub => sub.unsubscribe());
    })
    .run();

  // 7. Множественные обновления с подписчиками
  await createBenchmark('LazySignals: Подписки (100 обновлений)')
    .add('rx-toolkit LazySignal - 10 подписчиков', () => {
      const signal = new LazySignal(0);
      let callCount = 0;
      const subs = Array.from({ length: 10 }, () =>
        signal.obsv$.subscribe(() => { callCount++; })
      );

      for (let i = 0; i < 100; i++) {
        signal.set(i);
      }

      subs.forEach(sub => sub.unsubscribe());
    })
    .add('rx-toolkit LazySignal - 100 подписчиков', () => {
      const signal = new LazySignal(0);
      let callCount = 0;
      const subs = Array.from({ length: 100 }, () =>
        signal.obsv$.subscribe(() => { callCount++; })
      );

      for (let i = 0; i < 100; i++) {
        signal.set(i);
      }

      subs.forEach(sub => sub.unsubscribe());
    })
    .run();

  // 8. Сложный граф зависимостей (Diamond Problem)
  await createBenchmark('LazySignals: Diamond граф (100 обновлений)')
    .add('rx-toolkit - без подписчиков', () => {
      const source = new LazySignal(1);
      const left = new LazyComputed(() => source.get() * 2);
      const right = new LazyComputed(() => source.get() * 3);
      const result = new LazyComputed(() => left.get() + right.get());

      for (let i = 0; i < 100; i++) {
        source.set(i);
        const value = result.get();
      }
    })
    .add('rx-toolkit - с подписчиком', () => {
      const source = new LazySignal(1);
      const left = new LazyComputed(() => source.get() * 2);
      const right = new LazyComputed(() => source.get() * 3);
      const result = new LazyComputed(() => left.get() + right.get());

      let updates = 0;
      const sub = result.obsv$.subscribe(() => { updates++; });

      for (let i = 0; i < 100; i++) {
        source.set(i);
      }

      sub.unsubscribe();
    })
    .run();
}

