# 07 — Доменная модель сигнальной системы

## Обзор

Документ описывает ключевые сущности реактивной системы `rx-toolkit`, их отношения, инварианты и бизнес-правила. Модель основана на анализе кодовой базы ([01-codebase-analysis](../01-research/01-codebase-analysis.md)) и паттернах из экосистемы ([02-external-research](../01-research/02-external-research.md)).

---

## Диаграмма классов

```mermaid
classDiagram
    class ReadableSignalLike~T~ {
        <<interface>>
        +peek() T
        +obs Observable~T~
    }

    class WriteableSignalLike~T~ {
        <<interface>>
        +set(value: T) void
    }

    class ClearableSignalLike~T~ {
        <<interface>>
        +clear() void
    }

    class StatefulSignalFn~T~ {
        <<interface>>
        +() T
        +peek() T
        +set(value: T) void
        +clear() void
        +obs Observable~T~
    }

    class ComputeFn~T~ {
        <<interface>>
        +() T
        +peek() T
        +obs Observable~T~
    }

    class SignalFn~T~ {
        <<interface>>
        +() T
        +peek() T
        +set(value: T) void
        +obs Observable~T~
    }

    ReadableSignalLike <|-- StatefulSignalFn
    WriteableSignalLike <|-- StatefulSignalFn
    ClearableSignalLike <|-- StatefulSignalFn
    ReadableSignalLike <|-- ComputeFn
    ReadableSignalLike <|-- SignalFn
    WriteableSignalLike <|-- SignalFn

    class State~T~ {
        -bs$ BehaviorSubject~T~
        -_options StateDevtoolsOptions
        +set(value: T) void
        +peek() T
        +clear() void
        +obs SyncObservable~T~
        +create(initial, options?)$ StatefulSignalFn~T~
    }

    class Computed~T~ {
        -_computeCache ComputeCache~T~
        -_state State~T~ | null
        -_effect Effect | null
        +peek() T
        +obs Observable~T~
        +create(computeFn, options?)$ ComputeFn~T~
    }

    class Effect {
        -_effectFn Function
        -_subscriptions SubscriptionLike[]
        -_scheduler Scheduler | null
        -_rang number
        +unsubscribe() void
        +complete() void «deprecated»
        +create(effectFn)$ SubscriptionLike
    }

    class Signal~T~ {
        «deprecated constructor»
        +state(initial, options?)$ StatefulSignalFn~T~
        +compute(computeFn, options?)$ ComputeFn~T~
        +effect(effectFn)$ SubscriptionLike
    }

    class LocalState~T~ {
        -_driver StorageDriver
        -_schema ZodSchema
        +set(value: T) void
        +peek() T
        +clear() void
        +create(options)$ StatefulSignalFn~T~
    }

    State <|-- Signal : extends
    State --> BehaviorSubject : использует
    State --> SyncObservable : оборачивает obs
    State --> Batcher : set() через Batcher.run()
    State --> Devtools : devtools integration
    Computed --> ComputeCache : peek() без подписки
    Computed --> State : внутренний State при подписке
    Computed --> Effect : внутренний Effect при подписке
    Effect --> DependencyTracker : автотрекинг
    Effect --> Batcher : scheduler через Batcher.scheduler()
    LocalState --> State : extends / аналогичен
    Signal --> State : state()
    Signal --> Computed : compute()
    Signal --> Effect : effect()
```

---

## Инфраструктурные компоненты

