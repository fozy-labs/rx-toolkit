# Потоки данных: Signal Devtools Lifecycle Hooks (v3 — Redraft 2)

**Status**: Redraft  
**Дата**: 2026-03-11

---

## 1. Lifecycle-события

| Событие | Когда | Метод хука | Контекст |
|---------|-------|------------|----------|
| **Init** | Конструктор State | `onInit(value)` | Синхронно |
| **Change** | `State.set(value)` | `onChange(newValue)` | Внутри `Batcher.run()` |
| **Dispose** | FinalizationRegistry / GC | `onDispose()` | Микрозадача GC callback |

---

## 2. Жизненный цикл сигнала

```mermaid
stateDiagram-v2
    [*] --> Creating : new State(value, options)

    Creating --> Initialized : hooks[].onInit(value)
    note right of Creating
        1. normalizeSignalOptions()
        2. Devtools.createSignalHooks() → hooks[0]
        3. opts.hooks → hooks[1..N]
    end note

    Initialized --> Active : готов

    Active --> Updating : set(newValue)
    Updating --> Active : hooks[].onChange(newValue) → bs$.next()

    Active --> Disposing : GC
    Disposing --> [*] : hooks[].onDispose()
```

---

## 3. Создание State

`Devtools.createSignalHooks()` создаёт один хук, который **prepend**-ится в массив hooks. Пользовательские хуки идут после.

```mermaid
sequenceDiagram
    participant User as Пользователь
    participant State as State.constructor
    participant Norm as normalizeSignalOptions()
    participant DT as Devtools.createSignalHooks()
    participant SO as SharedOptions.DEVTOOLS
    participant BS as BehaviorSubject
    participant FR as FinalizationRegistry

    User->>State: State.create(42, { key: "counter", hooks: [userHook] })

    State->>Norm: normalizeSignalOptions(options)
    Norm-->>State: { key: "counter", hooks: [userHook] }

    State->>BS: new BehaviorSubject(42)

    Note over State: hooks = []

    State->>DT: createHooks(42, { key: "counter", base: "State" })
    DT->>SO: DEVTOOLS?.state

    alt DEVTOOLS есть и isDisabled !== true
        Note over DT: createKey() → ключ
        DT-->>State: devtoolsHook: SignalLifecycleHook
        Note over State: hooks.push(devtoolsHook)
    else нет DEVTOOLS или isDisabled
        DT-->>State: null
    end

    Note over State: hooks.push(...opts.hooks)

    loop hooks[].onInit(42)
        State->>State: hook.onInit?.(42)
    end

    alt есть хотя бы один onDispose
        State->>FR: register(this, hooks[])
    end

    State-->>User: signalFn
```

---

## 4. Внутри `Devtools.createSignalHooks()` — `beforeDevtoolsPush`

`beforeDevtoolsPush` вызывается **в том же месте**, где сейчас `_skipValues?.includes()` — внутри `onInit` и `onChange` возвращаемого хука. Нет отдельного метода — логика inline.

```mermaid
sequenceDiagram
    participant CH as Devtools.createSignalHooks()
    participant SO as SharedOptions.DEVTOOLS
    participant CK as createKey()

    CH->>SO: DEVTOOLS?.state
    alt isDisabled
        CH-->>CH: return null
    end
    alt DEVTOOLS null
        CH-->>CH: return null
    end

    CH->>CK: createKey(key, base)
    CK-->>CH: "counter#i=42"

    alt beforeDevtoolsPush НЕ задан
        Note over CH: Стандартный путь
        CH-->>CH: return {<br/>  onInit: stateDevtools = createState(key, val),<br/>  onChange: stateDevtools(val),<br/>  onDispose: stateDevtools('$COMPLETED')<br/>}
    else beforeDevtoolsPush задан
        Note over CH: Путь с фильтрацией (то же место, что _skipValues)
        CH-->>CH: return {<br/>  onInit: beforeDevtoolsPush(val, push),<br/>  onChange: beforeDevtoolsPush(val, push),<br/>  onDispose: stateDevtools('$COMPLETED')<br/>}
    end
```

### Сравнение: где именно вызывается

**AS-IS** — `createState()`, строки 20-25:
```typescript
let stateDevtools =
    options._skipValues?.includes(initialValue)  // ← ЭТО МЕСТО (onInit)
        ? null
        : createStateDevtools<T>(key, initialValue)

return (newState: T) => {
    if (options._skipValues?.includes(newState)) {  // ← ЭТО МЕСТО (onChange)
        return;
    }
```

