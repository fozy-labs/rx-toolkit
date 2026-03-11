# Потоки данных: Signal Devtools Lifecycle Hooks

**Status**: Draft  
**Дата**: 2026-03-11

---

## 1. Обзор lifecycle событий

Сигнал проходит через три ключевых lifecycle-события. Каждое событие проходит через merged LC-хуки (devtools + user):

| Событие | Когда | LC-хук | Контекст выполнения |
|---------|-------|--------|---------------------|
| **Init** | Конструктор State | `onInit(value)` | Синхронно в конструкторе |
| **Change** | `State.set(value)` | `onChange(newValue)` | Внутри `Batcher.run()` |
| **Dispose** | FinalizationRegistry / GC | `onDispose()` | В микрозадаче GC callback |

---

## 2. Диаграмма состояний жизненного цикла сигнала

```mermaid
stateDiagram-v2
    [*] --> Creating : new State(value, options)

    Creating --> Initialized : onInit(value)
    note right of Creating
        1. normalizeSignalOptions()
        2. createDevtoolsHooks()
        3. mergeHooks()
        4. BehaviorSubject создан
    end note

    Initialized --> Active : Готов к использованию

    Active --> Updating : set(newValue)
    Updating --> Active : onChange(newValue) → bs$.next()
    note right of Updating
        Внутри Batcher.run()
        onChange ДО bs$.next
    end note

    Active --> Disposing : GC собирает State
    Disposing --> [*] : onDispose()
    note right of Disposing
        FinalizationRegistry callback
        Devtools cleanup ($COMPLETED)
        Пользовательский cleanup
    end note
```

---

## 3. Поток создания State с devtools-хуками

### 3.1. Sequence-диаграмма: `State.create(value, options)`

```mermaid
sequenceDiagram
    participant User as Пользователь
    participant State as State.create()
    participant Normalize as normalizeSignalOptions()
    participant Devtools as Devtools.createDevtoolsHooks()
    participant SharedOpts as SharedOptions.DEVTOOLS
    participant Merge as Devtools.mergeHooks()
    participant Hooks as Merged Hooks
    participant BS as BehaviorSubject
    participant FR as FinalizationRegistry

    User->>State: State.create(42, { name: "counter", onInit: userFn })

    Note over State: Конструктор State

    State->>Normalize: normalizeSignalOptions({ name: "counter", onInit: userFn })
    Normalize-->>State: { name: "counter", onInit: userFn }

    State->>BS: new BehaviorSubject(42)
    BS-->>State: bs$

    State->>Devtools: createDevtoolsHooks(42, opts)
    Devtools->>SharedOpts: DEVTOOLS?.state
    SharedOpts-->>Devtools: createStateDevtools (или null)

    alt DEVTOOLS существует
        Note over Devtools: Создаёт ключ через createKey()
        Devtools-->>State: { onInit, onChange, onDispose }
    else DEVTOOLS не установлен
        Devtools-->>State: null
    end

    State->>Merge: mergeHooks(devtoolsHooks, opts)

    alt Есть devtools И есть user hooks
        Note over Merge: Merge: devtools first, then user
        Merge-->>State: { onInit: [dt+user], onChange: [dt+user], onDispose: [dt+user] }
    else Только devtools
        Merge-->>State: { onInit: dt, onChange: dt, onDispose: dt }
    else Только user hooks
        Merge-->>State: { onInit: user, onChange: user, onDispose: user }
    else Ничего
        Merge-->>State: null
    end

    State->>Hooks: hooks.onInit?.(42)

    alt hooks !== null И onDispose задан
        State->>FR: register(this, hooks.onDispose)
    end

    State-->>User: signalFn (с peek, set, get, obs)
```

### 3.2. Как devtools-хуки создаются внутри `createDevtoolsHooks`

```mermaid
sequenceDiagram
    participant Factory as createDevtoolsHooks()
    participant SharedOpts as SharedOptions.DEVTOOLS
    participant Indexer as Indexer.getIndex()
    participant CreateKey as createKey()

    Factory->>SharedOpts: DEVTOOLS?.state
    alt isDisabled === true
        Factory-->>Factory: return null
    end
    alt DEVTOOLS === null
        Factory-->>Factory: return null
    end

    Factory->>Indexer: getIndex()
    Indexer-->>Factory: i = 42

    Factory->>CreateKey: createKey("counter", "State")
    CreateKey-->>Factory: "counter#i=42"

    Note over Factory: Создаёт замыкание с:<br/>- key: "counter#i=42"<br/>- createStateDevtools: ref<br/>- stateDevtools: null (lazy)

    Factory-->>Factory: return { onInit, onChange, onDispose }
```

