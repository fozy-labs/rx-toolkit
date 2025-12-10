import { configureStore, createSlice } from '@reduxjs/toolkit';
import { createBenchmark } from '@/utils/benchmark';

// Создаем slice и store один раз для переиспользования
const counterSlice = createSlice({
  name: 'counter',
  initialState: { value: 0 },
  reducers: {
    increment: (state) => { state.value += 1; },
    setValue: (state, action) => { state.value = action.payload; },
    reset: (state) => { state.value = 0; },
  },
});

export async function runReduxBench() {
  // 1. Создание store (разовая операция)
  await createBenchmark('Redux Toolkit: Создание Store')
    .add('RTK - создание простого store', () => {
      const slice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          increment: (state) => { state.value += 1; },
        },
      });

      const store = configureStore({
        reducer: { counter: slice.reducer },
      });
    })
    .run();

  // 2. Чтение значений (с существующим store)
  await createBenchmark('Redux Toolkit: Чтение значений')
    .add('RTK - getState', () => {
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });
      const state = store.getState();
    })
    .run();

  // 3. Dispatch actions
  await createBenchmark('Redux Toolkit: Dispatch Actions')
    .add('RTK - dispatch increment', () => {
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });
      store.dispatch(counterSlice.actions.increment());
    })
    .add('RTK - dispatch с payload', () => {
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });
      store.dispatch(counterSlice.actions.setValue(42));
    })
    .run();

  // 4. Множественные dispatch (100 операций)
  await createBenchmark('Redux Toolkit: 100 dispatch операций')
    .add('RTK - 100 increments', () => {
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });

      for (let i = 0; i < 100; i++) {
        store.dispatch(counterSlice.actions.increment());
      }
    })
    .add('RTK - 100 setValue', () => {
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });

      for (let i = 0; i < 100; i++) {
        store.dispatch(counterSlice.actions.setValue(i));
      }
    })
    .run();

  // 5. Подписки (1 обновление)
  await createBenchmark('Redux Toolkit: Подписки (1 обновление)')
    .add('RTK - 10 подписчиков', () => {
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });

      let callCount = 0;
      const unsubscribers = Array.from({ length: 10 }, () =>
        store.subscribe(() => { callCount++; })
      );

      store.dispatch(counterSlice.actions.increment());

      unsubscribers.forEach(unsub => unsub());
    })
    .add('RTK - 100 подписчиков', () => {
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });

      let callCount = 0;
      const unsubscribers = Array.from({ length: 100 }, () =>
        store.subscribe(() => { callCount++; })
      );

      store.dispatch(counterSlice.actions.increment());

      unsubscribers.forEach(unsub => unsub());
    })
    .run();

  // 6. Подписки (100 обновлений)
  await createBenchmark('Redux Toolkit: Подписки (100 обновлений)')
    .add('RTK - 10 подписчиков', () => {
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });

      let callCount = 0;
      const unsubscribers = Array.from({ length: 10 }, () =>
        store.subscribe(() => { callCount++; })
      );

      for (let i = 0; i < 100; i++) {
        store.dispatch(counterSlice.actions.setValue(i));
      }

      unsubscribers.forEach(unsub => unsub());
    })
    .add('RTK - 100 подписчиков', () => {
      const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });

      let callCount = 0;
      const unsubscribers = Array.from({ length: 100 }, () =>
        store.subscribe(() => { callCount++; })
      );

      for (let i = 0; i < 100; i++) {
        store.dispatch(counterSlice.actions.setValue(i));
      }

      unsubscribers.forEach(unsub => unsub());
    })
    .run();

  // 7. Множественные slices
  await createBenchmark('Redux Toolkit: Множественные Slices')
    .add('RTK - 5 slices, каждый с 20 обновлениями', () => {
      const slices = Array.from({ length: 5 }, (_, i) =>
        createSlice({
          name: `slice${i}`,
          initialState: { value: 0 },
          reducers: {
            increment: (state) => { state.value += 1; },
          },
        })
      );

      const store = configureStore({
        reducer: Object.fromEntries(
          slices.map((slice, i) => [`slice${i}`, slice.reducer])
        ),
      });

      for (let i = 0; i < 20; i++) {
        slices.forEach(slice => {
          store.dispatch(slice.actions.increment());
        });
      }
    })
    .run();

  // 8. Сложное состояние (Todo List)
  await createBenchmark('Redux Toolkit: Todo List (50 todos)')
    .add('RTK - добавление и обновление todos', () => {
      interface Todo {
        id: number;
        text: string;
        completed: boolean;
      }

      const slice = createSlice({
        name: 'todos',
        initialState: {
          items: [] as Todo[],
        },
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
        reducer: { todos: slice.reducer },
      });

      let callCount = 0;
      const unsub = store.subscribe(() => { callCount++; });

      // Добавление 50 todos
      for (let i = 0; i < 50; i++) {
        store.dispatch(slice.actions.addTodo({
          id: i,
          text: `Task ${i}`,
          completed: false,
        }));
      }

      // Переключение 25 todos
      for (let i = 0; i < 25; i++) {
        store.dispatch(slice.actions.toggleTodo(i));
      }

      unsub();
    })
    .run();
}