**TO-BE** — `createSignalHooks()`, тот же участок кода в `onInit` и `onChange`:
```typescript
onInit(value: T) {
    beforeDevtoolsPush(value, (v) => {            // ← ТО ЖЕ МЕСТО
        stateDevtools = createStateDevtools(key, v);
    });
},
onChange(newValue: T) {
    beforeDevtoolsPush(newValue, (v) => {          // ← ТО ЖЕ МЕСТО
        if (!stateDevtools) {
            stateDevtools = createStateDevtools(key, v);
            return;
        }
        stateDevtools(v);
    });
},
```

---

## 5. `State.set()` — обновление через массив хуков

```mermaid
sequenceDiagram
    participant User as Пользователь
    participant State as State.set()
    participant Batcher as Batcher.run()
    participant H0 as hooks[0]: Devtools
    participant H1 as hooks[1]: User Hook
    participant BS as BehaviorSubject
    participant Deps as Зависимые Computed/Effect

    User->>State: state.set(100)

    Note over State: 100 === bs$.value? → нет

    State->>Batcher: Batcher.run(() => { ... })

    loop hooks[].onChange(100)
        Batcher->>H0: hooks[0].onChange?.(100)
        Note over H0: stateDevtools?.(100) → Redux DevTools
        Batcher->>H1: hooks[1].onChange?.(100)
        Note over H1: пользовательский side effect
    end

    Batcher->>BS: bs$.next(100)
    BS->>Deps: уведомление подписчиков

    Batcher-->>State: return
    State-->>User: return
```

Порядок: все `onChange` хуки вызываются **внутри** `Batcher.run()`, **до** `bs$.next()`.

```mermaid
graph TD
    A["Batcher.run(() => { ... })"] --> B{Scheduled.isLocked?}
    B -->|Нет| C["isLocked = true"]
    C --> D["for (hook of hooks)<br/>hook.onChange?.(value)"]
    D --> E["bs$.next(value)"]
    E --> F["Scheduled.run()"]
    F --> G["isLocked = false"]

    B -->|Да — вложенный| H["fn() немедленно"]
    H --> I["onChange + next внутри текущего batch"]

    style D fill:#6f6,stroke:#333
    style E fill:#ff9,stroke:#333
```

---

## 6. Computed — `beforeDevtoolsPush` фильтрует `_EMPTY`

### 6.1. Создание Computed → State с `beforeDevtoolsPush`

```mermaid
sequenceDiagram
    participant User as Пользователь
    participant Comp as Computed.constructor
    participant Norm as normalizeSignalOptions()
    participant State as State.create()
    participant DT as Devtools.createSignalHooks()

    User->>Comp: Computed.create(() => x + y, "sum")

    Comp->>Norm: normalizeSignalOptions("sum")
    Norm-->>Comp: { key: "sum" }

    Note over Comp: Формирует опции State:<br/>{ key: "sum", base: "Computed",<br/>  beforeDevtoolsPush: (val, push) =><br/>    val !== _EMPTY && push(val) }

    Comp->>State: State.create(_EMPTY, stateOptions)

    Note over State: Конструктор →
    State->>DT: createHooks(_EMPTY, opts)

    Note over DT: beforeDevtoolsPush задан!<br/>→ onInit вызывает:<br/>beforeDevtoolsPush(_EMPTY, push)<br/>→ _EMPTY === _EMPTY → push НЕ вызван<br/>→ stateDevtools остаётся null (lazy)

    DT-->>State: devtools hook → hooks[0]
    State-->>Comp: signalFn
```

### 6.2. Обновление Computed — `_EMPTY` отфильтрован

```mermaid
sequenceDiagram
    participant Eff as Effect (внутренний)
    participant CF as _computeFn()
    participant IS as Внутренний State
    participant H0 as hooks[0]: Devtools
    participant BDP as beforeDevtoolsPush
    participant RDT as Redux DevTools

    Note over Eff: Effect пересчитывает computed

    Eff->>CF: _computeFn()
    CF-->>Eff: newValue = 42

    Eff->>IS: state.set(42)

    Note over IS: 42 !== _EMPTY → hooks[].onChange

    IS->>H0: hooks[0].onChange(42)

    Note over H0: Внутри onChange вызывается:

    H0->>BDP: beforeDevtoolsPush(42, push)
    Note over BDP: 42 !== _EMPTY → push(42)
    BDP->>RDT: push(42) → stateDevtools(42)

    Note over IS: bs$.next(42) → подписчики
```