---

## 4. Поток обновления State (`set()`)

### 4.1. Sequence-диаграмма: `state.set(newValue)`

```mermaid
sequenceDiagram
    participant User as Пользователь
    participant State as State.set()
    participant Batcher as Batcher.run()
    participant Hooks as Merged Hooks
    participant DT as Devtools onChange
    participant UserHook as User onChange
    participant BS as BehaviorSubject
    participant Deps as Зависимые Computed/Effect

    User->>State: state.set(100)

    Note over State: Проверка: value === bs$.value?
    alt Значение не изменилось
        State-->>User: return (ничего не делаем)
    end

    State->>Batcher: Batcher.run(() => { ... })

    Note over Batcher: isLocked = true

    Batcher->>Hooks: hooks?.onChange?.(100)

    alt hooks !== null
        Hooks->>DT: devtools onChange(100)
        Note over DT: stateDevtools?.(100)<br/>→ отправка в Redux DevTools
        Hooks->>UserHook: user onChange(100)
        Note over UserHook: пользовательский side effect
    end

    Batcher->>BS: bs$.next(100)
    Note over BS: Уведомляет подписчиков

    BS->>Deps: Observable notification
    Note over Deps: Computed пересчитываются,<br/>Effect'ы выполняются

    Note over Batcher: Scheduled.run() — обработка<br/>отложенных батчей

    Batcher-->>State: return
    State-->>User: return
```

### 4.2. Порядок операций внутри Batcher

Важно: `onChange` хук вызывается **внутри** `Batcher.run()`, но **до** `bs$.next()`.

```mermaid
graph TD
    A["Batcher.run(() => { ... })"] --> B{Scheduled.isLocked?}
    B -->|Нет — первый вызов| C["isLocked = true"]
    C --> D["hooks?.onChange?.(value)"]
    D --> E["bs$.next(value)"]
    E --> F["Scheduled.run()"]
    F --> G["isLocked = false"]

    B -->|Да — вложенный вызов| H["fn() выполняется немедленно"]
    H --> I["onChange + next внутри текущего batch"]

    style D fill:#6f6,stroke:#333
    style E fill:#ff9,stroke:#333
```

Это гарантирует:
1. Devtools получают значение **до** уведомления подписчиков
2. При каскадных обновлениях (Computed → Effect → State.set) все onChange батчатся вместе
3. Devtools видят последовательность изменений в правильном порядке

---

## 5. Поток Computed с фильтрацией devtools (замена `_skipValues`)

### 5.1. Как Computed создаёт State с `devtoolsOnChange`

```mermaid
sequenceDiagram
    participant User as Пользователь
    participant Computed as Computed.constructor
    participant Normalize as normalizeSignalOptions()
    participant State as State.create()
    participant Factory as createDevtoolsHooks()

    User->>Computed: Computed.create(() => x + y, "sum")

    Computed->>Normalize: normalizeSignalOptions("sum")
    Normalize-->>Computed: { name: "sum" }

    Note over Computed: Формирует stateOptions:<br/>{ name: "sum", base: "Computed",<br/>  devtoolsOnChange: filterFn }

    Note over Computed: devtoolsOnChange = (val, push) =><br/>  val !== _EMPTY && push(val)

    Computed->>State: State.create(_EMPTY, stateOptions)

    Note over State: В конструкторе State:
    State->>Factory: createDevtoolsHooks(_EMPTY, opts)

    Note over Factory: opts.devtoolsOnChange задан!<br/>→ Специальная логика:<br/>onInit использует devtoolsOnChange

    Factory-->>State: devtools hooks с devtoolsOnChange

    Note over State: onInit(_EMPTY) →<br/>devtoolsOnChange(_EMPTY, push) →<br/>_EMPTY !== _EMPTY → НЕ пушим<br/>→ stateDevtools остаётся null (lazy)

    State-->>Computed: signalFn
```

### 5.2. Обновление Computed — фильтрация `_EMPTY`

