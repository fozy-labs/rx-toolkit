# Потоки данных

Диаграммы описывают основные сценарии взаимодействия компонентов модуля Query.


---

## Потоки ресурса (Resource)

> Разделы ниже описывают потоки, специфичные для ресурсов. Команды используют упрощённый поток — см. «Мутация».

### Cache miss


```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useResource
    participant Agent as Agent
    participant Res as Resource
    participant Cache as CacheMap
    participant Entry as QueryCacheEntry
    participant Query as queryFn
    participant BQ as beforeQuery
    participant Sync as SyncDriver

    UI->>Hook: useResource(args)
    Hook->>Agent: set(args)

    Note over Agent: Создание Signal.computed

    Agent->>Res: getEntry$(keyedArgs, doInitiate=false)

    Res->>Cache: get(key)
    Cache-->>Res: null (нет записи)
    Res-->>Agent: null
    Agent-->>Hook: pending
    Hook-->>UI: { status: pending }

    Note over Hook: useIsomorphicLayoutEffect срабатывает

    opt синхронно
        Hook->>Agent: start()
        Agent->>Res: trigger(keyedArgs, doForce=false)
        Res-->>Res: _getOrCreate(keyedArgs, doForce=false)
        Res->>Cache: get(key)
        Cache-->>Res: null
        Res->>Entry: new Entry(options)

        opt beforeQuery настроен (sync: true)
            Res->>BQ: beforeQuery(key, keyedArgs)
            BQ->>Sync: REQ { keys, reqId }
            Note over Sync: BroadcastChannel.postMessage
            Sync-->>BQ: RES { data } или таймаут

            alt данные получены
                BQ-->>Entry: hydrate(data)
                Entry->>Entry: → success (без сетевого запроса)
                Entry-->>Agent: machine$ → success
                Agent-->>Hook: success
                Hook-->>UI: { status: success, data }
            else таймаут
                BQ-->>Res: null
                Note over Res: queryFn вызывается далее
            end
        end

        Entry->>Query: queryFn(args, abortSignal)
        Query-->>Entry: Promise (pending)
        Entry-->>Res: Entry (pending)

        Res->>Cache: set(key, entry)
    
        Cache-->>Res: Entry (pending)

        opt Отработка реактивной зависимости (null → Entry)
            Res -->> Res: lastEntry.set(Entry)
            Res-->>Agent: $: Entry (pending)
            Agent-->>Agent: Подписка на machine$ (pending)
            Note over Agent: return stable(prev, next)
        end

        Res -->> Agent: void
        Agent-->>Hook: void
    end

    Note over Query: Ожидание

    alt ответ OK
        Query-->>Entry: data
        Entry->>Entry: → success
        Entry-->>Agent: machine$ → success
        Agent-->>Hook: success
        Hook-->>UI: { status: success, data }
    else ошибка
        Query-->>Entry: error
        Entry->>Entry: → error
        Entry-->>Agent: machine$ → error
        Agent-->>Hook: error
        Hook-->>UI: { status: error, error }
    end
```

### Cache hit


```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useResource
    participant Agent as Agent
    participant Res as Resource
    participant Cache as CacheMap

    UI->>Hook: useResource(args)
    Hook->>Agent: set(args)
    Note over Agent: Создание Signal.computed
    Agent->>Res: getEntry$(keyedArgs, doInitiate=false)
    Res->>Cache: get(key)
    Cache-->>Res: Entry
    Res-->>Agent: Entry
    Agent-->>Agent: Подписка на machine$
    Agent-->>Hook: state
    Hook-->>UI: state
```

### Условный запрос (SKIP → реальные args)


```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useResource
    participant Agent as Agent
    participant Res as Resource

    UI->>Hook: useResource(SKIP)
    Hook->>Agent: set(SKIP)
    Note over Agent: → idle (запись не создаётся)
    Agent-->>Hook: idle
    Hook-->>UI: { status: idle }

    Note over UI: зависимые данные готовы

    UI->>Hook: useResource(args)
    Hook->>Agent: set(args)
    Agent->>Res: getEntry$(keyedArgs, doInitiate=false)

    Res-->>Agent: Entry или null

    Note over Agent: → поток «Cache miss» или «Cache hit»
```

### Refresh / фоновое обновление

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useResource
    participant Agent as Agent
    participant Entry as QueryCacheEntry
    participant Query as queryFn

    Note over Entry: machine: success (data v1)

    UI->>Hook: refresh()
    Hook->>Agent: refresh()
    Agent->>Entry: refresh()
    Entry->>Entry: success → refreshing
    Entry-->>Agent: machine$ → refreshing
    Agent-->>Hook: refreshing
    Hook-->>UI: { status: refreshing, data: v1 }

    Entry->>Query: queryFn(args, abortSignal)

    alt ответ OK
        Query-->>Entry: data v2
        Entry->>Entry: refreshing → success (rebase)
        Entry-->>Agent: machine$ → success
        Agent-->>Hook: success
        Hook-->>UI: { status: success, data: v2 }
    else ошибка
        Query-->>Entry: error
        Entry->>Entry: refreshing → refresh-error (fail)
        Entry-->>Agent: machine$ → refresh-error
        Agent-->>Hook: refresh-error
        Hook-->>UI: { status: refresh-error, data: v1, error }
    end
