import { Computed, Signal } from '@fozy-labs/rx-toolkit';
import { combineReducers, configureStore, createSlice } from '@reduxjs/toolkit';
import { create } from 'zustand';
import { atom, createStore as createJotaiStore } from 'jotai';
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

    const baseSignal = Signal.create(0);
    let lastValue: any;
    let testValue: any;

    function setValue(val: any) {
        testValue = val;
    }

    // 1. Создание и уничтожение примитивов
    await createBenchmark('Store Comparison: Создание примитива')
        .add('rx-toolkit Signal (fn)', () => {
            lastValue = Signal.create(0);
            // Signal не требует явного unsubscribe
        })
        .add('rx-toolkit Signal (class)', () => {
            lastValue = new Signal(0);
            // Signal не требует явного unsubscribe
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
        })
        .add('Zustand Store', () => {
            lastValue = create(() => ({ value: 0 }));
        })
        .add('Jotai Atom', () => {
            lastValue = atom(0);
        })
        .run();

    lastValue = null;

    // 2. Простое чтение значения
    const zustandStore = create(() => ({ value: 0 }));
    const jotaiStore = createJotaiStore();
    const jotaiAtom = atom(0);

    await createBenchmark('Store Comparison: Чтение значения')
        .add('rx-toolkit Signal', () => {
            for (let i = 0; i < 500; i++) {
                lastValue = baseSignal();
                setValue(lastValue);
                lastValue = baseSignal();
            }
        })
        .add('rx-toolkit Signal peek()', () => {
            for (let i = 0; i < 500; i++) {
                lastValue = baseSignal.peek();
                setValue(lastValue);
                lastValue = baseSignal.peek();
            }
        })
        .add('Redux Toolkit Store', () => {
            for (let i = 0; i < 500; i++) {
                lastValue = store.getState().counter?.value;
                setValue(lastValue);
                lastValue = store.getState().counter?.value;
            }
        })
        .add('Zustand Store', () => {
            for (let i = 0; i < 500; i++) {
                lastValue = zustandStore.getState().value;
                setValue(lastValue);
                lastValue = zustandStore.getState().value;
            }
        })
        .add('Jotai Atom', () => {
            for (let i = 0; i < 500; i++) {
                lastValue = jotaiStore.get(jotaiAtom);
                setValue(lastValue);
                lastValue = jotaiStore.get(jotaiAtom);
            }
        })
        .run();

    lastValue = null;
    testValue = null;

    // 3. Простая запись значения
    const zustandWriteStore = create<{
        value: number;
        setValue: (val: number) => void;
    }>((set) => ({
        value: 0,
        setValue: (val: number) => set({ value: val })
    }));
    const jotaiWriteStore = createJotaiStore();
    const jotaiWriteAtom = atom(0);

    await createBenchmark('Store Comparison: Запись значения')
        .add('rx-toolkit Signal', () => {
            baseSignal.set(42);
        })
        .add('Redux Toolkit Store', () => {
            store.dispatch({ type: 'counter/setValue', payload: 42 });
        })
        .add('Zustand Store', () => {
            zustandWriteStore.getState().setValue(42);
        })
        .add('Jotai Atom', () => {
            jotaiWriteStore.set(jotaiWriteAtom, 42);
        })
        .run();


    // 4. Подписки (20 подписчиков, 200 обновлений)
    await createBenchmark('Store Comparison: 20 подписчиков + 200 обновлений')
        .add('rx-toolkit Signal', () => {
            const counter = Signal.create(0);

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
        .add('Zustand Store', () => {
            const store = create<{
                value: number;
                setValue: (val: number) => void;
            }>((set) => ({
                value: 0,
                setValue: (val: number) => set({ value: val })
            }));

            let callCount = 0;

            const unsubs = Array.from({ length: 20 }, () =>
                store.subscribe(() => {
                    callCount++;
                })
            );

            for (let i = 0; i < 200; i++) {
                store.getState().setValue(i);
            }

            unsubs.forEach(unsub => unsub());
        })
        .add('Jotai Atom', () => {
            const jotaiStore = createJotaiStore();
            const counterAtom = atom(0);

            let callCount = 0;

            const unsubs = Array.from({ length: 20 }, () =>
                jotaiStore.sub(counterAtom, () => {
                    callCount++;
                })
            );

            for (let i = 0; i < 200; i++) {
                jotaiStore.set(counterAtom, i);
            }

            unsubs.forEach(unsub => unsub());
        })
        .run();

    // 5. Производные значения (computed) без подписок
    await createBenchmark('Store Comparison: Computed без подписчиков (500 обновлений)')
        .add('rx-toolkit Signal + Computed', () => {
            const count = Signal.create(0);
            const doubled = Computed.create(() => count() * 2);
            const quadrupled = Computed.create(() => doubled() * 2);

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
        .add('Zustand Store (селекторы)', () => {
            const store = create<{
                value: number;
                setValue: (val: number) => void;
            }>((set) => ({
                value: 0,
                setValue: (val: number) => set({ value: val })
            }));

            const selectDoubled = (state: any) => state.value * 2;
            const selectQuadrupled = (state: any) => state.value * 4;

            setValue(lastValue);

            for (let i = 0; i < 500; i++) {
                store.getState().setValue(i);
                const state = store.getState();
                lastValue = selectDoubled(state);
                setValue(lastValue);
                lastValue = selectQuadrupled(state);
            }

            setValue(lastValue);
        })
        .add('Jotai Atom (derived)', () => {
            const jotaiStore = createJotaiStore();
            const countAtom = atom(0);
            const doubledAtom = atom((get) => get(countAtom) * 2);
            const quadrupledAtom = atom((get) => get(doubledAtom) * 2);

            setValue(lastValue);

            for (let i = 0; i < 500; i++) {
                jotaiStore.set(countAtom, i);
                lastValue = jotaiStore.get(doubledAtom);
                setValue(lastValue);
                lastValue = jotaiStore.get(quadrupledAtom);
            }

            setValue(lastValue);
        })
        .run();

    // 6. Производные значения (computed) с подписчиками
    await createBenchmark('Store Comparison: Computed с 50 подписчиками (500 обновлений)')
        .add('rx-toolkit Signal + Computed', () => {
            const count = Signal.create(0);
            const doubled = Computed.create(() => count() * 2);
            const quadrupled = Computed.create(() => doubled() * 2);

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
        .add('Zustand Store с подписчиками', () => {
            const store = create<{
                value: number;
                setValue: (val: number) => void;
            }>((set) => ({
                value: 0,
                setValue: (val: number) => set({ value: val })
            }));

            let callCount = 0;
            const unsubs = Array.from({ length: 50 }, () =>
                store.subscribe((state) => {
                    const doubled = state.value * 2;
                    const quadrupled = doubled * 2;
                    callCount++;
                    setValue(quadrupled);
                })
            );

            for (let i = 0; i < 500; i++) {
                store.getState().setValue(i);
            }

            unsubs.forEach(unsub => unsub());
        })
        .add('Jotai Atom с подписчиками', () => {
            const jotaiStore = createJotaiStore();
            const countAtom = atom(0);
            const doubledAtom = atom((get) => get(countAtom) * 2);
            const quadrupledAtom = atom((get) => get(doubledAtom) * 2);

            let callCount = 0;
            const unsubs = Array.from({ length: 50 }, () =>
                jotaiStore.sub(quadrupledAtom, () => {
                    callCount++;
                })
            );

            for (let i = 0; i < 500; i++) {
                jotaiStore.set(countAtom, i);
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

            const todos = Signal.create<Todo[]>([]);
            const completedCount = Computed.create(() =>
                todos().filter(t => t.completed).length
            );

            let updates = 0;
            const sub = completedCount.obsv$.subscribe(() => {
                updates++;
            });

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
        .add('Zustand Store', () => {
            interface Todo {
                id: number;
                text: string;
                completed: boolean;
            }

            const store = create<{
                items: Todo[];
                addTodo: (todo: Todo) => void;
                toggleTodo: (id: number) => void;
            }>((set) => ({
                items: [],
                addTodo: (todo) => set((state) => ({ items: [...state.items, todo] })),
                toggleTodo: (id) => set((state) => ({
                    items: state.items.map(t =>
                        t.id === id ? { ...t, completed: !t.completed } : t
                    )
                })),
            }));

            let updates = 0;
            const unsub = store.subscribe((state) => {
                const count = state.items.filter(t => t.completed).length;
                updates++;
            });

            // Добавление
            for (let i = 0; i < 50; i++) {
                store.getState().addTodo({ id: i, text: `Task ${i}`, completed: false });
            }

            // Обновление
            for (let i = 0; i < 25; i++) {
                store.getState().toggleTodo(i);
            }

            const count = store.getState().items.filter(t => t.completed).length;
            unsub();
        })
        .add('Jotai Atom', () => {
            interface Todo {
                id: number;
                text: string;
                completed: boolean;
            }

            const jotaiStore = createJotaiStore();
            const todosAtom = atom<Todo[]>([]);
            const completedCountAtom = atom((get) =>
                get(todosAtom).filter(t => t.completed).length
            );

            let updates = 0;
            const unsub = jotaiStore.sub(completedCountAtom, () => {
                updates++;
            });

            // Добавление
            for (let i = 0; i < 50; i++) {
                const current = jotaiStore.get(todosAtom);
                jotaiStore.set(todosAtom, [...current, { id: i, text: `Task ${i}`, completed: false }]);
            }

            // Обновление
            for (let i = 0; i < 25; i++) {
                const current = jotaiStore.get(todosAtom);
                jotaiStore.set(todosAtom, current.map(t =>
                    t.id === i ? { ...t, completed: true } : t
                ));
            }

            const count = jotaiStore.get(completedCountAtom);
            unsub();
        })
        .run();

    // 9. Сложный граф зависимостей (Diamond Problem)
    await createBenchmark('Store Comparison: Diamond граф с подписчиками (500 обновлений)')
        .add('rx-toolkit Signal', () => {
            const a = Signal.create(1);
            const b = Signal.create(2);
            const c = Signal.create(3);

            const ab = Computed.create(() => a() + b());
            const bc = Computed.create(() => b() + c());
            const abc = Computed.create(() => ab() + bc());

            let updates = 0;
            const sub = abc.obsv$.subscribe(() => {
                updates++;
            });

            for (let i = 0; i < 500; i++) {
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

            for (let i = 0; i < 500; i++) {
                store.dispatch(slice.actions.setValues({ a: i, b: i * 2, c: i * 3 }));
            }

            unsub();
        })
        .add('Zustand Store', () => {
            const store = create<{
                a: number;
                b: number;
                c: number;
                setValues: (a: number, b: number, c: number) => void;
            }>((set) => ({
                a: 1,
                b: 2,
                c: 3,
                setValues: (a, b, c) => set({ a, b, c }),
            }));

            let updates = 0;
            const unsub = store.subscribe((state) => {
                const ab = state.a + state.b;
                const bc = state.b + state.c;
                const abc = ab + bc;
                updates++;
            });

            for (let i = 0; i < 500; i++) {
                store.getState().setValues(i, i * 2, i * 3);
            }

            unsub();
        })
        .add('Jotai Atom', () => {
            const jotaiStore = createJotaiStore();

            const aAtom = atom(1);
            const bAtom = atom(2);
            const cAtom = atom(3);

            const abAtom = atom((get) => get(aAtom) + get(bAtom));
            const bcAtom = atom((get) => get(bAtom) + get(cAtom));
            const abcAtom = atom((get) => get(abAtom) + get(bcAtom));

            let updates = 0;
            const unsub = jotaiStore.sub(abcAtom, () => {
                updates++;
            });

            for (let i = 0; i < 500; i++) {
                jotaiStore.set(aAtom, i);
                jotaiStore.set(bAtom, i * 2);
                jotaiStore.set(cAtom, i * 3);
            }

            unsub();
        })
        .run();

    // 10. Stress Test - множественные подписчики
    await createBenchmark('Store Comparison: Stress Test (75 подписчиков, 500 обновлений)')
        .add('rx-toolkit Signal', () => {
            const counter = Signal.create(0);
            const doubled = Computed.create(() => counter() * 2);
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
        .add('Zustand Store', () => {
            const store = create<{
                value: number;
                setValue: (val: number) => void;
            }>((set) => ({
                value: 0,
                setValue: (val: number) => set({ value: val })
            }));

            let totalCalls = 0;

            const unsubs = Array.from({ length: 75 }, () =>
                store.subscribe((state) => {
                    const doubled = state.value * 2;
                    totalCalls = doubled / 2;
                })
            );

            for (let i = 0; i < 500; i++) {
                store.getState().setValue(i);
            }

            unsubs.forEach(unsub => unsub());
        })
        .add('Jotai Atom', () => {
            const jotaiStore = createJotaiStore();
            const counterAtom = atom(0);
            const doubledAtom = atom((get) => get(counterAtom) * 2);

            let totalCalls = 0;

            const unsubs = Array.from({ length: 75 }, () =>
                jotaiStore.sub(doubledAtom, () => {
                    const val = jotaiStore.get(doubledAtom);
                    totalCalls = val / 2;
                })
            );

            for (let i = 0; i < 500; i++) {
                jotaiStore.set(counterAtom, i);
            }

            unsubs.forEach(unsub => unsub());
        })
        .run();
}