```mermaid
classDiagram
    class Batcher {
        +run(fn) T$
        +scheduler(rang) Scheduler$
    }

    class Scheduled {
        <<singleton>>
        -map Map~number, Set~Function~~
        -lowestRang number
        -isLocked boolean
        +run() void
        +done() void
    }

    class ComputeCache~T~ {
        -_computeFn Function
        -_dependencies DependencyRecord[]
        -_cachedValue T
        +getOrCompute() T
        +isValid() boolean
    }

    class DependencyTracker {
        <<singleton>>
        -_currentHandler TrackHandler | null
        +start(handler) void
        +stop() StopResult
        +track(dep) void
    }

    class Devtools {
        <<singleton>>
        +createState(options) DevtoolsStateLike | null
    }

    class Indexer {
        <<singleton>>
        +currentIndex number
    }

    class SyncObservable~T~ {
        -_source Observable~T~
        +value T
        +subscribe() Subscription
        +pipe() Observable
    }

    class ReadonlySignal~T~ {
        +peek() T
        +obs Observable~T~
        +create(subscribe)$ ReadableSignalFnLike~T~
    }

    Batcher --> Scheduled : управляет
    Batcher --> Indexer : для рангов
    Computed --> ComputeCache : кеширование
    Effect --> DependencyTracker : отслеживание
    State --> Devtools : регистрация
    Devtools --> Indexer : уникальные ключи
    ReadonlySignal --> SyncObservable : obs property
```

---

## Ключевые сущности

### State (мутабельный сигнал)

**Роль**: Основной примитив для хранения изменяемого состояния.

**Инварианты**:
- `peek()` всегда возвращает текущее значение синхронно
- `set(v)` при `v === currentValue` (referential equality) — NO-OP
- `set(v)` всегда оборачивается в `Batcher.run()` — гарантия батчинга
- `obs` — горячий Observable (BehaviorSubject), эмитит текущее значение при подписке
- `clear()` сбрасывает к начальному значению

### Computed (вычисляемый сигнал)

**Роль**: Производное значение, автоматически зависящее от других сигналов.

**Инварианты**:
- Ленивый: `computeFn` НЕ вызывается до первого чтения
- `peek()` без подписки — вычисляет через `ComputeCache` (синхронно)
- `peek()` с подпиской — возвращает из внутреннего `State`
- Кеш валиден пока зависимости не изменились
- При подписке через `.obs` — создаётся внутренний Effect для реактивности
- `resetOnRefCountZero: true` — при 0 подписчиков внутренний Effect уничтожается
- Rang > rang зависимостей (гарантия порядка батчинга)

### Effect (побочный эффект)

**Роль**: Выполнение побочных действий при изменении зависимостей.

**Инварианты**:
- `effectFn` выполняется немедленно при создании
- Автоматический tracked context — все прочитанные сигналы становятся зависимостями
- При изменении любой зависимости — `effectFn` перезапускается
- Возвращаемая функция из `effectFn` — teardown, вызывается ПЕРЕД перезапуском
- `unsubscribe()` — полная очистка, последний teardown вызывается
- Rang Effect > rang всех его зависимостей (Computed включительно)

### Batcher (менеджер батчинга)

**Роль**: Группировка обновлений для предотвращения glitch.

**Инварианты**:
- `isLocked === true` → все `set()` вызовы выполняются напрямую (без повторного батчинга)
- После `fn()` → `Scheduled.run()` выполняет запланированные эффекты по рангам
- Порядок выполнения: rang 0 → rang 1 → ... → rang Infinity (devtools)
- **ПОСЛЕ ФИКСА**: `try/finally` гарантирует `isLocked = false` при ошибке

### ComputeCache (кеш вычислений)

**Роль**: Кеширование результата `computeFn` для `peek()` без подписки.

**Инварианты**:
- Кеш валиден ↔ все зависимости не изменились (`dep.peek() === cached_dep_value`)
- При невалидном кеше — пересчёт через `computeFn` с новым `DependencyTracker` scope
- Ошибка в `computeFn` — зависимости частично записаны, кеш невалиден (корректно)

### DependencyTracker (отслеживание зависимостей)

**Роль**: Stack-based система отслеживания чтений сигналов.

**Инварианты**:
- `start()` → сохраняет предыдущий handler, устанавливает новый
- `track(dep)` → добавляет зависимость в текущий handler
- `stop()` → восстанавливает предыдущий handler, возвращает зависимости
- Вложенные tracked contexts корректны (stack save/restore)
- `peek()` НЕ вызывает `track()` — чтение без отслеживания

