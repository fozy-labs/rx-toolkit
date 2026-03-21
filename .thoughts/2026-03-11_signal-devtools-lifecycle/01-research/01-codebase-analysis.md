# Анализ кодовой базы: улучшение devtools в сигналах

**Status**: Draft  
**Дата**: 2026-03-11

---

## 1. Все найденные файлы и их роль

### Типы и опции сигналов

| Файл | Роль |
|------|------|
| `src/common/devtools/types.ts` | Определяет `StateDevtoolsOptions`, `DevtoolsStateLike`, `DevtoolsLike` |
| `src/signals/types/signals.types.ts` | Определяет интерфейсы `ReadableSignalLike`, `SignalFn`, `ComputeFn`, `StatefulSignalFn` |
| `src/signals/types/index.ts` | Реэкспорт из `signals.types.ts` |

### Devtools инфраструктура

| Файл | Роль |
|------|------|
| `src/signals/base/Devtools.ts` | **Центральный хаб** — `Devtools.createState()` и `Devtools.hasDevtools` |
| `src/common/devtools/reduxDevtools.ts` | Имплементация `DevtoolsLike` для Redux DevTools |
| `src/common/devtools/combineDevtools.ts` | Комбинатор нескольких `DevtoolsLike` |
| `src/common/devtools/index.ts` | Реэкспорт |
| `src/common/options/SharedOptions.ts` | Хранит глобальную `DEVTOOLS: DevtoolsLike | null` |
| `src/common/options/DefaultOptions.ts` | Публичный API для установки `DEVTOOLS` через `DefaultOptions.update()` |

### Реализации сигналов

| Файл | Роль |
|------|------|
| `src/signals/signals/State.ts` | **Основной state-сигнал** — использует `StateDevtoolsOptions`, вызывает `Devtools.createState()` |
| `src/signals/signals/Computed.ts` | **Computed-сигнал** — создаёт внутренний `State`, передаёт `_skipValues` |
| `src/signals/signals/Effect.ts` | **Эффект** — НЕ использует devtools |
| `src/signals/signals/Signal.ts` | **Deprecated обёртка** над `State` и `Computed` — проксирует `StateDevtoolsOptions` |
| `src/signals/signals/LocalState.ts` | **LocalStorage state** — принимает `devtoolsOptions?: StateDevtoolsOptions` |
| `src/signals/signals/index.ts` | Реэкспорт |

### Базовые классы

| Файл | Роль |
|------|------|
| `src/signals/base/ReadonlySignal.ts` | Read-only обёртка — НЕ использует devtools |
| `src/signals/base/Batcher.ts` | Батчинг обновлений |
| `src/signals/base/DependencyTracker.ts` | Трекинг зависимостей для реактивности |
| `src/signals/base/Indexer.ts` | Генерация уникальных индексов для ключей devtools |
| `src/signals/base/ComputeCache.ts` | Кеш для computed-значений без подписки |
| `src/signals/base/SyncObservable.ts` | Observable с синхронным доступом к значению |
| `src/signals/base/index.ts` | Реэкспорт |

### React-интеграция

| Файл | Роль |
|------|------|
| `src/signals/react/useSignal.ts` | Хук `useSignal` — работает с `SignalLike<T>`, НЕ передаёт опции |
| `src/signals/react/index.ts` | Реэкспорт |

### Операторы

| Файл | Роль |
|------|------|
| `src/signals/operators/signalize.ts` | Конвертация `Observable` → `ReadableSignalFnLike`, НЕ использует devtools |
| `src/signals/operators/index.ts` | Реэкспорт |

### Публичные экспорты

| Файл | Роль |
|------|------|
| `src/signals/index.ts` | Реэкспортирует `base`, `operators`, `react`, `signals` |
| `src/index.ts` | Корневой экспорт — всё из `common/devtools`, `common/options`, `signals`, `query` |

### Query модуль (зависимость от devtools)

| Файл | Роль |
|------|------|
| `src/query/core/QueriesLifetimeHooks.ts` | Использует `Devtools.createState()` и `Devtools.hasDevtools` для отправки query-состояний |

---

## 2. Текущая архитектура: как options проходят через систему

### Тип `StateDevtoolsOptions`

Определён в `src/common/devtools/types.ts`:

```typescript
export type StateDevtoolsOptions = {
    isDisabled?: boolean,
    name?: string,
    base?: string,
    _skipValues?: any[],
} | string    // shorthand: просто имя
```

**Ключевое**: это union с `string`, что позволяет передать просто строку вместо объекта.

### Цепочка прохождения опций

