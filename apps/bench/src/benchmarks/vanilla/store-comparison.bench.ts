import { Computed, LazyComputed, LazySignal, Signal } from '@fozy-labs/rx-toolkit';
import { combineReducers, configureStore, createSlice } from '@reduxjs/toolkit';
import { createBenchmark } from '@/utils/benchmark';

export async function runStoreComparisonBench() {
    const store = {
        asyncReducers: {} as Record<string, any>,
        ...configureStore({
            reducer: {},
        })
    }

    function createReducer(asyncReducers: Record<string, any>) {
        return combineReducers({
            ...asyncReducers,
        });
    }

    const injectReducer = (key: string, reducer: any) => {
        if (!store.asyncReducers[key]) {
            store.asyncReducers[key] = reducer;
            store.replaceReducer(createReducer(store.asyncReducers));
        }
    };

    const baseSignal = new Signal(0);
    const baseLazySignal = LazySignal.create(0);
    let lastValue: any;
    let testValue: any;

    function setValue(val: any) {
        testValue = val;
    }

    // 1. Создание и уничтожение примитивов
    await createBenchmark('Store Comparison: Создание примитива')
        .add('rx-toolkit Signal', () => {
            lastValue = new Signal(0);
            lastValue.complete();
        })
        .add('rx-toolkit LazySignal', () => {
            lastValue = LazySignal.create(0);
            // LazySignal не требует явного unsubscribe
        })
        .add('Redux Toolkit Store', () => {
            lastValue = createSlice({
                name: 'counter',
                initialState: { value: 0 },
                reducers: {
                    increment: (state) => {
                        state.value += 1;
                    },
                    setValue: (state, action) => {
                        state.value = action.payload;
                    },
                },
            });

            injectReducer(lastValue.reducerPath, lastValue.reducer);
            // Удаление редьюсера в Redux Toolkit не типично, поэтому пропускаем этот шаг
        })
        .run();

    lastValue = null;

    // 2. Простое чтение значения
    await createBenchmark('Store Comparison: Чтение значения')
        .add('rx-toolkit Signal', () => {
            for (let i = 0; i < 1000; i++) {
                lastValue = baseSignal.value;
                setValue(lastValue);
                lastValue = baseSignal.value;
            }
        })
        .add('rx-toolkit LazySignal', () => {
            for (let i = 0; i < 1000; i++) {
                lastValue = baseLazySignal();
                setValue(lastValue);
                lastValue = baseLazySignal();
            }
        })
        .add('Redux Toolkit Store', () => {
            for (let i = 0; i < 1000; i++) {
                lastValue = store.getState().counter?.value;
                setValue(lastValue);
                lastValue = store.getState().counter?.value;
            }
        })
        .run();

    lastValue = null;
    testValue = null;

    // 3. Простая запись значения
    await createBenchmark('Store Comparison: Запись значения')
        .add('rx-toolkit Signal', () => {
            for (let i = 0; i < 1000; i++) {
                baseSignal.value = 42;
                setValue(lastValue ?? 42);
                baseSignal.value = 42;
            }
        })
        .add('rx-toolkit LazySignal', () => {
            for (let i = 0; i < 1000; i++) {
                baseLazySignal.set(42);
                setValue(lastValue ?? 42);
                baseLazySignal.set(42);
            }
        })
        .add('Redux Toolkit Store', () => {
            for (let i = 0; i < 1000; i++) {
                store.dispatch({ type: 'counter/setValue', payload: 42 });
                setValue(lastValue ?? 42);
                store.dispatch({ type: 'counter/setValue', payload: 42 });
            }
        })
        .run();

    baseSignal.complete();

    // 4. Подписки (20 подписчиков, 200 обновлений)
    await createBenchmark('Store Comparison: 20 подписчиков + 200 обновлений')
        .add('rx-toolkit Signal', () => {
            const counter = new Signal(0);
            let callCount = 0;

            Array.from({ length: 20 }, () =>
                counter.subscribe(() => {
                    callCount++;
                })
            );

            for (let i = 0; i < 200; i++) {
                counter.value = i;
            }

            counter.complete();
        })
        .add('rx-toolkit LazySignal', () => {
            const counter = LazySignal.create(0);

            let callCount = 0;

            const subs = Array.from({ length: 20 }, () =>
                counter.obsv$.subscribe(() => {
                    callCount++;
                })
            );

            for (let i = 0; i < 200; i++) {
                counter.set(i);
            }

            subs.forEach(sub => sub.unsubscribe());
        })
        .add('Redux Toolkit Store', () => {
            const counterSlice = createSlice({
                name: 'counter',
                initialState: { value: 0 },
                reducers: {
                    setValue: (state, action) => {
                        state.value = action.payload;
                    },
                },
            });

            const store = configureStore({
                reducer: { counter: counterSlice.reducer },
            });

            let callCount = 0;

            const unsubs = Array.from({ length: 20 }, () =>
                store.subscribe(() => {
                    callCount++;
                })
            );

            for (let i = 0; i < 200; i++) {
                store.dispatch(counterSlice.actions.setValue(i));
            }

            unsubs.forEach(unsub => unsub());
        })
        .run();

    // 5. Производные значения (computed) без подписок
    await createBenchmark('Store Comparison: Computed без подписчиков (500 обновлений)')
        .add('rx-toolkit Signal + Computed', () => {
            const count = new Signal(0);
            const doubled = new Computed(() => count.value * 2);
            const quadrupled = new Computed(() => doubled.value * 2);

            setValue(lastValue);

            for (let i = 0; i < 500; i++) {
                count.value = i;
                lastValue = doubled.value;
                setValue(lastValue);
                lastValue = quadrupled.value;
            }

            setValue(lastValue);

            quadrupled.complete();
            doubled.complete();
            count.complete();
        })
        .add('rx-toolkit LazySignal + LazyComputed', () => {
            const count = LazySignal.create(0);
            const doubled = LazyComputed.create(() => count() * 2);
            const quadrupled = LazyComputed.create(() => doubled() * 2);

            setValue(lastValue);

            for (let i = 0; i < 500; i++) {
                count.set(i);
                lastValue = doubled();
                setValue(lastValue);
                lastValue = quadrupled();
            }

            setValue(lastValue);
        })
        .add('Redux Toolkit (ручные селекторы)', () => {
            const counterSlice = createSlice({
                name: 'counter',
                initialState: { value: 0 },
                reducers: {
                    setValue: (state, action) => {
                        state.value = action.payload;
                    },
                },
                selectors: {
                    selectDoubled: (state: any) => state.counter.value * 2,
                    selectQuadrupled: (state: any) => state.counter.value * 4,
                }
            });
            const store = configureStore({
                reducer: { counter: counterSlice.reducer },
            });

            setValue(lastValue);

            for (let i = 0; i < 500; i++) {
                store.dispatch(counterSlice.actions.setValue(i));
                const state = store.getState();
                lastValue = counterSlice.selectors.selectDoubled(state);
                setValue(lastValue);
                lastValue = counterSlice.selectors.selectQuadrupled(state);
            }

            setValue(lastValue);
        })
        .run();

    // 6. Производные значения (computed) с подписчиками
    await createBenchmark('Store Comparison: Computed с 50 подписчиками (500 обновлений)')
        .add('rx-toolkit Signal + Computed', () => {
            const count = new Signal(0);
            const doubled = new Computed(() => count.value * 2);
            const quadrupled = new Computed(() => doubled.value * 2);

            let callCount = 0;
            const subs = Array.from({ length: 50 }, () =>
                quadrupled.subscribe(() => {
                    callCount++;
                })
            );

            for (let i = 0; i < 500; i++) {
                count.value = i;
            }

            subs.forEach(sub => sub.unsubscribe());
            quadrupled.complete();
            doubled.complete();
            count.complete();
        })
        .add('rx-toolkit LazySignal + LazyComputed', () => {
            const count = LazySignal.create(0);
            const doubled = LazyComputed.create(() => count() * 2);
            const quadrupled = LazyComputed.create(() => doubled() * 2);

            let callCount = 0;
            const subs = Array.from({ length: 50 }, () =>
                quadrupled.obsv$.subscribe(() => {
                    callCount++;
                })
            );

            for (let i = 0; i < 500; i++) {
                count.set(i);
            }

            subs.forEach(sub => sub.unsubscribe());
        })
        .add('Redux Toolkit с подписчиками', () => {
            const counterSlice = createSlice({
                name: 'counter',
                initialState: { value: 0 },
                reducers: {
                    setValue: (state, action) => {
                        state.value = action.payload;
                    },
                },
            });
            const store = configureStore({
                reducer: { counter: counterSlice.reducer },
            });

            let callCount = 0;
            const unsubs = Array.from({ length: 50 }, () =>
                store.subscribe(() => {
                    const state = store.getState();
                    const doubled = state.counter.value * 2;
                    const quadrupled = doubled * 2;
                    callCount++;
                })
            );

            for (let i = 0; i < 500; i++) {
                store.dispatch(counterSlice.actions.setValue(i));
            }

            unsubs.forEach(unsub => unsub());
        })
        .run();

    // 7. Todo List (реалистичный сценарий) - 50 todos
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
    await createBenchmark('Store Comparison: Diamond граф с подписчиками (1000 обновлений)')
        .add('rx-toolkit Signal', () => {
            const a = new Signal(1);
            const b = new Signal(2);
            const c = new Signal(3);

            const ab = new Computed(() => a.value + b.value);
            const bc = new Computed(() => b.value + c.value);
            const abc = new Computed(() => ab.value + bc.value);

            let updates = 0;
            const sub = abc.subscribe(() => {
                updates++;
            });

            for (let i = 0; i < 1000; i++) {
                a.value = i;
                b.value = i * 2;
                c.value = i * 3;
            }

            sub.unsubscribe();
            abc.complete();
            bc.complete();
            ab.complete();
            c.complete();
            b.complete();
            a.complete();
        })
        .add('rx-toolkit LazySignal', () => {
            const a = LazySignal.create(1);
            const b = LazySignal.create(2);
            const c = LazySignal.create(3);

            const ab = LazyComputed.create(() => a() + b());
            const bc = LazyComputed.create(() => b() + c());
            const abc = LazyComputed.create(() => ab() + bc());

            let updates = 0;
            const sub = abc.obsv$.subscribe(() => {
                updates++;
            });

            for (let i = 0; i < 1000; i++) {
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
                selectors: {
                    selectAB: (state: any) => state.values.a + state.values.b,
                    selectBC: (state: any) => state.values.b + state.values.c,
                    selectABC: (state: any) => {
                        const ab = state.values.a + state.values.b;
                        const bc = state.values.b + state.values.c;
                        return ab + bc;
                    },
                }
            });

            const store = configureStore({
                reducer: { values: slice.reducer },
            });

            let updates = 0;

            const unsub = store.subscribe(() => {
                const state = store.getState();
                const abc = slice.selectors.selectABC(state);
                updates++;
            });

            for (let i = 0; i < 1000; i++) {
                store.dispatch(slice.actions.setValues({ a: i, b: i * 2, c: i * 3 }));
            }

            unsub();
        })
        .run();

    // 10. Stress Test - множественные подписчики
    await createBenchmark('Store Comparison: Stress Test (75 подписчиков, 500 обновлений)')
        .add('rx-toolkit Signal', () => {
            const counter = new Signal(0);
            const doubled = new Computed(() => counter.value * 2);
            let totalCalls = 0;

            Array.from({ length: 75 }, () =>
                doubled.subscribe(() => {
                    totalCalls++;
                })
            );

            for (let i = 0; i < 500; i++) {
                counter.value = i;
            }

            counter.complete();
            doubled.complete();
        })
        .add('rx-toolkit LazySignal', () => {
            const counter = LazySignal.create(0);
            const doubled = LazyComputed.create(() => counter() * 2);
            let totalCalls = 0;

            const subs = Array.from({ length: 75 }, () =>
                doubled.obsv$.subscribe(() => {
                    totalCalls++;
                })
            );

            for (let i = 0; i < 500; i++) {
                counter.set(i);
            }

            subs.forEach(sub => sub.unsubscribe());
        })
        .add('Redux Toolkit', () => {
            const counterSlice = createSlice({
                name: 'counter',
                initialState: { value: 0 },
                reducers: {
                    setValue: (state, action) => {
                        state.value = action.payload;
                    },
                },
                selectors: {
                    doubleValue: (state: any) => state.counter.value * 2,
                }
            });
            const store = configureStore({
                reducer: { counter: counterSlice.reducer },
            });

            let totalCalls = 0;

            const unsubs = Array.from({ length: 75 }, () =>
                store.subscribe(() => {
                    const state = store.getState();
                    const doubled = counterSlice.selectors.doubleValue(state);
                    totalCalls = doubled / 2;
                })
            );

            for (let i = 0; i < 500; i++) {
                store.dispatch(counterSlice.actions.setValue(i));
            }

            unsubs.forEach(unsub => unsub());
        })
        .run();
}