---

## Граф зависимостей между сущностями

```mermaid
graph TD
    User["Пользовательский код"]
    
    User -->|"Signal.state()"| State
    User -->|"Signal.compute()"| Computed
    User -->|"Signal.effect()"| Effect
    User -->|"useSignal()"| UseSignal
    
    State -->|"set() →"| Batcher
    Batcher -->|"управляет"| Scheduled
    Scheduled -->|"выполняет по рангам"| Effect
    
    Computed -->|"peek() →"| ComputeCache
    ComputeCache -->|"вычисляет с трекингом"| DependencyTracker
    Computed -->|"obs подписка →"| InternalEffect["Effect (внутренний)"]
    InternalEffect -->|"автотрекинг"| DependencyTracker
    
    Effect -->|"автотрекинг"| DependencyTracker
    DependencyTracker -->|"track()"| State
    DependencyTracker -->|"track()"| Computed
    
    UseSignal -->|"useSyncExternalStore"| React["React"]
    UseSignal -->|"subscribe"| State
    UseSignal -->|"subscribe"| Computed
    
    State -->|"devtools"| Devtools
    Devtools -->|"ключи"| Indexer
    Devtools -->|"настройки"| SharedOptions
    
    style Batcher fill:#ff9999
    style Scheduled fill:#ff9999
    style DependencyTracker fill:#99ccff
    style ComputeCache fill:#99ccff
```

---

## Типы TypeScript

```typescript
// Ключевые интерфейсы (из src/signals/types/signals.types.ts)

interface ReadableSignalLike<T> {
  peek(): T;
  readonly obs: Observable<T>;
}

interface WriteableSignalLike<T> {  // Примечание: "Writeable" — опечатка
  set(value: T): void;
}

interface ClearableSignalLike<T> {
  clear(): void;
}

// Составные типы — функции с методами
type StatefulSignalFn<T> = (() => T) &
  ReadableSignalLike<T> &
  WriteableSignalLike<T> &
  ClearableSignalLike<T>;

type ComputeFn<T> = (() => T) & ReadableSignalLike<T>;

type SignalFn<T> = (() => T) &
  ReadableSignalLike<T> &
  WriteableSignalLike<T>;

// Devtools
interface DevtoolsLike {
  createState(key: string, initialValue?: unknown): DevtoolsStateLike | null;
}

type DevtoolsStateLike = (newState: unknown) => void;

// DependencyTracker
interface DependencyRecord {
  dep: ReadableSignalLike<unknown>;
  meta: unknown;
}
```

---

## Бизнес-правила (для тестирования)

| # | Правило | Где проверять |
|---|---------|--------------|
| BR-1 | `State.set(v)` при `v === current` — не эмитит | `State.test.ts` |
| BR-2 | `Computed` вычисляется лениво | `Computed.test.ts` |
| BR-3 | `Computed.peek()` возвращает кешированное при валидном кеше | `ComputeCache.test.ts` |
| BR-4 | `Effect` автоматически собирает зависимости | `Effect.test.ts` |
| BR-5 | `Effect` перезапускается при изменении ЛЮБОЙ зависимости | `Effect.test.ts` |
| BR-6 | `Batcher.run()` — эффекты выполняются ПОСЛЕ всех set() | `Batcher.test.ts` |
| BR-7 | Система рангов: rang(Effect) > rang(Computed) > rang(State) | Integration |
| BR-8 | Diamond problem → consistent state (no glitch) | Integration |
| BR-9 | `peek()` НЕ создаёт зависимость в tracked context | `State.test.ts` |
| BR-10 | `Effect.unsubscribe()` → teardown + отписка от всех deps | `Effect.test.ts` |
| BR-11 | `Computed` при 0 подписчиков → уничтожение внутреннего Effect | `Computed.test.ts` |
| BR-12 | `Batcher.run()` при ошибке → `isLocked` сбрасывается (ПОСЛЕ ФИКСА) | `Batcher.test.ts` |