```
Пользователь → State.create(value, options?) / Computed.create(fn, options?)
                         ↓
              Конструктор State/Computed
                         ↓
              Нормализация: typeof options === 'string' ? { name: options } : options
                         ↓
              Добавление { base: 'State'/'Computed' } (spread)
                         ↓
              Devtools.createState(initialValue, normalizedOptions)
                         ↓
              Devtools.ts: повторная нормализация string → { name }
                         ↓
              SharedOptions.DEVTOOLS?.state(key, initialValue)
                         ↓
              reduxDevtools implementation (или другой DevtoolsLike)
```

### Конкретные точки входа опций

**State.ts** (конструктор, строки 12-28):
```typescript
constructor(initialValue: T, options?: StateDevtoolsOptions) {
    // ...
    this._stateDevtools = Devtools.createState(initialValue, {
        base: State.name,
        ...(typeof options === 'string' ? { name: options } : options)
    });
}
```

**Computed.ts** (конструктор, строки 18-29):
```typescript
constructor(private _computeFn: () => T, options?: StateDevtoolsOptions) {
    const lsOptions: StateDevtoolsOptions = {
        base: Computed.name,
        ...(typeof options === 'string' ? { name: options } : options),
        _skipValues: [Computed._EMPTY],    // ВАЖНО: добавляет _skipValues
    };
    this._state$ = State.create<symbol | T>(Computed._EMPTY, lsOptions);
}
```

**Signal.ts** (deprecated, проксирует):
```typescript
static state<T>(initialValue: T, options?: StateDevtoolsOptions): SignalFn<T> {
    return State.create(initialValue, options);
}
static compute<T>(computeFn: () => T, options?: StateDevtoolsOptions) {
    return Computed.create(computeFn, options);
}
```

**LocalState.ts** (через отдельное поле):
```typescript
type Options<T> = {
    // ...
    devtoolsOptions?: StateDevtoolsOptions;
}
// В конструкторе:
this._state$ = new State<T>(initialValue, { isDisabled: true }); // devtools выключены для внутреннего State
this._computed = new Computed<T>(() => { ... }, options.devtoolsOptions); // devtools через Computed
```

---

## 3. Текущая интеграция devtools — где и как вызываются

### `Devtools.createState()` (`src/signals/base/Devtools.ts`)

Центральная функция инициализации devtools для state-сигнала:

```typescript
export const Devtools = {
    createState<T>(initialValue: T, optionsDry: StateDevtoolsOptions = {}) {
        const options = typeof optionsDry === 'string' ? { name: optionsDry } : optionsDry;

        if (options.isDisabled) return null;

        let createStateDevtools = SharedOptions.DEVTOOLS?.state;
        if (!createStateDevtools) return null;

        const key = createKey(options.name, options.base);

        let stateDevtools =
            options._skipValues?.includes(initialValue)
                ? null
                : createStateDevtools<T>(key, initialValue)

        return (newState: T) => {
            if (options._skipValues?.includes(newState)) return;
            if (!stateDevtools) {
                stateDevtools = createStateDevtools(key, newState);
                return;
            }
            stateDevtools(newState);
        }
    },
    get hasDevtools() {
        return !!SharedOptions.DEVTOOLS?.state;
    },
}
```

### Точки вызова devtools в сигналах

#### 1. `State.ts` — при каждом `set()`
```typescript
set(value: T) {
    if (value === this.bs$.value) return;
    Batcher.run(() => {
        this._stateDevtools?.(value);   // ← вызов devtools
        this.bs$.next(value);
    });
}
```

#### 2. `State.ts` — при GC (FinalizationRegistry)
```typescript
private static _finalizationRegistry = new FinalizationRegistry((heldValue: DevtoolsStateLike) => {
    heldValue('$COMPLETED' as any);    // ← cleanup devtools при GC
});
// В конструкторе:
if (this._stateDevtools) {
    State._finalizationRegistry.register(this, this._stateDevtools);
}
```

#### 3. `Computed.ts` — через внутренний `State` (неявно)
Computed создаёт `State.create<symbol | T>(Computed._EMPTY, lsOptions)`, и все вызовы devtools идут через внутренний State.

#### 4. `QueriesLifetimeHooks.ts` — прямой вызов `Devtools.createState()`
```typescript
if (devtoolsName !== false && Devtools.hasDevtools) {
    this.onCacheEntryAddedListeners.push(async (_, { $cacheEntryRemoved, dataChanged$ }) => {
        let stateDevtools: DevtoolsStateLike | null = null;
        dataChanged$.subscribe((state) => {
            if (!stateDevtools) {
                stateDevtools = Devtools.createState(state, { base: 'Queries', name: devtoolsName || '' });
                return;
            }
            stateDevtools(state);
        });
        $cacheEntryRemoved.then(() => { stateDevtools!('$CLEANED' as any); });
    });
}
```