```mermaid
sequenceDiagram
    participant Effect as Effect (внутренний)
    participant ComputeFn as _computeFn()
    participant InternalState as Внутренний State
    participant Hooks as Devtools Hooks
    participant DevtoolsOnChange as devtoolsOnChange
    participant DT as Redux DevTools

    Note over Effect: Effect пересчитывает computed

    Effect->>ComputeFn: _computeFn()
    ComputeFn-->>Effect: newValue = 42

    Effect->>InternalState: state.set(42)

    Note over InternalState: 42 !== _EMPTY → вызываем hooks

    InternalState->>Hooks: hooks.onChange(42)

    Note over Hooks: Devtools onChange вызван

    Hooks->>DevtoolsOnChange: devtoolsOnChange(42, push)

    Note over DevtoolsOnChange: 42 !== _EMPTY → push(42)

    DevtoolsOnChange->>DT: push(42) → stateDevtools(42)

    Note over DT: Redux DevTools обновлён

    Note over InternalState: bs$.next(42) → уведомление подписчиков
```

### 5.3. Сравнение: старая vs новая фильтрация

```mermaid
graph LR
    subgraph "AS-IS: _skipValues"
        A1["Computed: _skipValues: [_EMPTY]"] --> A2["Devtools.createState()"]
        A2 --> A3{"_skipValues.includes(val)?"}
        A3 -->|Да| A4["Пропустить"]
        A3 -->|Нет| A5["stateDevtools(val)"]
    end

    subgraph "TO-BE: devtoolsOnChange"
        B1["Computed: devtoolsOnChange callback"] --> B2["createDevtoolsHooks()"]
        B2 --> B3["onInit / onChange"]
        B3 --> B4["devtoolsOnChange(val, push)"]
        B4 --> B5{"val !== _EMPTY?"}
        B5 -->|Да| B6["push(val) → devtools"]
        B5 -->|Нет| B7["Не вызываем push"]
    end

    style A1 fill:#f96,stroke:#333
    style B1 fill:#6f6,stroke:#333
```

**Преимущества нового подхода**:
- Нет `any[]` в публичном типе
- Computed контролирует логику фильтрации, не передавая «magic values»
- `devtoolsOnChange` — расширяемый: пользователь может трансформировать данные перед отправкой в devtools

---

## 6. Поток GC/Dispose через `onDispose`

### 6.1. Sequence-диаграмма: FinalizationRegistry → onDispose

```mermaid
sequenceDiagram
    participant GC as Garbage Collector
    participant FR as FinalizationRegistry
    participant OnDispose as Merged onDispose
    participant DT_Dispose as Devtools onDispose
    participant User_Dispose as User onDispose
    participant ReduxDT as reduxDevtools

    Note over GC: State-объект потерял все ссылки

    GC->>FR: Callback для зарегистрированного State

    Note over FR: heldValue = onDispose function

    FR->>OnDispose: onDispose()

    OnDispose->>DT_Dispose: devtools onDispose()
    Note over DT_Dispose: stateDevtools?.('$COMPLETED' as any)<br/>stateDevtools = null

    DT_Dispose->>ReduxDT: '$COMPLETED'
    Note over ReduxDT: deleteState(keys, state)<br/>pendingActionType = 'clear'<br/>scheduler.schedule(flushToDevtools)

    OnDispose->>User_Dispose: user onDispose()
    Note over User_Dispose: Пользовательский cleanup<br/>(если задан)
```

### 6.2. Сравнение: старая vs новая GC-обработка

| Аспект | AS-IS | TO-BE |
|--------|-------|-------|
| Что хранится в FR | `DevtoolsStateLike` (функция) | `onDispose` callback |
| Как cleanup | `heldValue('$COMPLETED' as any)` | `onDispose()` → внутри `stateDevtools?.('$COMPLETED')` |
| Magic string | В `State.ts` | Инкапсулирован в `createDevtoolsHooks` |
| `as any` | В `State.ts` (публичный код) | Только внутри `Devtools.ts` |
| Расширяемость | Только devtools cleanup | Devtools + пользовательский cleanup |

---

## 7. Поток merge хуков

### 7.1. Алгоритм `mergeHooks()`

```mermaid
flowchart TD
    Start["mergeHooks(devtoolsHooks, userOptions)"] --> CheckDT{devtoolsHooks !== null?}

    CheckDT -->|Да| HasDT["dt = devtoolsHooks"]
    CheckDT -->|Нет| HasDT_null["dt = null"]

    HasDT --> CheckUser{userOptions имеет<br/>onInit/onChange/onDispose?}
    HasDT_null --> CheckUser

    CheckUser -->|Да| HasUser["user hooks извлечены"]
    CheckUser -->|Нет| HasUser_null["user = null"]

    HasDT_null --> HasUser_null --> ReturnNull["return null"]

    HasDT --> HasUser --> MergeBoth["Merge: для каждого хука"]
    HasDT --> HasUser_null --> ReturnDT["return dt hooks"]
    HasDT_null --> HasUser --> ReturnUser["return user hooks"]

    MergeBoth --> MergeOnInit["onInit: dt.onInit → user.onInit"]
    MergeBoth --> MergeOnChange["onChange: dt.onChange → user.onChange"]
    MergeBoth --> MergeOnDispose["onDispose: dt.onDispose → user.onDispose"]

    MergeOnInit --> Result["return merged { onInit, onChange, onDispose }"]
    MergeOnChange --> Result
    MergeOnDispose --> Result

    style ReturnNull fill:#eee,stroke:#999
    style MergeBoth fill:#6f6,stroke:#333
```

