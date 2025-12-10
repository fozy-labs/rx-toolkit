import { Signal, Computed } from '@fozy-labs/rx-toolkit';
import { LazySignal, LazyComputed } from '@fozy-labs/rx-toolkit';
import { configureStore, createSlice } from '@reduxjs/toolkit';
import { createBenchmark } from '@/utils/benchmark';

export async function runStoreComparisonBench() {
  // 1. Создание и уничтожение примитивов
  await createBenchmark('Store Comparison: Создание примитива')
    .add('rx-toolkit Signal', () => {
      const counter = new Signal(0);
      counter.unsubscribe();
    })
    .add('rx-toolkit LazySignal', () => {
      const counter = new LazySignal(0);
      // LazySignal не требует явного unsubscribe
    })
    .add('Redux Toolkit Store', () => {
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          increment: (state) => { state.value += 1; },
        },
      });
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });
    })
    .run();

  // 2. Простое чтение значения
  await createBenchmark('Store Comparison: Чтение значения')
    .add('rx-toolkit Signal', () => {
      const counter = new Signal(42);
      const value = counter.value;
      counter.unsubscribe();
    })
    .add('rx-toolkit LazySignal', () => {
      const counter = new LazySignal(42);
      const value = counter.get();
    })
    .add('Redux Toolkit Store', () => {
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 42 },
        reducers: {},
      });
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });
      const value = store.getState().counter.value;
    })
    .run();

  // 3. Простая запись значения
  await createBenchmark('Store Comparison: Запись значения')
    .add('rx-toolkit Signal', () => {
      const counter = new Signal(0);
      counter.value = 42;
      counter.unsubscribe();
    })
    .add('rx-toolkit LazySignal', () => {
      const counter = new LazySignal(0);
      counter.set(42);
    })
    .add('Redux Toolkit Store', () => {
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          setValue: (state, action) => { state.value = action.payload; },
        },
      });
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });
      store.dispatch(counterSlice.actions.setValue(42));
    })
    .run();

  // 4. Множественные обновления (1000 операций)
  await createBenchmark('Store Comparison: 1000 обновлений подряд')
    .add('rx-toolkit Signal', () => {
      const counter = new Signal(0);
      for (let i = 0; i < 1000; i++) {
        counter.value = i;
      }
      counter.unsubscribe();
    })
    .add('rx-toolkit LazySignal', () => {
      const counter = new LazySignal(0);
      for (let i = 0; i < 1000; i++) {
        counter.set(i);
      }
    })
    .add('Redux Toolkit Store', () => {
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          setValue: (state, action) => { state.value = action.payload; },
        },
      });
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });
      for (let i = 0; i < 1000; i++) {
        store.dispatch(counterSlice.actions.setValue(i));
      }
    })
    .run();

  // 5. Подписки (10 подписчиков, 100 обновлений)
  await createBenchmark('Store Comparison: 10 подписчиков + 100 обновлений')
    .add('rx-toolkit Signal', () => {
      const counter = new Signal(0);
      let callCount = 0;
      const subs = Array.from({ length: 10 }, () =>
        counter.subscribe(() => { callCount++; })
      );

      for (let i = 0; i < 100; i++) {
        counter.value = i;
      }

      subs.forEach(sub => sub.unsubscribe());
      counter.unsubscribe();
    })
    .add('rx-toolkit LazySignal', () => {
      const counter = new LazySignal(0);
      let callCount = 0;
      const subs = Array.from({ length: 10 }, () =>
        counter.obsv$.subscribe(() => { callCount++; })
      );

      for (let i = 0; i < 100; i++) {
        counter.set(i);
      }

      subs.forEach(sub => sub.unsubscribe());
    })
    .add('Redux Toolkit Store', () => {
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          setValue: (state, action) => { state.value = action.payload; },
        },
      });
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });

      let callCount = 0;
      const unsubs = Array.from({ length: 10 }, () =>
        store.subscribe(() => { callCount++; })
      );

      for (let i = 0; i < 100; i++) {
        store.dispatch(counterSlice.actions.setValue(i));
      }

      unsubs.forEach(unsub => unsub());
    })
    .run();

  // 6. Производные значения (computed) без подписок
  await createBenchmark('Store Comparison: Computed без подписчиков (100 обновлений)')
    .add('rx-toolkit Signal + Computed', () => {
      const count = new Signal(0);
      const doubled = new Computed(() => count.value * 2);
      const quadrupled = new Computed(() => doubled.value * 2);

      for (let i = 0; i < 100; i++) {
        count.value = i;
        const result = quadrupled.value;
      }

      quadrupled.unsubscribe();
      doubled.unsubscribe();
      count.unsubscribe();
    })
    .add('rx-toolkit LazySignal + LazyComputed', () => {
      const count = new LazySignal(0);
      const doubled = new LazyComputed(() => count.get() * 2);
      const quadrupled = new LazyComputed(() => doubled.get() * 2);

      for (let i = 0; i < 100; i++) {
        count.set(i);
        const result = quadrupled.get();
      }
    })
    .add('Redux Toolkit (ручные селекторы)', () => {
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          setValue: (state, action) => { state.value = action.payload; },
        },
      });
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });

      for (let i = 0; i < 100; i++) {
        store.dispatch(counterSlice.actions.setValue(i));
        const state = store.getState();
        const doubled = state.counter.value * 2;
        const quadrupled = doubled * 2;
      }
    })
    .run();

  // 7. Производные значения (computed) с подписчиками
  await createBenchmark('Store Comparison: Computed с 5 подписчиками (100 обновлений)')
    .add('rx-toolkit Signal + Computed', () => {
      const count = new Signal(0);
      const doubled = new Computed(() => count.value * 2);
      const quadrupled = new Computed(() => doubled.value * 2);

      let callCount = 0;
      const subs = Array.from({ length: 5 }, () =>
        quadrupled.subscribe(() => { callCount++; })
      );

      for (let i = 0; i < 100; i++) {
        count.value = i;
      }

      subs.forEach(sub => sub.unsubscribe());
      quadrupled.unsubscribe();
      doubled.unsubscribe();
      count.unsubscribe();
    })
    .add('rx-toolkit LazySignal + LazyComputed', () => {
      const count = new LazySignal(0);
      const doubled = new LazyComputed(() => count.get() * 2);
      const quadrupled = new LazyComputed(() => doubled.get() * 2);

      let callCount = 0;
      const subs = Array.from({ length: 5 }, () =>
        quadrupled.obsv$.subscribe(() => { callCount++; })
      );

      for (let i = 0; i < 100; i++) {
        count.set(i);
      }

      subs.forEach(sub => sub.unsubscribe());
    })
    .add('Redux Toolkit с подписчиками', () => {
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          setValue: (state, action) => { state.value = action.payload; },
        },
      });
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });

      let callCount = 0;
      const unsubs = Array.from({ length: 5 }, () =>
        store.subscribe(() => {
          const state = store.getState();
          const doubled = state.counter.value * 2;
          const quadrupled = doubled * 2;
          callCount++;
        })
      );

      for (let i = 0; i < 100; i++) {
        store.dispatch(counterSlice.actions.setValue(i));
      }

      unsubs.forEach(unsub => unsub());
    })
    .run();

  // 8. Todo List (реалистичный сценарий) - 50 todos
  await createBenchmark('Store Comparison: Todo List с подписчиками (50 todos)')
    .add('rx-toolkit Signal', () => {
      interface Todo {
        id: number;
        text: string;
        completed: boolean;
      }

      const todos = new Signal<Todo[]>([]);
      const completedCount = new Computed(() =>
        todos.value.filter(t => t.completed).length
      );

      let updates = 0;
      const sub = completedCount.subscribe(() => { updates++; });

      // Добавление
      for (let i = 0; i < 50; i++) {
        todos.value = [...todos.value, { id: i, text: `Task ${i}`, completed: false }];
      }

      // Обновление
      for (let i = 0; i < 25; i++) {
        todos.value = todos.value.map(t =>
          t.id === i ? { ...t, completed: true } : t
        );
      }

      const count = completedCount.value;

      sub.unsubscribe();
      completedCount.unsubscribe();
      todos.unsubscribe();
    })
    .add('rx-toolkit LazySignal', () => {
      interface Todo {
        id: number;
        text: string;
        completed: boolean;
      }

      const todos = new LazySignal<Todo[]>([]);
      const completedCount = new LazyComputed(() =>
        todos.get().filter(t => t.completed).length
      );

      let updates = 0;
      const sub = completedCount.obsv$.subscribe(() => { updates++; });

      // Добавление
      for (let i = 0; i < 50; i++) {
        todos.set([...todos.peek(), { id: i, text: `Task ${i}`, completed: false }]);
      }

      // Обновление
      for (let i = 0; i < 25; i++) {
        todos.set(todos.peek().map(t =>
          t.id === i ? { ...t, completed: true } : t
        ));
      }

      const count = completedCount.get();
      sub.unsubscribe();
    })
    .add('Redux Toolkit', () => {
      interface Todo {
        id: number;
        text: string;
        completed: boolean;
      }

      const todosSlice = createSlice({
        name: 'todos',
        initialState: { items: [] as Todo[] },
        reducers: {
          addTodo: (state, action) => {
            state.items.push(action.payload);
          },
          toggleTodo: (state, action) => {
            const todo = state.items.find(t => t.id === action.payload);
            if (todo) todo.completed = !todo.completed;
          },
        },
      });

      const store = configureStore({
        reducer: { todos: todosSlice.reducer },
      });

      let updates = 0;
      const unsub = store.subscribe(() => {
        const state = store.getState();
        const count = state.todos.items.filter(t => t.completed).length;
        updates++;
      });

      // Добавление
      for (let i = 0; i < 50; i++) {
        store.dispatch(todosSlice.actions.addTodo({
          id: i,
          text: `Task ${i}`,
          completed: false,
        }));
      }

      // Обновление
      for (let i = 0; i < 25; i++) {
        store.dispatch(todosSlice.actions.toggleTodo(i));
      }

      const state = store.getState();
      const count = state.todos.items.filter(t => t.completed).length;
      unsub();
    })
    .run();

  // 9. Сложный граф зависимостей (Diamond Problem)
  await createBenchmark('Store Comparison: Diamond граф с подписчиками (100 обновлений)')
    .add('rx-toolkit Signal', () => {
      const a = new Signal(1);
      const b = new Signal(2);
      const c = new Signal(3);

      const ab = new Computed(() => a.value + b.value);
      const bc = new Computed(() => b.value + c.value);
      const abc = new Computed(() => ab.value + bc.value);

      let updates = 0;
      const sub = abc.subscribe(() => { updates++; });

      for (let i = 0; i < 100; i++) {
        a.value = i;
        b.value = i * 2;
        c.value = i * 3;
      }

      sub.unsubscribe();
      abc.unsubscribe();
      bc.unsubscribe();
      ab.unsubscribe();
      c.unsubscribe();
      b.unsubscribe();
      a.unsubscribe();
    })
    .add('rx-toolkit LazySignal', () => {
      const a = new LazySignal(1);
      const b = new LazySignal(2);
      const c = new LazySignal(3);

      const ab = new LazyComputed(() => a.get() + b.get());
      const bc = new LazyComputed(() => b.get() + c.get());
      const abc = new LazyComputed(() => ab.get() + bc.get());

      let updates = 0;
      const sub = abc.obsv$.subscribe(() => { updates++; });

      for (let i = 0; i < 100; i++) {
        a.set(i);
        b.set(i * 2);
        c.set(i * 3);
      }

      sub.unsubscribe();
    })
    .add('Redux Toolkit', () => {
      const slice = createSlice({
        name: 'values',
        initialState: { a: 1, b: 2, c: 3 },
        reducers: {
          setValues: (state, action) => {
            state.a = action.payload.a;
            state.b = action.payload.b;
            state.c = action.payload.c;
          },
        },
      });

      const store = configureStore({
        reducer: { values: slice.reducer },
      });

      let updates = 0;
      const unsub = store.subscribe(() => {
        const state = store.getState();
        const ab = state.values.a + state.values.b;
        const bc = state.values.b + state.values.c;
        const abc = ab + bc;
        updates++;
      });

      for (let i = 0; i < 100; i++) {
        store.dispatch(slice.actions.setValues({ a: i, b: i * 2, c: i * 3 }));
      }

      unsub();
    })
    .run();

  // 10. Stress Test - множественные подписчики
  await createBenchmark('Store Comparison: Stress Test (50 подписчиков, 200 обновлений)')
    .add('rx-toolkit Signal', () => {
      const counter = new Signal(0);
      let totalCalls = 0;

      const subs = Array.from({ length: 50 }, () =>
        counter.subscribe(() => { totalCalls++; })
      );

      for (let i = 0; i < 200; i++) {
        counter.value = i;
      }

      subs.forEach(sub => sub.unsubscribe());
      counter.unsubscribe();
    })
    .add('rx-toolkit LazySignal', () => {
      const counter = new LazySignal(0);
      let totalCalls = 0;

      const subs = Array.from({ length: 50 }, () =>
        counter.obsv$.subscribe(() => { totalCalls++; })
      );

      for (let i = 0; i < 200; i++) {
        counter.set(i);
      }

      subs.forEach(sub => sub.unsubscribe());
    })
    .add('Redux Toolkit', () => {
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          setValue: (state, action) => { state.value = action.payload; },
        },
      });
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });

      let totalCalls = 0;
      const unsubs = Array.from({ length: 50 }, () =>
        store.subscribe(() => { totalCalls++; })
      );

      for (let i = 0; i < 200; i++) {
        store.dispatch(counterSlice.actions.setValue(i));
      }

      unsubs.forEach(unsub => unsub());
    })
    .run();
}

