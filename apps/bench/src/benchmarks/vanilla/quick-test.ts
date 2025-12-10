import '@/utils/node-setup';
import { Signal, Computed } from '@fozy-labs/rx-toolkit';
import { LazySignal, LazyComputed } from '@fozy-labs/rx-toolkit';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import { createBenchmark } from '@/utils/benchmark';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                   БЫСТРЫЙ ТЕСТ - КЛЮЧЕВЫЕ МЕТРИКИ                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // 1. Создание
  await createBenchmark('Создание примитивов', {
    runs: 5,
    iterations: 100,
    warmupIterations: 100,
  })
    .add('Signal', () => {
      const s = new Signal(0);
      s.unsubscribe();
    })
    .add('LazySignal', () => {
      const s = new LazySignal(0);
    })
    .add('Redux Store', () => {
      const slice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {},
      });
      const store = configureStore({ reducer: { counter: slice.reducer } });
    })
    .run();

  // 2. Чтение
  await createBenchmark('Чтение значений', {
    runs: 5,
    iterations: 100,
    warmupIterations: 100,
  })
    .add('Signal', () => {
      const s = new Signal(42);
      const v = s.value;
      s.unsubscribe();
    })
    .add('LazySignal', () => {
      const s = new LazySignal(42);
      const v = s.get();
    })
    .add('Redux Store', () => {
      const slice = createSlice({
        name: 'counter',
        initialState: { value: 42 },
        reducers: {},
      });
      const store = configureStore({ reducer: { counter: slice.reducer } });
      const v = store.getState().counter.value;
    })
    .run();

  // 3. Запись
  await createBenchmark('Запись значений', {
    runs: 5,
    iterations: 100,
    warmupIterations: 100,
  })
    .add('Signal', () => {
      const s = new Signal(0);
      s.value = 42;
      s.unsubscribe();
    })
    .add('LazySignal', () => {
      const s = new LazySignal(0);
      s.set(42);
    })
    .add('Redux Store', () => {
      const slice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          setValue: (state, action) => { state.value = action.payload; },
        },
      });
      const store = configureStore({ reducer: { counter: slice.reducer } });
      store.dispatch(slice.actions.setValue(42));
    })
    .run();

  // 4. Computed
  await createBenchmark('Computed/производные значения', {
    runs: 5,
    iterations: 50,
    warmupIterations: 100,
  })
    .add('Computed', () => {
      const s = new Signal(5);
      const c = new Computed(() => s.value * 2);
      const v = c.value;
      c.unsubscribe();
      s.unsubscribe();
    })
    .add('LazyComputed', () => {
      const s = new LazySignal(5);
      const c = new LazyComputed(() => s.get() * 2);
      const v = c.get();
    })
    .add('Redux селектор', () => {
      const slice = createSlice({
        name: 'counter',
        initialState: { value: 5 },
        reducers: {},
      });
      const store = configureStore({ reducer: { counter: slice.reducer } });
      const state = store.getState();
      const computed = state.counter.value * 2;
    })
    .run();

  // 5. Массовые обновления
  await createBenchmark('1000 обновлений подряд', {
    runs: 3,
    iterations: 10,
    warmupIterations: 50,
  })
    .add('Signal', () => {
      const s = new Signal(0);
      for (let i = 0; i < 1000; i++) {
        s.value = i;
      }
      s.unsubscribe();
    })
    .add('LazySignal', () => {
      const s = new LazySignal(0);
      for (let i = 0; i < 1000; i++) {
        s.set(i);
      }
    })
    .add('Redux Store', () => {
      const slice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          setValue: (state, action) => { state.value = action.payload; },
        },
      });
      const store = configureStore({ reducer: { counter: slice.reducer } });
      for (let i = 0; i < 1000; i++) {
        store.dispatch(slice.actions.setValue(i));
      }
    })
    .run();

  console.log('\n' + '═'.repeat(80));
  console.log('🔬 ЧИСТЫЕ ОПЕРАЦИИ (без overhead создания/cleanup)');
  console.log('═'.repeat(80) + '\n');

  // Создаем инстансы один раз
  const signal = new Signal(42);
  const lazySignal = new LazySignal(42);

  const counterSlice = createSlice({
    name: 'counter',
    initialState: { value: 42 },
    reducers: {
      setValue: (state, action) => { state.value = action.payload; },
    },
  });
  const store = configureStore({ reducer: { counter: counterSlice.reducer } });

  // 6. Чистое чтение (из готовых инстансов)
  await createBenchmark('Чистое чтение (operation-only)', {
    runs: 5,
    iterations: 100,
    warmupIterations: 100,
  })
    .add('Signal.value', () => {
      const v = signal.value;
    })
    .add('LazySignal.get()', () => {
      const v = lazySignal.get();
    })
    .add('Redux.getState()', () => {
      const v = store.getState().counter.value;
    })
    .run();

  // 7. Чистая запись (в готовые инстансы)
  await createBenchmark('Чистая запись (operation-only)', {
    runs: 5,
    iterations: 100,
    warmupIterations: 100,
  })
    .add('Signal.value =', () => {
      signal.value = Math.random();
    })
    .add('LazySignal.set()', () => {
      lazySignal.set(Math.random());
    })
    .add('Redux.dispatch()', () => {
      store.dispatch(counterSlice.actions.setValue(Math.random()));
    })
    .run();

  // Cleanup
  signal.unsubscribe();

  console.log('\n✅ Все тесты завершены!\n');
  console.log('💡 Примечание: "Чистые операции" показывают реальную производительность');
  console.log('   операций без overhead создания/уничтожения объектов.\n');
}

main().catch(console.error);