```

### SWR-fallback при смене аргументов


```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useResource
    participant Agent as Agent
    participant Res as Resource
    participant Entry2 as QueryCacheEntry (user/2)

    Note over Agent: current = Entry1 (success, data/1)

    UI->>Hook: useResource({ id: 2 })
    Hook->>Agent: set({ id: 2 })
    Agent->>Agent: prev = Entry1, current = null

    Agent->>Res: getEntry$(keyedArgs, doInitiate=false)
    Res-->>Agent: null

    Note over Agent,Entry2: → поток «Cache miss» для { id: 2 }

    Note over Agent: Реактивная зависимость: Entry2 (pending)
    Agent-->>Agent: Подписка на machine$ (pending)

    Note over Agent: pending + prev → refreshing (SWR)
    Agent-->>Hook: refreshing
    Hook-->>UI: { status: refreshing, data: data/1 }

    alt ответ OK
        Entry2->>Entry2: → success
        Entry2-->>Agent: machine$ → success
        Agent->>Agent: prev = null
        Agent-->>Hook: success
        Hook-->>UI: { status: success, data: data/2 }
    else ошибка
        Entry2->>Entry2: → error
        Entry2-->>Agent: machine$ → error
        Note over Agent: error не маскируется, prev (Entry1) сохраняется
        Agent-->>Hook: error
        Hook-->>UI: { status: error, data: data/1, error }
    end
```

### Дедупликация параллельных запросов


```mermaid
sequenceDiagram
    participant Agent as Потребитель B (например Agent)
    participant Res as Resource
    participant Cache as CacheMap

    Note over Res: Потребитель A уже прошёл «Cache miss»<br/>(см. одноимённый раздел выше)

    Agent->>Res: trigger(keyedArgs, doForce=false)
    Res->>Cache: get(key)
    Cache-->>Res: existing Entry (pending)
    Res-->>Agent: void
```

## Потоки команды (Command)

### Мутация — базовый поток


```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useCommand
    participant Agent as Agent
    participant Cmd as Command
    participant Cache as CacheMap
    participant Entry as QueryCacheEntry
    participant Query as queryFn

    UI->>Hook: cmd.useCommand()
    
    Hook-->>UI: { status: idle }

    UI->>Hook: trigger(args)
    Hook->>Agent: trigger(args)
    Agent->>Cmd: trigger(keyedArgs)
    Cmd->>Cache: get(key)
    Cache-->>Cmd: null
    Cmd->>Entry: new Entry(options)
    Entry->>Query: queryFn(args)
    Query-->>Entry: Promise (pending)
    Entry-->>Cmd: Entry (pending)
    Cmd->>Cache: set(key, entry)
    Cache-->>Cmd: void
    Cmd-->>Cmd: lastEntry.set(Entry)
    Cmd-->>Agent: Entry (pending)
    Agent-->>Hook: pending
    Hook-->>UI: { status: pending }

    alt ответ OK
        Query-->>Entry: data
        Entry->>Entry: pending → success
        Entry-->>Agent: machine$ → success
        Agent-->>Hook: success
        Hook-->>UI: { status: success, data }
    else ошибка
        Query-->>Entry: error
        Entry->>Entry: pending → error
        Entry-->>Agent: machine$ → error
        Agent-->>Hook: error
        Hook-->>UI: { status: error, error }
    end
```

## Связи (Links)

### Инвалидация через link после мутации


```mermaid
sequenceDiagram
    participant Cmd as Command
    participant Lnk as Link
    participant Res as Resource
    participant Cache as CacheMap
    participant Entry as QueryCacheEntry
    participant Query as queryFn
    
    Note over Lnk: invalidate: true

    Note over Entry: machine: success (data v1)

    Note over Cmd: Мутация (UI → Hook → Cmd) — см. «Мутация — базовый поток»
    Note over Cmd: queryFn(args) завершился успешно


    Cmd->>Lnk: Вызов onQueryStarted ($queryFulfilled) хука
    Lnk->>Lnk: forwardArgs(args) → args
    Lnk->>Res: refresh(args)
    Res->>Cache: get(key)
    Cache-->>Res: Entry
    Res->>Entry: refresh()
    Entry->>Entry: success → refreshing

    Note over Entry: подписчики записи ресурса получат refreshing

    Entry->>Query: queryFn(args, abortSignal)

    alt ответ OK
        Query-->>Entry: fresh data
        Entry->>Entry: refreshing → success (rebase)
        Note over Entry: подписчики записи ресурса получат success
    else ошибка
        Query-->>Entry: error
        Entry->>Entry: refreshing → refresh-error (fail)
        Note over Entry: подписчики записи ресурса получат refresh-error
    end
    
    Entry-->>Res: void
    Res-->>Lnk: void
    Lnk-->>Cmd: void
