# Архитектура: Signal Devtools Lifecycle Hooks (v3 — Redraft 2)

**Status**: Redraft  
**Дата**: 2026-03-11

---

## 1. Контекст: как фича вписывается в rx-toolkit

rx-toolkit — библиотека реактивных сигналов (State, Computed, Effect) с devtools-интеграцией через Redux DevTools. Текущая архитектура: `State` напрямую вызывает `Devtools.createState()`, который возвращает функцию-push. Lifecycle-события (create, update, GC) обрабатываются разрозненно — нет единой абстракции.

**Цель**: ввести массив LC-хуков (`SignalLifecycleHook[]`), где devtools — один из элементов, создаваемый `Devtools.createSignalHooks()`. Callback `beforeDevtoolsPush` вызывается **внутри** `Devtools.createSignalHooks()` — в том же месте кода, где сейчас `_skipValues?.includes()`.

---

## 2. C4 Level 2 — Контейнеры

### 2.1. AS-IS

```mermaid
graph TD
    subgraph "Signals Module"
        State["State.ts"]
        Computed["Computed.ts"]
        Signal["Signal.ts (deprecated)"]
        LocalState["LocalState.ts"]
    end

    subgraph "Devtools Infrastructure"
        DevtoolsBridge["Devtools.ts — createState()"]
        SharedOpts["SharedOptions.DEVTOOLS"]
        ReduxDT["reduxDevtools.ts"]
    end

    subgraph "Query Module"
        QueriesLH["QueriesLifetimeHooks.ts"]
    end

    State -->|"прямой вызов createState()"| DevtoolsBridge
    Computed -->|"передаёт _skipValues в State"| State
    Signal -->|"наследует"| State
    LocalState -->|"создаёт"| State
    QueriesLH -->|"прямой вызов createState()"| DevtoolsBridge
    DevtoolsBridge -->|"читает"| SharedOpts
    SharedOpts -->|"хранит"| ReduxDT

    style DevtoolsBridge fill:#f96,stroke:#333
    style State fill:#f96,stroke:#333
```

### 2.2. TO-BE

```mermaid
graph TD
    subgraph "Signals Module"
        State["State.ts"]
        Computed["Computed.ts"]
        Signal["Signal.ts (deprecated)"]
        LocalState["LocalState.ts"]
        NormUtil["normalizeSignalOptions()"]
    end

    subgraph "LC Hooks Layer"
        HooksArr["hooks: SignalLifecycleHook[]"]
        DTHook["Devtools.createSignalHooks() → hooks[0]"]
        UserHooks["Пользовательские хуки → hooks[1..N]"]
    end

    subgraph "Devtools Infrastructure"
        DevtoolsBridge["Devtools.ts — createState() + createSignalHooks()"]
        SharedOpts["SharedOptions.DEVTOOLS"]
        ReduxDT["reduxDevtools.ts"]
    end

    subgraph "Query Module"
        QueriesLH["QueriesLifetimeHooks.ts"]
    end

    State -->|"нормализует опции"| NormUtil
    State -->|"вызывает массив хуков"| HooksArr
    Computed -->|"через внутренний State"| State
    Signal -->|"наследует"| State
    LocalState -->|"создаёт"| State
    HooksArr --- DTHook
    HooksArr --- UserHooks
    DTHook -->|"создаётся в"| DevtoolsBridge
    DevtoolsBridge -->|"читает"| SharedOpts
    SharedOpts -->|"хранит"| ReduxDT
    QueriesLH -->|"createState() без изменений"| DevtoolsBridge

    style HooksArr fill:#6f6,stroke:#333
    style DTHook fill:#6f6,stroke:#333
    style NormUtil fill:#6f6,stroke:#333
```

---

## 3. C4 Level 3 — Компоненты

### 3.1. Компонент `Devtools`

Объект `Devtools` в `src/signals/base/Devtools.ts` получает **новый метод** `createSignalHooks()`. Старый `createState()` остаётся для query-модуля.

```mermaid
graph TD
    subgraph "Devtools (объект)"
        createState["createState() — для query"]
        createHooks["createSignalHooks() — для сигналов"]
        hasDevtools["hasDevtools: boolean"]
    end

    subgraph "createSignalHooks() — внутренняя логика"
        CheckDisabled{"isDisabled?"}
        CheckDT{"DEVTOOLS?.state?"}
        BuildKey["createKey(key, base)"]
        BeforePush{"beforeDevtoolsPush задан?"}
        StandardPath["onInit/onChange: push напрямую"]
        MappedPath["onInit/onChange: через beforeDevtoolsPush"]
    end

    createHooks --> CheckDisabled
    CheckDisabled -->|"да"| RetNull1["return null"]
    CheckDisabled -->|"нет"| CheckDT
    CheckDT -->|"null"| RetNull2["return null"]
    CheckDT -->|"есть"| BuildKey
    BuildKey --> BeforePush
    BeforePush -->|"нет"| StandardPath
    BeforePush -->|"да"| MappedPath
    StandardPath --> RetHook["return SignalLifecycleHook"]
    MappedPath --> RetHook

    style createHooks fill:#6f6,stroke:#333
    style MappedPath fill:#6f6,stroke:#333
```