### 7.2. Порядок вызова при merge

```
merged.onInit(value):
  1. devtoolsHooks.onInit(value)     // devtools регистрация
  2. userOptions.onInit(value)        // пользовательский callback

merged.onChange(newValue):
  1. devtoolsHooks.onChange(newValue) // devtools обновление
  2. userOptions.onChange(newValue)    // пользовательский callback

merged.onDispose():
  1. devtoolsHooks.onDispose()       // devtools cleanup ($COMPLETED)
  2. userOptions.onDispose()          // пользовательский cleanup
```

**Обоснование порядка**: devtools first — чтобы логгирование и cleanup происходили прежде пользовательских side effects.

### 7.3. Оптимизация: null-short-circuit

```mermaid
flowchart LR
    A["hooks === null"] -->|"~0ns"| B["set() → bs$.next()"]
    C["hooks !== null<br/>onChange === undefined"] -->|"~2ns<br/>optional chaining"| B
    D["hooks !== null<br/>onChange === fn"] -->|"~5ns<br/>fn call"| E["onChange() → bs$.next()"]
```

Когда хуки не заданы (`_hooks === null`), overhead = 0. При наличии хуков optional chaining `?.` добавляет ~2ns (см. [исследование производительности](../01-research/02-external-research.md)).

---

## 8. Полный lifecycle — сквозной поток

### 8.1. Сквозная sequence-диаграмма: создание → обновления → GC

```mermaid
sequenceDiagram
    participant User as Пользователь
    participant State as State
    participant Hooks as Merged Hooks
    participant DT as Redux DevTools
    participant GC as Garbage Collector

    rect rgb(220, 240, 220)
        Note over User,DT: Phase 1: Создание
        User->>State: State.create(0, { name: "counter", onChange: log })
        State->>Hooks: mergeHooks(devtoolsHooks, userOpts)
        State->>Hooks: onInit(0)
        Hooks->>DT: createStateDevtools("counter#i=0", 0)
        Hooks->>User: userOnInit(0)
    end

    rect rgb(220, 220, 240)
        Note over User,DT: Phase 2: Обновления
        User->>State: set(1)
        State->>Hooks: onChange(1) [inside Batcher]
        Hooks->>DT: stateDevtools(1)
        Hooks->>User: userOnChange(1)

        User->>State: set(2)
        State->>Hooks: onChange(2) [inside Batcher]
        Hooks->>DT: stateDevtools(2)
        Hooks->>User: userOnChange(2)

        User->>State: set(2) [same value]
        Note over State: Пропущено: value === bs$.value
    end

    rect rgb(240, 220, 220)
        Note over User,GC: Phase 3: GC/Dispose
        Note over State: State теряет все ссылки
        GC->>Hooks: onDispose()
        Hooks->>DT: stateDevtools('$COMPLETED')
        Note over DT: Удаление из Redux DevTools
        Hooks->>User: userOnDispose()
    end
```

---

## 9. Потоки данных в контексте Batcher

### 9.1. Батчинг нескольких State.set() в одном цикле

```mermaid
sequenceDiagram
    participant User as Пользователь
    participant Batcher as Batcher
    participant S1 as State A
    participant S2 as State B
    participant H1 as Hooks A
    participant H2 as Hooks B
    participant Computed as Computed C (зависит от A и B)

    User->>Batcher: Batcher.run(() => { a.set(1); b.set(2); })

    Note over Batcher: isLocked = true

    Batcher->>S1: a.set(1)
    Note over S1: value !== bs$.value
    S1->>Batcher: Batcher.run() [вложенный]
    Note over Batcher: isLocked === true → fn() немедленно
    S1->>H1: hooks.onChange(1)
    Note over H1: devtools(1) → user(1)
    S1->>S1: bs$.next(1)
    Note over S1: Computed C scheduled

    Batcher->>S2: b.set(2)
    S2->>Batcher: Batcher.run() [вложенный]
    S2->>H2: hooks.onChange(2)
    Note over H2: devtools(2) → user(2)
    S2->>S2: bs$.next(2)
    Note over S2: Computed C scheduled (already)

    Note over Batcher: Scheduled.run()
    Batcher->>Computed: Пересчёт C
    Note over Computed: C.onChange(newVal) через внутренний State

    Note over Batcher: isLocked = false
```

