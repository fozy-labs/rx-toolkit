# 02 — Data Flow тестов через реактивную систему

## Обзор

Тестирование реактивной системы требует понимания потоков данных: как изменения сигналов распространяются через Batcher, как computed пересчитываются, как эффекты срабатывают. Этот документ описывает потоки данных с точки зрения тестирования.

Основание: [анализ кодовой базы](../01-research/01-codebase-analysis.md), [best practices](../01-research/02-external-research.md).

## Жизненный цикл теста

```mermaid
stateDiagram-v2
    [*] --> Setup: beforeEach
    Setup --> Arrange: Создание сигналов
    Arrange --> Act: Мутация / подписка
    Act --> BatchProcess: Batcher.run() / Scheduled.run()
    BatchProcess --> Assert: Проверка состояния
    Assert --> Teardown: afterEach
    Teardown --> [*]: cleanup подписок, reset синглтонов

    state Setup {
        [*] --> ResetSharedOptions
        ResetSharedOptions --> ResetDependencyTracker
    }

    state Teardown {
        [*] --> UnsubscribeAll
        UnsubscribeAll --> AssertBatcherUnlocked
        AssertBatcherUnlocked --> [*]
    }
```

## Ключевые потоки данных

### 1. State → подписчик (простейший поток)

```mermaid
sequenceDiagram
    participant Test
    participant State
    participant BehaviorSubject
    participant Batcher
    participant Scheduled

    Test->>State: State.create(initialValue)
    State->>BehaviorSubject: new BehaviorSubject(initialValue)

    Test->>State: signal.set(newValue)
    State->>Batcher: Batcher.run(() => ...)
    Batcher->>Scheduled: isLocked = true
    Batcher->>BehaviorSubject: bs$.next(newValue)
    Batcher->>Scheduled: run()
    Note over Scheduled: Выполнение запланированных эффектов
    Batcher->>Scheduled: isLocked = false

    Test->>State: signal.peek()
    State-->>Test: newValue (из BehaviorSubject)
```

**Что тестировать:**
- `peek()` возвращает текущее значение синхронно
- `set()` обновляет значение
- Одинаковые значения (`===`) не вызывают обновление
- `obs` возвращает Observable, который эмитит значения

### 2. State → Computed → Effect (реактивная цепочка)

```mermaid
sequenceDiagram
    participant Test
    participant StateA as State A
    participant Computed as Computed C
    participant Effect as Effect E
    participant Batcher
    participant Scheduled

    Note over Test: Arrange
    Test->>StateA: State.create(1)
    Test->>Computed: Computed.create(() => A() * 2)
    Test->>Effect: Effect.create(() => { log(C()) })

    Note over Effect: Effect запускается немедленно
    Effect->>Computed: C() → tracked read
    Computed->>StateA: A() → tracked read
    StateA-->>Computed: value = 1
    Computed-->>Effect: value = 2
    Note over Effect: log(2), подписка на A через DependencyTracker

    Note over Test: Act
    Test->>StateA: A.set(5)
    StateA->>Batcher: Batcher.run(...)
    Batcher->>Scheduled: isLocked = true
    Batcher->>Scheduled: планирует Effect (rang=1)
    Batcher->>Scheduled: run()
    
    Note over Scheduled: Выполняет по рангам
    Scheduled->>Effect: re-run effectFn
    Effect->>Computed: C() → tracked read
    Computed->>StateA: A() → peek
    StateA-->>Computed: value = 5
    Computed-->>Effect: value = 10
    Note over Effect: log(10)
    
    Batcher->>Scheduled: isLocked = false

    Note over Test: Assert
    Test->>Computed: C.peek()
    Computed-->>Test: 10 ✓
```

**Что тестировать:**
- Computed пересчитывается при изменении зависимости
- Effect получает обновлённое значение
- Порядок: сначала Computed, затем Effect (через систему рангов)
- Промежуточные состояния НЕ наблюдаются Effect'ом

### 3. Diamond Problem (glitch-free guarantee)

```mermaid
sequenceDiagram
    participant Test
    participant A as State A
    participant B as Computed B<br/>(A * 2)
    participant C as Computed C<br/>(A + 10)
    participant D as Effect D<br/>(B + C)
    participant Batcher
    participant Scheduled

    Note over Test: Arrange: A=1, B=2, C=11, D видит B+C=13

    Note over Test: Act: A.set(5)
    Test->>A: A.set(5)
    A->>Batcher: Batcher.run(...)
    
    Note over Batcher: isLocked = true

    Note over Scheduled: ⚠️ Ключевой момент: B и C<br/>обновляются ДО D

    Scheduled->>D: re-run effectFn
    D->>B: B() → peeked/recomputed = 10
    D->>C: C() → peeked/recomputed = 15
    Note over D: Видит B=10, C=15 → 25 ✅ (consistent)
    Note over D: НЕ видит B=10, C=11 → 21 ❌ (glitch)

    Note over Test: Assert: D получил consistent state
```

**Что тестировать:**
- При обновлении `A` Effect `D` видит обновлённые `B` И `C` одновременно
- Промежуточное состояние {B=new, C=old} **не наблюдается**
- Это гарантируется системой рангов: Computed (rang 0+) выполняются перед Effect (rang > computed)

### 4. Batcher: обработка ошибок (критический фикс)