**Ключевой момент**: `beforeDevtoolsPush` вызывается **внутри** `createSignalHooks()` — в `onInit` и `onChange` возвращаемого хука. Это **то самое место** в коде, где `_skipValues?.includes()` стоит сейчас в `createState()`. Никакого отдельного метода `_createMappedHooks()` нет — логика ветвления inline.

### 3.2. Компонент `State`

`State` в конструкторе:
1. `normalizeSignalOptions(options)` → `SignalOptions<T>`
2. `Devtools.createHooks(initialValue, opts)` → `hooks[0]` или null
3. `opts.hooks` → `hooks[1..N]`
4. Итерация `hooks[].onInit(value)`
5. Регистрация в `FinalizationRegistry` если есть `onDispose`

В `set()`: итерация `hooks[].onChange(value)` внутри `Batcher.run()`, затем `bs$.next()`.

### 3.3. Компонент `Computed`

`Computed` передаёт `beforeDevtoolsPush` в опции внутреннего State:

```typescript
beforeDevtoolsPush: (val, push) => {
    if (val !== Computed._EMPTY) push(val);
}
```

Заменяет `_skipValues: [Computed._EMPTY]`.

---

## 4. Границы модулей и ответственности

| Модуль | Ответственность | Изменение |
|--------|----------------|-----------|
| `src/signals/types/` | Типы: `SignalOptions`, `SignalLifecycleHook`, `SignalOptionsOrKey`, утилита `normalizeSignalOptions()` | **Новое** — замена `StateDevtoolsOptions` для сигналов |
| `src/signals/base/Devtools.ts` | `createSignalHooks()` — создание devtools-хука как `SignalLifecycleHook`. `beforeDevtoolsPush` применяется здесь. | **Новый метод**, `createState()` без изменений |
| `src/signals/signals/State.ts` | Массив `_hooks: SignalLifecycleHook[]`, итерация в constructor / set / FR | **Рефакторинг** — `_stateDevtools` → `_hooks[]` |
| `src/signals/signals/Computed.ts` | Передаёт `beforeDevtoolsPush` callback | **Рефакторинг** — `_skipValues` → `beforeDevtoolsPush` |
| `src/common/devtools/types.ts` | `DevtoolsLike`, `DevtoolsStateLike`. Удалить `StateDevtoolsOptions` (не public API). | Удаление внутреннего типа |
| `src/query/` | `Devtools.createState()` для query | **Без изменений** |

---

## 5. Публичный API

### 5.1. `SignalLifecycleHook<T>`

```typescript
interface SignalLifecycleHook<T = any> {
    onInit?: (value: T) => void;
    onChange?: (newValue: T) => void;
    onDispose?: () => void;
}
```

### 5.2. `SignalOptions<T>`

```typescript
interface SignalOptions<T = any> {
    key?: string;
    /** @deprecated use key */
    name?: string;
    base?: string;
    isDisabled?: boolean;
    beforeDevtoolsPush?: (newValue: T, push: (v: T) => void) => void;
    hooks?: SignalLifecycleHook<T>[];
}
```

### 5.3. `SignalOptionsOrKey<T>`

```typescript
type SignalOptionsOrKey<T = any> = SignalOptions<T> | string;
```

### 5.4. `normalizeSignalOptions()`

```typescript
function normalizeSignalOptions<T>(
    options?: SignalOptionsOrKey<T>
): SignalOptions<T> {
    if (!options) return {};
    if (typeof options === 'string') return { key: options };
    if (options.name && !options.key) {
        return { ...options, key: options.name };
    }
    return options;
}
```

Единственная точка нормализации — заменяет тройную нормализацию в State, Computed, Devtools.createState.

### 5.5. `Devtools.createSignalHooks()`

```typescript
createHooks<T>(
    initialValue: T,
    options: SignalOptions<T>,
): SignalLifecycleHook<T> | null
```

Возвращает один `SignalLifecycleHook<T>` или `null`. Внутри — `beforeDevtoolsPush` вызывается в `onInit` и `onChange`, в том же месте кода, где сейчас `_skipValues?.includes()`.

---

