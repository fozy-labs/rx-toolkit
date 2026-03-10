# Потоки данных в Query-модуле

## 1. Обзор

Этот документ описывает потоки данных через ключевые компоненты `src/query/`. Понимание этих потоков критически важно для написания тестов и верификации корректности.

## 2. Жизненный цикл Resource-запроса

### 2.1 Основной поток: создание → запрос → кэш → очистка

```mermaid
sequenceDiagram
    participant Consumer as Потребитель
    participant API as createResource()
    participant Res as Resource
    participant Cache as QueriesCache
    participant RCache as ReactiveCache
    participant Hooks as QueriesLifetimeHooks

    Consumer->>API: createResource({ queryFn, cacheLifetime })
    API->>Res: new Resource(definition)
    Res->>Cache: new QueriesCache(cacheLifetime)
    Res->>Hooks: new QueriesLifetimeHooks(hooks)

    Note over Consumer: Потребитель вызывает initiate(args)
    Consumer->>Res: initiate(args)
    Res->>Cache: getOrCreate(args)
    Cache->>RCache: new ReactiveCache(args)
    RCache-->>Cache: cache entry
    Res->>Hooks: onQueryStarted({ args, $queryFulfilled })

    Note over Res: Выполняется queryFn
    Res->>Res: queryFn(args, { abortSignal })

    alt Успех
        Res->>Cache: cache.next(successState)
        Cache->>RCache: subject.next(successState)
        Hooks->>Hooks: $queryFulfilled resolves
    else Ошибка
        Res->>Cache: cache.next(errorState)
        Hooks->>Hooks: $queryFulfilled rejects
        Hooks->>Hooks: SharedOptions.onQueryError(error)
    end

    Note over RCache: По истечении cacheLifetime
    RCache->>RCache: timer → complete()
    RCache->>Cache: удаление из Map
```

### 2.2 Повторный запрос и abort

```mermaid
sequenceDiagram
    participant Consumer as Потребитель
    participant Res as Resource
    participant AC1 as AbortController #1
    participant AC2 as AbortController #2
    participant Cache as QueriesCache

    Consumer->>Res: initiate(args) — первый запрос
    Res->>AC1: new AbortController()
    Res->>Res: queryFn(args, { abortSignal: AC1.signal })

    Note over Consumer: Args изменились до ответа
    Consumer->>Res: initiate(newArgs)
    Res->>AC1: abort() — отмена предыдущего
    Res->>AC2: new AbortController()
    Res->>Res: queryFn(newArgs, { abortSignal: AC2.signal })

    AC1-->>Res: Aborted (игнорируется)
    Res->>Cache: cache.next(successState) для newArgs
```

## 3. Транзакционная модель ResourceRef

### 3.1 Patch → Commit → Success

```mermaid
sequenceDiagram
    participant Consumer as Потребитель
    participant Ref as ResourceRef
    participant Immer as immer (produceWithPatches)
    participant Res as Resource
    participant Cache as ReactiveCache

    Consumer->>Ref: createRef(args) — получить ref
    Note over Ref: ref привязан к конкретному cache entry

    Consumer->>Ref: patch(recipe)
    Ref->>Immer: produceWithPatches(currentData, recipe)
    Immer-->>Ref: [nextData, patches, inversePatches]
    Ref->>Ref: Сохранить transaction { patches, inversePatches }
    Ref->>Cache: next(patchedState) — оптимистичное обновление UI

    Note over Consumer: Отправка на сервер...
    Consumer->>Ref: commit()
    Ref->>Ref: Перенести transaction в committed
    Note over Ref: Данные закреплены

    Note over Res: Сервер вернул новые данные
    Res->>Cache: next(serverState)
    Ref->>Ref: reapply() — переприменить pending транзакции поверх серверных данных
```

### 3.2 Patch → Abort (откат)

```mermaid
sequenceDiagram
    participant Consumer as Потребитель
    participant Ref as ResourceRef
    participant Immer as immer (applyPatches)
    participant Cache as ReactiveCache

    Consumer->>Ref: patch(recipe)
    Ref->>Cache: next(patchedState) — оптимистично

    Note over Consumer: Сервер вернул ошибку
    Consumer->>Ref: abort()
    Ref->>Immer: applyPatches(data, inversePatches)
    Immer-->>Ref: rolledBackData
    Ref->>Cache: next(originalState) — откат UI
    Ref->>Ref: Удалить transaction
```