### `reduxDevtools` — обработка специальных значений

```typescript
return (newState) => {
    if (newState === '$COMPLETED' || newState === '$CLEANED') {
        state = deleteState(keys, state);
        pendingActionType = 'clear';
        scheduler.schedule(flushToDevtools);
        return;
    }
    state = applyState(keys, newState, state);
    // ...
};
```

### Общая глобальная установка devtools

Пользователь устанавливает devtools через:
```typescript
DefaultOptions.update({ DEVTOOLS: reduxDevtools() });
```
Это сохраняется в `SharedOptions.DEVTOOLS`, который читается в `Devtools.createState()`.

---

## 4. `_skipValues` — где определён, как используется

### Определение типа
`src/common/devtools/types.ts`, строка 12:
```typescript
export type StateDevtoolsOptions = {
    // ...
    _skipValues?: any[],  // Underscore-prefix в публичном типе!
} | string
```

### Использование в `Devtools.createState()`
`src/signals/base/Devtools.ts`, строки 20-28:

1. **При инициализации**: если `initialValue` есть в `_skipValues`, devtools НЕ регистрируется сразу (lazy init)
2. **При обновлении**: если `newState` есть в `_skipValues`, обновление devtools пропускается

```typescript
let stateDevtools =
    options._skipValues?.includes(initialValue)
        ? null                                    // lazy: не создаём сразу
        : createStateDevtools<T>(key, initialValue)

return (newState: T) => {
    if (options._skipValues?.includes(newState)) return;   // пропускаем
    if (!stateDevtools) {
        stateDevtools = createStateDevtools(key, newState); // lazy init
        return;
    }
    stateDevtools(newState);
}
```

### Единственный потребитель `_skipValues`
`src/signals/signals/Computed.ts`, строка 24:
```typescript
const lsOptions: StateDevtoolsOptions = {
    base: Computed.name,
    ...(typeof options === 'string' ? { name: options } : options),
    _skipValues: [Computed._EMPTY],   // Symbol('empty') — начальное пустое значение
};
```

**Цель**: Computed использует внутренний символ `_EMPTY` как маркер "ещё не вычислено". Этот символ не должен попадать в devtools. `_skipValues` позволяет Computed скрыть этот технический артефакт.

### Проблемы `_skipValues`

1. **Underscore-prefix** в публичном типе — нарушение конвенции (это не приватное поле)
2. **`any[]`** — нет типовой безопасности, `includes()` использует `===` сравнение
3. **Одно назначение** — используется только Computed, но определён в общем типе
4. **Жёстко ограничен** — может только скрывать значения целиком, нельзя трансформировать

---

## 5. Текущие lifecycle события в сигналах

### State

| Событие | Где | Как |
|---------|-----|-----|
| **Создание** | `constructor()` | `Devtools.createState(initialValue, options)` |
| **Обновление** | `set(value)` | `this._stateDevtools?.(value)` |
| **GC (финализация)** | `FinalizationRegistry` | `heldValue('$COMPLETED' as any)` |

**Нет явных**: init, dispose, subscribe, unsubscribe.

### Computed

| Событие | Где | Как |
|---------|-----|-----|
| **Создание внутреннего state** | `constructor()` | Через `State.create()` — devtools регистрируется |
| **Первое вычисление** | `_start()` | Через `this._state$.set(value)` — devtools обновляется |
| **Перевычисление** | `Effect` callback | Через `this._state$.set(this._computeFn())` |
| **Остановка** | `_stop()` | `this._state$.set(Computed._EMPTY)` — но это `_skipValues`, devtools пропускает |

### Effect (нет задействования devtools!)

| Событие | Где |
|---------|-----|
| Создание | `constructor()` → `_runInTrackedContext()` |
| Перевыполнение | `scheduledFn()` → `_runInTrackedContext()` |
| Teardown | `_callTeardown()` |
| Unsubscribe | `unsubscribe()` |

### ReadonlySignal (нет devtools)

Только `get()`, `peek()`, `obs` — никаких lifecycle-хуков.

---

## 6. Зависимости между модулями