### 6.3. AS-IS vs TO-BE

```mermaid
graph LR
    subgraph "AS-IS: _skipValues"
        A1["_skipValues: [_EMPTY]"] --> A2["Devtools.createState()"]
        A2 --> A3{"_skipValues.includes(val)?"}
        A3 -->|Да| A4["Пропустить"]
        A3 -->|Нет| A5["stateDevtools(val)"]
    end

    subgraph "TO-BE: beforeDevtoolsPush"
        B1["beforeDevtoolsPush callback"] --> B2["Devtools.createSignalHooks()"]
        B2 --> B3["onInit / onChange"]
        B3 --> B4["beforeDevtoolsPush(val, push)"]
        B4 --> B5{"val !== _EMPTY?"}
        B5 -->|Да| B6["push(val) → devtools"]
        B5 -->|Нет| B7["push не вызван"]
    end

    style A1 fill:#f96,stroke:#333
    style B1 fill:#6f6,stroke:#333
```

---

## 7. GC / Dispose через массив хуков

```mermaid
sequenceDiagram
    participant GC as Garbage Collector
    participant FR as FinalizationRegistry
    participant H0 as hooks[0]: Devtools
    participant H1 as hooks[1]: User Hook
    participant RDT as reduxDevtools

    Note over GC: State потерял все ссылки

    GC->>FR: callback(heldValue = hooks[])

    FR->>H0: hooks[0].onDispose?.()
    Note over H0: stateDevtools?.('$COMPLETED' as any)<br/>stateDevtools = null
    H0->>RDT: '$COMPLETED'

    FR->>H1: hooks[1].onDispose?.()
    Note over H1: пользовательский cleanup
```

| Аспект | AS-IS | TO-BE |
|--------|-------|-------|
| Хранится в FR | `DevtoolsStateLike` (функция) | `SignalLifecycleHook[]` (массив) |
| Cleanup | `heldValue('$COMPLETED' as any)` | Итерация `hooks[].onDispose?.()` |
| Magic string `$COMPLETED` | В `State.ts` | Инкапсулирована в `Devtools.ts` |
| `as any` | В `State.ts` | Только внутри `Devtools.ts` |
| Расширяемость | Только devtools | Devtools + пользовательские хуки |

---

## 8. Полный цикл: создание → обновление → GC

```mermaid
sequenceDiagram
    participant User as Пользователь
    participant State as State
    participant DT as hooks[0]: Devtools
    participant UH as hooks[1..N]: User
    participant BS as BehaviorSubject
    participant GC as GC + FR

    Note over User,GC: ═══ СОЗДАНИЕ ═══

    User->>State: State.create(42, { key: "c", hooks: [userHook] })
    State->>State: normalizeSignalOptions()
    State->>DT: Devtools.createSignalHooks() → hooks[0]
    State->>State: hooks.push(...opts.hooks)
    State->>BS: new BehaviorSubject(42)

    loop onInit
        State->>DT: hooks[0].onInit(42)
        State->>UH: hooks[1..N].onInit(42)
    end

    Note over User,GC: ═══ ОБНОВЛЕНИЕ ═══

    User->>State: state.set(100)

    loop onChange (внутри Batcher)
        State->>DT: hooks[0].onChange(100)
        State->>UH: hooks[1..N].onChange(100)
    end
    State->>BS: bs$.next(100)

    Note over User,GC: ═══ GC ═══

    GC->>State: FinalizationRegistry callback

    loop onDispose
        State->>DT: hooks[0].onDispose()
        State->>UH: hooks[1..N].onDispose()
    end
```

---

## 9. Query — без изменений

Query-модуль продолжает использовать `Devtools.createState()` напрямую. Массив LC-хуков не затрагивает этот путь:

```mermaid
sequenceDiagram
    participant QLH as QueriesLifetimeHooks
    participant DT as Devtools.createState()
    participant SO as SharedOptions.DEVTOOLS

    QLH->>DT: Devtools.createState(state, { base: 'Queries', name: devtoolsName })
    DT->>SO: DEVTOOLS?.state
    SO-->>DT: createStateDevtools
    DT-->>QLH: stateDevtools (функция)

    Note over QLH: dataChanged$ → stateDevtools(state)
    Note over QLH: $cacheEntryRemoved → stateDevtools('$CLEANED' as any)
```

`createState()` сохраняется с текущей сигнатурой. Замена типа на `SignalOptions` не требуется.