### 3.3 Reapply — переприменение при обновлении сервера

```mermaid
sequenceDiagram
    participant Server as Сервер
    participant Res as Resource
    participant Ref as ResourceRef
    participant Cache as ReactiveCache

    Note over Ref: У Ref есть pending transaction (patch applied)
    Server->>Res: success(freshData)
    Res->>Cache: next(freshState)

    Note over Ref: Ref перехватывает обновление
    Ref->>Ref: Взять freshData как base
    Ref->>Ref: Применить committed patches
    Ref->>Ref: Применить pending patches
    Ref->>Cache: next(mergedState) — fresh + pending
```

## 4. Жизненный цикл Command и Link-система

### 4.1 Command → Resource linking

```mermaid
sequenceDiagram
    participant Consumer as Потребитель
    participant Cmd as Command
    participant CmdAgent as CommandAgent
    participant Res as Resource
    participant Ref as ResourceRef

    Consumer->>Cmd: createCommand({ queryFn, link: { resource, ... } })
    Note over Cmd: Link связывает Command с Resource

    Consumer->>CmdAgent: initiate(mutationArgs)
    CmdAgent->>Cmd: queryFn(mutationArgs)

    alt link.optimisticUpdate определён
        CmdAgent->>Ref: patch(optimisticUpdate)
        Note over Ref: UI обновлён оптимистично
    end

    alt Мутация успешна
        Cmd-->>CmdAgent: result
        alt link.update определён
            CmdAgent->>Ref: patch(link.update(result))
            CmdAgent->>Ref: commit()
        end
        alt link.invalidate = true
            CmdAgent->>Res: initiate(args) — перезапрос
        end
    else Мутация неуспешна
        Cmd-->>CmdAgent: error
        CmdAgent->>Ref: abort() — откат оптимистичного
    end
```

## 5. Жизненный цикл кэша

### 5.1 ReactiveCache — таймер и очистка

```mermaid
stateDiagram-v2
    [*] --> Created: new ReactiveCache()
    Created --> Active: subscribe() / next()
    Active --> Active: next(newValue)
    Active --> Idle: все подписчики отписались (refCount = 0)
    Idle --> TimerRunning: запуск timer(cacheLifetime)
    TimerRunning --> Active: новый subscribe()
    TimerRunning --> Completed: timer истёк
    Completed --> [*]: complete() — удаление из QueriesCache
```

### 5.2 QueriesCache — управление entries

```mermaid
flowchart TD
    A[getOrCreate args] --> B{Есть в IndirectMap?}
    B -->|Да| C[Вернуть существующий ReactiveCache]
    B -->|Нет| D[Создать новый ReactiveCache]
    D --> E[Добавить в IndirectMap]
    E --> F[Подписать onCacheEntryAdded hooks]
    F --> C

    G[ReactiveCache.complete] --> H[Удалить из IndirectMap]
    H --> I[Cleanup hooks]
```

## 6. ResourceDuplicator — агрегация

```mermaid
sequenceDiagram
    participant Consumer as Потребитель
    participant Dup as ResourceDuplicator
    participant Res1 as Resource A
    participant Res2 as Resource B
    participant CompCache as ComputedReactiveCache

    Consumer->>Dup: createResourceDuplicator([resA, resB], { getArgs })
    Consumer->>Dup: initiate(masterArgs)

    Dup->>Dup: getArgs(masterArgs) → [argsA, argsB]
    Dup->>Res1: initiate(argsA)
    Dup->>Res2: initiate(argsB)

    Res1-->>CompCache: dataA
    Res2-->>CompCache: dataB
    CompCache->>CompCache: combine(dataA, dataB)
    CompCache-->>Consumer: aggregatedState
```

## 7. SKIP Token

```mermaid
flowchart TD
    A[useResourceAgent args] --> B{args === SKIP?}
    B -->|Да| C[Не вызывать initiate]
    C --> D[Вернуть предыдущее состояние]
    B -->|Нет| E[Сравнить с prevArgs]
    E --> F{Args изменились?}
    F -->|Да| G[initiate newArgs]
    F -->|Нет| H[Вернуть текущее состояние]
```