## 6. Точки интеграции

### 6.1. State ↔ Devtools

- **Было**: `State.constructor` → `Devtools.createState()` → `DevtoolsStateLike` (функция), хранится в `_stateDevtools`
- **Стало**: `State.constructor` → `Devtools.createSignalHooks()` → `SignalLifecycleHook`, добавляется как `_hooks[0]`

### 6.2. Computed → State

- **Было**: `Computed` → `State.create(value, { _skipValues: [_EMPTY] })`
- **Стало**: `Computed` → `State.create(value, { beforeDevtoolsPush: (v, push) => v !== _EMPTY && push(v) })`

### 6.3. Query → Devtools (без изменений)

`QueriesLifetimeHooks` → `Devtools.createState()` — интерфейс не меняется.

### 6.4. FinalizationRegistry

- **Было**: FR хранит `DevtoolsStateLike`, callback: `heldValue('$COMPLETED' as any)`
- **Стало**: FR хранит `SignalLifecycleHook[]`, callback: итерация `hooks[].onDispose?.()`

---

## 7. Диаграмма зависимостей модулей

### 7.1. Before

```mermaid
graph LR
    subgraph "src/signals/signals/"
        State["State.ts"]
        Computed["Computed.ts"]
    end

    subgraph "src/signals/base/"
        Devtools["Devtools.ts"]
    end

    subgraph "src/common/devtools/"
        Types["types.ts — StateDevtoolsOptions, DevtoolsLike"]
    end

    subgraph "src/common/options/"
        SharedOpts["SharedOptions.ts"]
    end

    State -->|"StateDevtoolsOptions"| Types
    State -->|"Devtools.createState()"| Devtools
    Computed -->|"StateDevtoolsOptions"| Types
    Computed -->|"State с _skipValues"| State
    Devtools -->|"StateDevtoolsOptions"| Types
    Devtools -->|"SharedOptions.DEVTOOLS"| SharedOpts

    style Types fill:#f96,stroke:#333
```

### 7.2. After

```mermaid
graph LR
    subgraph "src/signals/signals/"
        State["State.ts"]
        Computed["Computed.ts"]
    end

    subgraph "src/signals/types/"
        SigTypes["SignalOptions, SignalLifecycleHook,<br/>SignalOptionsOrKey, normalizeSignalOptions()"]
    end

    subgraph "src/signals/base/"
        Devtools["Devtools.ts — createSignalHooks() + createState()"]
    end

    subgraph "src/common/devtools/"
        Types["types.ts — DevtoolsLike, DevtoolsStateLike"]
    end

    subgraph "src/common/options/"
        SharedOpts["SharedOptions.ts"]
    end

    State -->|"SignalOptions"| SigTypes
    State -->|"Devtools.createSignalHooks()"| Devtools
    Computed -->|"SignalOptions"| SigTypes
    Computed -->|"State с beforeDevtoolsPush"| State
    Devtools -->|"SignalOptions"| SigTypes
    Devtools -->|"DevtoolsLike"| Types
    Devtools -->|"SharedOptions.DEVTOOLS"| SharedOpts

    style SigTypes fill:#6f6,stroke:#333
    style Devtools fill:#6f6,stroke:#333
```

**Изменения**:
- `State`, `Computed` импортируют из `src/signals/types/` вместо `src/common/devtools/types.ts`
- `Devtools.ts` импортирует `SignalOptions` из `src/signals/types/` для `createSignalHooks()`
- `StateDevtoolsOptions` удаляется из `src/common/devtools/types.ts` (не public API — не breaking change)
- `Devtools.ts` сохраняет локальный тип для `createState()` (query)

---

## 8. Иерархия типов

```mermaid
classDiagram
    class SignalLifecycleHook~T~ {
        +onInit?(value: T): void
        +onChange?(newValue: T): void
        +onDispose?(): void
    }

    class SignalOptions~T~ {
        +key?: string
        +name?: string «deprecated»
        +base?: string
        +isDisabled?: boolean
        +beforeDevtoolsPush?(newValue: T, push: fn): void
        +hooks?: SignalLifecycleHook~T~[]
    }

    class SignalOptionsOrKey~T~ {
        «union»
        SignalOptions~T~ | string
    }

    class DevtoolsLike {
        «interface»
        +state~T~(name: string, initState: T): DevtoolsStateLike~T~
    }

    class DevtoolsStateLike~T~ {
        «interface»
        +(newState: T): void
    }

    SignalOptionsOrKey --> SignalOptions : содержит
    SignalOptions --> SignalLifecycleHook : hooks — массив
    SignalOptions ..> DevtoolsStateLike : beforeDevtoolsPush контролирует push
```