```
src/index.ts
  ├── src/common/devtools/          → экспорт: reduxDevtools, combineDevtools, типы
  ├── src/common/options/           → экспорт: DefaultOptions
  ├── src/signals/
  │    ├── base/
  │    │    ├── Devtools.ts         → импорт: SharedOptions, StateDevtoolsOptions, Indexer
  │    │    ├── Batcher.ts          (самодостаточный)
  │    │    ├── DependencyTracker.ts (самодостаточный)
  │    │    ├── Indexer.ts          (самодостаточный)
  │    │    ├── ComputeCache.ts     → импорт: DependencyTracker
  │    │    ├── ReadonlySignal.ts   → импорт: SyncObservable, DependencyTracker
  │    │    └── SyncObservable.ts   → импорт: rxjs Observable
  │    ├── signals/
  │    │    ├── State.ts            → импорт: StateDevtoolsOptions, DevtoolsStateLike, Batcher, DependencyTracker, Devtools
  │    │    ├── Computed.ts         → импорт: StateDevtoolsOptions, ComputeCache, DependencyTracker, State, Effect
  │    │    ├── Effect.ts           → импорт: Batcher, DependencyTracker (rxjs)
  │    │    ├── Signal.ts           → импорт: StateDevtoolsOptions, State, Computed, Effect (DEPRECATED)
  │    │    └── LocalState.ts       → импорт: StateDevtoolsOptions, signalize, Computed, State, zod
  │    ├── operators/signalize.ts   → импорт: ReadonlySignal
  │    └── react/useSignal.ts       → импорт: useEventHandler (common/react)
  └── src/query/
       └── core/QueriesLifetimeHooks.ts → импорт: Devtools, DevtoolsStateLike
```

### Граф зависимостей devtools

```
SharedOptions.DEVTOOLS (глобальный)
       ↑ устанавливается
DefaultOptions.update({ DEVTOOLS: reduxDevtools() })

       ↓ читается
Devtools.createState()   ← src/signals/base/Devtools.ts
       ↓ используется
State (конструктор + set)
Computed (через внутренний State)
Signal (через State/Computed)
LocalState (через Computed)
QueriesLifetimeHooks (прямой вызов)
```

---

## 7. TODO / FIXME / HACK / @deprecated в релевантных областях

### @deprecated
- `src/signals/signals/Signal.ts:9` — конструктор: `@deprecated use State instead`
- `src/signals/signals/Signal.ts:17` — `Signal.create()`: `@deprecated use state instead`
- `src/signals/signals/Effect.ts:104` — `complete()`: `@deprecated Use unsubscribe() method instead`
- `src/signals/signals/LocalState.ts:20` — поле `validator$`: `@deprecated use checkEffect instead`
- `src/signals/signals/LocalState.ts:186` — `LocalSignal`: `@deprecated use LocalState instead`

### TODO
- `src/query/core/QueriesLifetimeHooks.ts:73` — `// TODO не нравится мне это, мб передавать $spy в аргументы?`

### Неявные проблемы (обнаруженные при анализе)
- `State.ts:56` — `heldValue('$COMPLETED' as any)` — нарушение типов, `as any` для string вместо `T`
- `src/common/devtools/types.ts:12` — `_skipValues?: any[]` — underscore-prefix в публичном типе
- `QueriesLifetimeHooks.ts` — `stateDevtools!('$CLEANED' as any)` — аналогичное нарушение типов

---

## 8. Ключевые code snippets

### Snippet 1: Полный путь создания devtools для State

```typescript
// State.ts — конструктор
this._stateDevtools = Devtools.createState(initialValue, {
    base: State.name,                    // 'State'
    ...(typeof options === 'string'
        ? { name: options }
        : options)
});

// Devtools.ts — createState
createState<T>(initialValue: T, optionsDry: StateDevtoolsOptions = {}) {
    const options = typeof optionsDry === 'string' ? { name: optionsDry } : optionsDry;
    // ↑ ДВОЙНАЯ нормализация: и в State, и в Devtools
    if (options.isDisabled) return null;
    let createStateDevtools = SharedOptions.DEVTOOLS?.state;
    if (!createStateDevtools) return null;
    const key = createKey(options.name, options.base);
    // ...
}
```

### Snippet 2: Computed добавляет _skipValues

```typescript
// Computed.ts — конструктор
const lsOptions: StateDevtoolsOptions = {
    base: Computed.name,
    ...(typeof options === 'string' ? { name: options } : options),
    _skipValues: [Computed._EMPTY],
};
this._state$ = State.create<symbol | T>(Computed._EMPTY, lsOptions);
```

### Snippet 3: FinalizationRegistry cleanup

```typescript
// State.ts
private static _finalizationRegistry = new FinalizationRegistry(
    (heldValue: DevtoolsStateLike) => {
        heldValue('$COMPLETED' as any);  // as any — type violation
    }
);
// В конструкторе:
if (this._stateDevtools) {
    State._finalizationRegistry.register(this, this._stateDevtools);
}
```