```

### Оптимистичное обновление через link


```mermaid
sequenceDiagram
    participant Cmd as Command
    participant Lnk as Link
    participant Res as Resource
    participant Entry as QueryCacheEntry

    Note over Cmd: trigger(args) — полный поток<br/>см. «Мутация — базовый поток»

    Note over Lnk: optimisticUpdate: fn

    Cmd->>Lnk: Вызов onQueryStarted хука
    Lnk->>Lnk: forwardArgs(args) → args
    Lnk->>Res: getEntry(args)
    Res-->>Lnk: Entry
    Lnk->>Entry: createPatch(patchFn)
    Entry->>Entry: Immer produce → patches + inversePatches
    Entry-->>Entry: machine$ → success (patched data)

    alt ответ OK
        Cmd->>Lnk: $queryFulfilled.resolve(data)
        Lnk->>Entry: handle.commit()
        Entry-->>Lnk: void

    else ошибка
        Cmd->>Lnk: onError(args, error)
        Lnk->>Entry: handle.abort()
        Entry->>Entry: inversePatches → rollback
        Entry-->>Entry: machine$ → success (original data)
        Note over Entry: Возможен isConsistencyViolation →<br/>автоинвалидация (см. патчинг)
        Entry-->>Lnk: void
    end
    
    Lnk-->>Cmd: void
```

---


## Кросс-табовая синхронизация

> Синхронизация построена на PULL-модели: вкладка, которой нужны данные, запрашивает их у других вкладок через `beforeQuery` хук и `BroadcastChannel`. Вкладки **не** рассылают данные проактивно после успешного запроса.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useResource
    participant Agent as Agent
    participant Res as Resource
    participant Entry as QueryCacheEntry
    participant BQ as beforeQuery
    participant Sync as SyncDriver
    participant Sync2 as SyncDriver (отвечающий)
    participant Cache2 as CacheMap
    participant Query as queryFn

    Note over UI, Sync: Tab B — запрашивающая вкладка
    Note over Sync2, Cache2: Tab A — вкладка с данными (success)

    Note over Res: Cache miss — создание новой записи<br/>(подробнее см. «Cache miss»)
    Res->>Entry: new Entry(options)

    opt beforeQuery настроен (sync: true)
        Res->>BQ: beforeQuery(key, keyedArgs)
        BQ->>Sync: REQ { keys, reqId }
        Note over Sync: BroadcastChannel.postMessage
        Sync-->>Sync2: ISyncMessage { type: "REQ", reqId, keys }

        alt данные получены
            Sync2->>Cache2: get(key)
            Cache2-->>Sync2: Entry (success, data)
            Sync2-->>Sync: ISyncMessage { type: "RES", reqId, data }
            Sync-->>BQ: RES { data }
            BQ-->>Entry: hydrate(data)
            Entry->>Entry: → success (queryFn не вызывается)
            Note over Entry: Мгновенный кэш-хит —<br/>рендер без сетевого запроса
            Entry-->>Agent: machine$ → success
            Agent-->>Hook: success
            Hook-->>UI: { status: success, data }
        else таймаут
            Note over Sync2: Нет данных / нет других вкладок → нет ответа
            Note over BQ: Таймаут — RES не получен
            BQ-->>Res: null
            Note over Res: queryFn вызывается далее
        end
    end

    Entry->>Query: queryFn(args, abortSignal)
    Note over Query: Сетевой запрос

    alt ответ OK
        Query-->>Entry: data
        Entry->>Entry: → success
        Entry-->>Agent: machine$ → success
        Agent-->>Hook: success
        Hook-->>UI: { status: success, data }
    else ошибка
        Query-->>Entry: error
        Entry->>Entry: → error
        Entry-->>Agent: machine$ → error
        Agent-->>Hook: error
        Hook-->>UI: { status: error, error }
    end
```


## См. также

- [Машина состояний запроса][machine] — статусы и переходы, на которых построены все потоки
- [Система кэширования][cache] — жизненный цикл записей и `retentionTime`
- [Оптимистичные обновления (links)][usage-links] — `optimisticUpdate` и `invalidate` в действии
- [Агент][agent] — SWR-наблюдатель, транслирующий состояние машины в UI
- [Кросс-табовая синхронизация][usage-broadcast] — настройка `syncDriver` и `broadcastSyncDriver`


[agent]: agent.md
[machine]: machine.md
[cache]: cache.md
[usage-links]: ../usage/links.md
[usage-broadcast]: ../usage/broadcast.md