```mermaid
stateDiagram-v2
    [*] --> Unlocked: начальное состояние
    Unlocked --> Locked: Batcher.run(fn)
    Locked --> Processing: fn() завершился
    Processing --> Unlocked: Scheduled.run() + unlock
    
    Locked --> ERROR_STUCK: fn() бросил исключение
    Note right of ERROR_STUCK: ⚠️ ТЕКУЩЕЕ ПОВЕДЕНИЕ<br/>isLocked навсегда true

    Locked --> ErrorRecovery: fn() бросил (ПОСЛЕ ФИКСА)
    ErrorRecovery --> Unlocked: finally { isLocked = false }
    
    state ErrorRecovery {
        [*] --> RunScheduled: Scheduled.run()
        RunScheduled --> Unlock: isLocked = false
        Unlock --> RethrowError
    }
```

**Критический фикс** (см. [ADR-2](./04-decisions.md#adr-2)): `Batcher.run()` должен использовать `try/finally` для гарантии разблокировки. Текущий код ([Batcher.ts](../01-research/01-codebase-analysis.md#basebatcherts)):

```typescript
// ТЕКУЩИЙ (сломанный)
run<T>(fn: () => T) {
    if (Scheduled.isLocked) return fn();
    Scheduled.isLocked = true;
    const v = fn();         // ← если бросит, isLocked навсегда true
    Scheduled.run();
    Scheduled.isLocked = false;
    return v;
}

// ПОСЛЕ ФИКСА
run<T>(fn: () => T) {
    if (Scheduled.isLocked) return fn();
    Scheduled.isLocked = true;
    try {
        const v = fn();
        Scheduled.run();
        return v;
    } finally {
        Scheduled.isLocked = false;
    }
}
```

**Тесты для этого фикса:**
- `fn()` бросает → `isLocked` сбрасывается → следующий `Batcher.run()` работает
- `fn()` бросает → исключение пробрасывается наверх
- `Scheduled.run()` бросает → `isLocked` сбрасывается

### 5. Computed: ленивое вычисление и кеш

```mermaid
stateDiagram-v2
    [*] --> Idle: Computed.create(fn)
    
    state "Без подписки (peek)" as PeekMode {
        Idle --> CacheCheck: .peek()
        CacheCheck --> CacheHit: кеш валиден
        CacheCheck --> CacheMiss: кеш невалиден
        CacheMiss --> Idle: вычислено через ComputeCache
        CacheHit --> Idle: возврат кешированного
    }
    
    state "С подпиской (.obs)" as SubMode {
        Idle --> Active: .obs подписка
        Active --> Recompute: зависимость изменилась
        Recompute --> Active: новое значение через Effect
        Active --> Idle: refCount → 0
    }
```

**Что тестировать:**
- `peek()` БЕЗ подписки → вычисление через `ComputeCache`
- `peek()` С подпиской → возврат из внутреннего `State`
- Переход из режима peek → подписка → обратно в peek
- Кеш инвалидируется при изменении зависимости

### 6. Effect: tracked context и teardown

```mermaid
sequenceDiagram
    participant Test
    participant Effect
    participant DependencyTracker as DependencyTracker
    participant StateA as State A
    participant StateB as State B

    Test->>Effect: Effect.create(effectFn)
    Effect->>DependencyTracker: start(handler)
    Note over DependencyTracker: _currentHandler = handler

    Effect->>StateA: A() → read
    StateA->>DependencyTracker: track(A)
    DependencyTracker-->>Effect: A добавлен в deps

    Effect->>StateB: B() → read
    StateB->>DependencyTracker: track(B)
    DependencyTracker-->>Effect: B добавлен в deps

    Effect->>DependencyTracker: stop()
    Note over DependencyTracker: _currentHandler = null

    Note over Effect: Подписан на A и B
    Note over Effect: При изменении A или B → re-run

    Test->>Effect: effect.unsubscribe()
    Note over Effect: Cleanup: отписка от A и B
```

**Что тестировать:**
- Effect автоматически отслеживает прочитанные сигналы
- При изменении любой зависимости Effect перезапускается
- `unsubscribe()` полностью очищает подписки
- Teardown-функция (возврат из `effectFn`) вызывается перед re-run

## Тестирование microtask timing

Файл `useSignal.ts` использует `queueMicrotask` для оптимизации обновлений React. Это требует специальных подходов:

```typescript
// Утилита для ожидания microtasks в тестах
export function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => queueMicrotask(resolve));
}

// Использование в тесте
it('обновляет React при изменении сигнала', async () => {
  const state = Signal.state(1);
  const { result } = renderHook(() => useSignal(state));
  
  expect(result.current).toBe(1);
  
  act(() => { state.set(2); });
  await flushMicrotasks();
  
  expect(result.current).toBe(2);
});
```

## Утилита тестирования: signal-helpers

```typescript
// src/__tests__/helpers/signal-helpers.ts

/**
 * Собирает все значения, эмитированные сигналом.
 * Удобно для проверки последовательности обновлений.
 */
export function collectValues<T>(signal: ReadableSignalLike<T>): {
  values: T[];
  unsubscribe: () => void;
} {
  const values: T[] = [];
  const sub = signal.obs.subscribe(v => values.push(v));
  return { values, unsubscribe: () => sub.unsubscribe() };
}

/**
 * Создаёт "шпион" для Effect — подсчитывает количество вызовов.
 */
export function spyEffect(effectFn: () => void): {
  effect: SubscriptionLike;
  callCount: () => number;
} {
  let count = 0;
  const effect = Effect.create(() => { count++; effectFn(); });
  return { effect, callCount: () => count };
}
```