### Snippet 4: Вызов devtools при set()

```typescript
// State.ts
set(value: T) {
    if (value === this.bs$.value) return;
    Batcher.run(() => {
        this._stateDevtools?.(value);  // devtools вызов В БАТЧЕ вместе с обновлением
        this.bs$.next(value);
    });
}
```

### Snippet 5: QueriesLifetimeHooks — прямое использование Devtools API

```typescript
// QueriesLifetimeHooks.ts
let stateDevtools: DevtoolsStateLike | null = null;
dataChanged$.subscribe((state) => {
    if (!stateDevtools) {
        stateDevtools = Devtools.createState(state, {
            base: 'Queries', name: devtoolsName || ''
        });
        return;  // BUG? createState возвращает функцию, не DevtoolsStateLike напрямую
    }
    stateDevtools(state);
});
```

---

## 9. Потенциальные точки влияния при изменениях

### Высокий риск

| Изменение | Что может сломаться | Файлы |
|-----------|---------------------|-------|
| Изменение `StateDevtoolsOptions` на `SignalOptions` | Все файлы, импортирующие `StateDevtoolsOptions` (13+ мест) | `State.ts`, `Computed.ts`, `Signal.ts`, `LocalState.ts`, `Devtools.ts`, `types.ts` |
| Удаление `_skipValues` из типа | `Computed.ts` — перестанет скрывать `_EMPTY` | `Computed.ts`, `Devtools.ts`, тесты |
| Изменение `Devtools.createState()` сигнатуры | `QueriesLifetimeHooks.ts` — прямой потребитель | `QueriesLifetimeHooks.ts` |
| Изменение поведения `$COMPLETED`/`$CLEANED` | Логика cleanup в `reduxDevtools.ts` и `State.ts` FinalizationRegistry | `reduxDevtools.ts`, `State.ts` |

### Средний риск

| Изменение | Что может сломаться | Файлы |
|-----------|---------------------|-------|
| Добавление hooks-поля в SignalOptions | Нужно аккуратно мержить с existing options flow | `State.ts`, `Computed.ts` |
| Перенос devtools-вызовов из State в hooks | Порядок вызовов в `Batcher.run()` может измениться | `State.ts` |
| Union `string | object` для options | Утилита нормализации должна корректно обрабатывать оба варианта | Все потребители |

### Низкий риск

| Изменение | Что может сломаться | Файлы |
|-----------|---------------------|-------|
| Добавление нового экспорта (утилита) | Только публичный API расширяется | `index.ts` файлы |
| Новый метод вместо `_skipValues` | Обратная совместимость через deprecation | `types.ts` |
| `useSignal` | Не затронут — работает с `SignalLike<T>`, не с опциями | — |
| `signalize` | Не затронут — не использует devtools | — |
| `ReadonlySignal` | Не затронут — нет devtools | — |

### Критические инварианты, которые нельзя сломать

1. **Батчинг**: devtools должны вызываться внутри `Batcher.run()` — иначе порядок нарушится
2. **FinalizationRegistry**: cleanup при GC — `$COMPLETED` должен отправляться
3. **Lazy init Computed**: `_EMPTY` символ не должен попадать в devtools
4. **Двойная нормализация string → объект**: существует в двух местах (State/Computed + Devtools), утилита должна это устранить
5. **`QueriesLifetimeHooks`**: использует `Devtools.createState()` и `Devtools.hasDevtools` — любые изменения API Devtools затронут query-модуль

---

## Выводы для следующего этапа (Design)

1. **Тип `StateDevtoolsOptions`** — текущее название привязано к devtools. Нужен новый тип `SignalOptions` (или `SignalOptionsOrKey`), который расширяет старый и добавляет поле hooks/lifecycle
2. **Утилита нормализации** — устранить двойную нормализацию `string → object` (сейчас в State/Computed И в Devtools.ts)
3. **Замена `_skipValues`** — новый публичный метод/функция для кастомизации данных, отправляемых в devtools. `Computed` будет использовать его вместо `_skipValues`
4. **LC hooks** — набор хуков, через которые devtools подключается. Сигнал вызывает хуки, а не devtools напрямую. Devtools — это предустановленный набор хуков
5. **Минимизация влияния** — `QueriesLifetimeHooks` использует `Devtools` API напрямую, так что изменения `Devtools` затронут и query-модуль. Нужно сохранить обратную совместимость `Devtools.createState()` или обновить и query-модуль