### 9.2. Как devtools видят батчированные обновления

В контексте Batcher devtools получают **каждое** изменение отдельно (не агрегированно). Это совпадает с текущим поведением — `devtoolsOnChange` вызывается для каждого `set()`, даже внутри batch.

Порядок в Redux DevTools при батче `{ a.set(1); b.set(2); }`:
1. `State A#i=0: 1`
2. `State B#i=1: 2`
3. `Computed C#i=2: newComputedValue`

---

## 10. Специальные потоки

### 10.1. State без devtools (isDisabled: true)

```mermaid
sequenceDiagram
    participant User as Пользователь
    participant State as State
    participant Factory as createDevtoolsHooks()

    User->>State: State.create(0, { isDisabled: true })

    State->>Factory: createDevtoolsHooks(0, { isDisabled: true })
    Factory-->>State: null

    Note over State: mergeHooks(null, { isDisabled: true })
    Note over State: → null (нет user hooks, нет devtools hooks)
    Note over State: _hooks = null

    User->>State: set(1)
    Note over State: _hooks === null → пропускаем
    Note over State: bs$.next(1) — только обновление значения
```

### 10.2. State без глобальных devtools (DEVTOOLS не установлен)

```mermaid
sequenceDiagram
    participant User as Пользователь
    participant State as State
    participant Factory as createDevtoolsHooks()
    participant SharedOpts as SharedOptions

    User->>State: State.create(0, { name: "counter", onInit: userFn })

    State->>Factory: createDevtoolsHooks(0, opts)
    Factory->>SharedOpts: DEVTOOLS?.state
    SharedOpts-->>Factory: null (DEVTOOLS не установлен)
    Factory-->>State: null

    Note over State: mergeHooks(null, { onInit: userFn })
    Note over State: → { onInit: userFn } (только user hooks)

    State->>State: hooks.onInit(0)
    Note over State: userFn(0) — вызван
```

### 10.3. LocalState — цепочка через Computed

```mermaid
sequenceDiagram
    participant User as Пользователь
    participant LS as LocalState
    participant InternalState as State (internal, isDisabled)
    participant ComputedSig as Computed
    participant ComputedState as State (inside Computed)
    participant Hooks as Hooks (Computed's)

    User->>LS: new LocalState({ key: "k", defaultValue: 0, devtoolsOptions: "ls" })

    LS->>InternalState: new State(0, { isDisabled: true })
    Note over InternalState: Devtools отключены

    LS->>ComputedSig: new Computed(() => ..., "ls")
    ComputedSig->>ComputedState: State.create(_EMPTY, { name: "ls", base: "Computed", devtoolsOnChange: filterFn })
    Note over ComputedState: devtoolsOnChange фильтрует _EMPTY

    User->>LS: ls.set(42)
    LS->>InternalState: state.set(42)
    Note over InternalState: hooks === null → нет devtools
    Note over InternalState: bs$.next(42)

    Note over ComputedSig: Effect пересчитывает → 42

    ComputedSig->>ComputedState: state.set(42)
    ComputedState->>Hooks: onChange(42)
    Note over Hooks: devtoolsOnChange(42, push)<br/>42 !== _EMPTY → push(42)
    Note over Hooks: → Redux DevTools обновлён
```

---

## 11. Сводка потоков и зон ответственности

| Поток | Инициатор | Контекст выполнения | LC-хуки |
|-------|-----------|---------------------|---------|
| Создание State | `new State()` | Синхронно, конструктор | `onInit` |
| Обновление State | `State.set()` | Внутри `Batcher.run()` | `onChange` |
| Обновление Computed | Effect → `State.set()` | Внутри `Batcher.run()` | `onChange` (с `devtoolsOnChange` фильтрацией) |
| GC State | `FinalizationRegistry` | Микрозадача GC | `onDispose` |
| Merge хуков | `State.constructor` | Синхронно, конструктор | Все три |
| Devtools фабрика | `createDevtoolsHooks()` | Синхронно, внутри конструктора | Создаёт devtools LC-хуки |
| Query devtools | `QueriesLifetimeHooks` | Async (через subscribe) | **Не LC-хуки** — прямой `Devtools.createState()` |
