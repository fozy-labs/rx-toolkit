# Потоки данных

Диаграммы описывают основные сценарии взаимодействия компонентов модуля Query.


---

## Cache miss


```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useResource
    participant Agent as Agent
    participant Res as Resource
    participant Cache as CacheMap
    participant Entry as QueryCacheEntry
    participant Query as queryFn

    UI->>Hook: useResource(args)
    Hook->>Agent: set(args)

    Note over Agent: Создание Signal.computed

    Agent->>Res: getEntry$(keyedArgs, doInitiate=false)

    Res->>Cache: get(key)
    Cache-->>Res: null (нет записи)
    Res-->>Agent: null
    Agent-->>Hook: pending
    Hook-->>UI: { status: pending }

    Note over Hook: useImmediateEffect срабатывает

    opt синхронно
        Hook->>Agent: start()
        Agent->>Res: trigger(keyedArgs, doForce=false)
        Res-->>Res: _getOrCreate(keyedArgs, doForce=false))
        Res->>Cache: get(key)
        Cache-->>Res: null
        Res->>Entry: new Entry(options)
        Entry->>Query: queryFn(args, abortSignal)
        Query-->>Entry: Promise (pending)
        Entry-->> Res: Entry (pending)

        Res->>Cache: set(key, entry)
    
        Cache-->>Res: Entry (pending)

        opt Отработка реактивной зависимости (null -> Entry)
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

## Cache hit


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
    Res->>Cache: get(keyedArgs)
    Cache-->>Res: Entry
    Res-->>Agent: Entry
    Agent-->>Agent: Подписка на machine$
    Agent-->>Hook: state
    Hook-->>UI: state
```

## Условный запрос (SKIP → реальные args)


```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useResource
    participant Agent as Agent
    participant Res as Resource

    UI->>Hook: useResource(SKIP)
    Hook-->>UI: { status: idle }

    Note over UI: зависимые данные готовы
    
    UI->>Hook: useResource(args)
    Hook->>Agent: set(args)
    Agent->>Res: getEntry$(args)

    alt cache miss
        Res-->>Agent: null
        Agent-->>Hook: pending
        Hook-->>UI: { status: pending }
        Note over Agent: → поток «Первый запрос»
    else cache hit
        Res-->>Agent: existing Entry (success)
        Agent-->>Hook: Entry (success)
        Hook-->>UI: { status: success, data }
    end
```

## Refresh / фоновое обновление

Запись уже в `success` — вызов `refresh()` переводит машину в `refreshing`. UI продолжает показывать устаревшие данные, пока не придёт ответ.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useResource
    participant Agent as Agent
    participant Res as Resource
    participant Entry as CacheEntry
    participant Server as Сервер

    Note over Entry: machine: success (data v1)

    UI->>Res: resource.refresh(args)
    Res->>Entry: refresh()
    Entry->>Entry: success → refreshing
    Entry-->>Agent: state$ → refreshing
    Agent-->>Hook: refreshing
    Hook-->>UI: { status: refreshing, data: v1 }

    Entry->>Server: queryFn(args, abortSignal)

    alt ответ OK
        Server-->>Entry: data v2
        Entry->>Entry: refreshing → success (rebase)
        Entry-->>Agent: state$ → success
        Agent-->>Hook: success
        Hook-->>UI: { status: success, data: v2 }
    else ошибка
        Server-->>Entry: error
        Entry->>Entry: refreshing → refresh-error (fail)
        Entry-->>Agent: state$ → refresh-error
        Agent-->>Hook: refresh-error
        Hook-->>UI: { status: refresh-error, data: v1, error }
    end
```

## SWR-fallback при смене аргументов

Агент хранит два слота — текущую и предыдущую запись. При смене аргументов предыдущие данные показываются как устаревшие, пока новый запрос не завершится.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useResource
    participant Agent as Agent
    participant Res as Resource
    participant Cache as CacheMap
    participant Entry1 as CacheEntry (user/1)
    participant Entry2 as CacheEntry (user/2)
    participant Server as Сервер

    Note over Agent: current = Entry1 (success, data/1)

    UI->>Hook: useResource({ id: 2 })
    Hook->>Agent: set({ id: 2 })
    Agent->>Agent: prev = Entry1, current = null
    Agent->>Res: getOrCreate({ id: 2 })
    Res->>Cache: getOrCreate({ id: 2 })
    Cache->>Entry2: new({ id: 2 }, queryFn)
    Entry2->>Server: queryFn({ id: 2 }, abortSignal)
    Res-->>Agent: Entry2 (pending)

    Agent-->>Hook: refreshing
    Hook-->>UI: { status: refreshing, data: data/1 }

    Server-->>Entry2: data/2
    Entry2->>Entry2: → success
    Entry2-->>Agent: state$ → success
    Agent->>Agent: prev = null
    Agent-->>Hook: success
    Hook-->>UI: { status: success, data: data/2 }
```

## Дедупликация параллельных запросов

Два компонента запрашивают одни и те же аргументы одновременно — ресурс создаёт единственную запись и выполняет один сетевой запрос.

```mermaid
sequenceDiagram
    participant UI_A as Компонент A
    participant Hook_A as useResource
    participant Agent_A as Agent A
    participant Res as Resource
    participant Cache as CacheMap
    participant Entry as CacheEntry
    participant Server as Сервер
    participant Agent_B as Agent B
    participant Hook_B as useResource
    participant UI_B as Компонент B

    UI_A->>Hook_A: useResource(args)
    Hook_A->>Agent_A: set(args)
    UI_B->>Hook_B: useResource(args)
    Hook_B->>Agent_B: set(args)

    Agent_A->>Res: getOrCreate(args)
    Res->>Cache: getOrCreate(args)
    Cache->>Entry: new(args, queryFn)
    Entry->>Server: queryFn(args, abortSignal)
    Res-->>Agent_A: Entry (pending)

    Agent_B->>Res: getOrCreate(args)
    Res->>Cache: getOrCreate(args)
    Cache-->>Res: existing Entry (pending)
    Res-->>Agent_B: existing Entry (pending)

    Server-->>Entry: data
    Entry->>Entry: → success
    Entry-->>Agent_A: state$ → success
    Entry-->>Agent_B: state$ → success
    Agent_A-->>Hook_A: success
    Agent_B-->>Hook_B: success
    Hook_A-->>UI_A: { status: success, data }
    Hook_B-->>UI_B: { status: success, data }
```

---

## Мутация — базовый поток

Вызов `trigger(args)` создаёт запись кеша команды, выполняет `queryFn` и переводит машину в `success` или `error`. По умолчанию `retentionTime: 0` — запись удаляется сразу после завершения.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useCommand
    participant Agent as Agent
    participant Cmd as Command
    participant Entry as CacheEntry
    participant Server as Сервер

    UI->>Hook: cmd.useCommand()
    Hook-->>UI: { status: idle }

    UI->>Hook: trigger(args)
    Hook->>Agent: trigger(args)
    Agent->>Cmd: trigger(args)
    Cmd->>Entry: new(args, queryFn)
    Entry->>Entry: → pending
    Entry-->>Agent: state$ → pending
    Agent-->>Hook: pending
    Hook-->>UI: { status: pending }

    Entry->>Server: queryFn(args, abortSignal)

    alt ответ OK
        Server-->>Entry: data
        Entry->>Entry: pending → success
        Entry-->>Agent: state$ → success
        Agent-->>Hook: success
        Hook-->>UI: { status: success, data }
    else ошибка
        Server-->>Entry: error
        Entry->>Entry: pending → error
        Entry-->>Agent: state$ → error
        Agent-->>Hook: error
        Hook-->>UI: { status: error, error }
    end
```

## Инвалидация через link после мутации

Команда объявляет связь с ресурсом (`invalidate: true`). После успешного выполнения `queryFn` link срабатывает: `forwardArgs` вычисляет ключ целевой записи, и ресурс запускает рефетч.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useResource
    participant Agent as Agent
    participant Cmd as Command
    participant Lnk as Link
    participant Res as Resource
    participant Entry as CacheEntry (ресурса)
    participant Srv as Сервер

    Note over UI,Cmd: через useCommand (см. «Мутация»)
    UI->>Cmd: trigger(args)
    Cmd->>Srv: queryFn(args, abortSignal)
    Srv-->>Cmd: result (success)

    Note over Cmd,Lnk: invalidate: true — link срабатывает

    Cmd->>Lnk: onSuccess(args, result)
    Lnk->>Lnk: forwardArgs(args) → targetArgs
    Lnk->>Res: refresh(targetArgs)
    Res->>Entry: refresh()
    Entry->>Entry: success → refreshing
    Entry-->>Agent: state$ → refreshing
    Agent-->>Hook: refreshing
    Hook-->>UI: { status: refreshing, data }

    Entry->>Srv: queryFn(targetArgs, abortSignal)
    Srv-->>Entry: fresh data
    Entry->>Entry: refreshing → success (rebase)
    Entry-->>Agent: state$ → success
    Agent-->>Hook: success
    Hook-->>UI: { status: success, data }
```

## Оптимистичное обновление через link

Link с `optimisticUpdate` мгновенно применяет Immer-рецепт к данным ресурса через систему [патчинга][patching]. UI обновляется до ответа сервера. При успехе патч коммитится; при ошибке — откатывается через `inversePatches`.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useResource
    participant Agent as Agent
    participant Cmd as Command
    participant Lnk as Link
    participant Res as Resource
    participant Entry as CacheEntry (ресурса)
    participant Srv as Сервер

    Note over UI,Cmd: через useCommand (см. «Мутация»)
    UI->>Cmd: trigger(args)

    Note over Cmd,Lnk: optimisticUpdate → немедленно

    Cmd->>Lnk: onTrigger(args)
    Lnk->>Lnk: forwardArgs(args) → targetArgs
    Lnk->>Res: getEntry(targetArgs)
    Res-->>Lnk: Entry
    Lnk->>Entry: createPatch(patchFn)
    Entry->>Entry: Immer produce → changes + inversePatches
    Entry-->>Agent: state$ → success (patched)
    Agent-->>Hook: success (patched)
    Hook-->>UI: { status: success, data: patched }

    Cmd->>Srv: queryFn(args, abortSignal)

    alt ответ OK
        Srv-->>Cmd: result
        Cmd->>Lnk: onSuccess
        Lnk->>Entry: handle.commit()
        Entry->>Entry: patchState очищается
    else ошибка
        Srv-->>Cmd: error
        Cmd->>Lnk: onError
        Lnk->>Entry: handle.abort()
        Entry->>Entry: inversePatches → rollback
        Entry-->>Agent: state$ → success (rollback)
        Agent-->>Hook: success (rollback)
        Hook-->>UI: { status: success, data: rollback }
    end
```

---

## Жизненный цикл кеш-записи (GC)

Запись существует в одном из трёх состояний: `active` → `retention` → `removed`. Таймер [`retentionTime`][api-res] запускается при отписке последнего подписчика и отменяется, если появляется новый.

```mermaid
stateDiagram-v2
    [*] --> active : первый подписчик\n(getOrCreate)

    active --> retention : последний подписчик\nотписался
    retention --> active : новый подписчик\n(таймер отменён)
    retention --> removed : retentionTime\nистёк

    removed --> [*] : удалена из CacheMap
```

## Кросс-табовая синхронизация (broadcast)

Вкладка без данных рассылает broadcast-запрос. Вкладка с чистым `success` (без патчей) отвечает данными через `BroadcastChannel` — сетевой запрос не выполняется.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useResource
    participant Agent as Agent
    participant A as Вкладка A (Resource)
    participant BC as BroadcastChannel
    participant B as Вкладка B (Resource)

    UI->>Hook: useResource(args)
    Hook->>Agent: set(args)
    Agent->>A: getEntry$(args)
    Note over A: запись отсутствует — cache miss

    A->>BC: REQUEST { key, args }
    BC->>B: REQUEST { key, args }

    B->>B: getEntry(args) → success, нет патчей
    B->>BC: RESPONSE { key, args, data }
    BC->>A: RESPONSE { key, args, data }

    A->>A: createEntry(args, data) → success
    A-->>Agent: state$ → success
    Agent-->>Hook: success
    Hook-->>UI: { status: success, data }

    Note over UI,A: данные получены из другой вкладки —\nсетевой запрос не потребовался
```

## См. также

- [Стейт-машина запроса][machine] — статусы и переходы, на которых построены все потоки
- [Система кеширования][cache] — жизненный цикл записей и `retentionTime`
- [Оптимистичные обновления (links)][usage-links] — `optimisticUpdate` и `invalidate` в действии
- [Кросс-табовая синхронизация][usage-broadcast] — настройка `syncDriver` и `broadcastSyncDriver`

---

[machine]: machine.md
[cache]: cache.md
[patching]: patching.md
[agent]: agent.md
[usage-res]: ../usage/resource.md
[usage-cmd]: ../usage/command.md
[usage-links]: ../usage/links.md
[usage-lifecycle]: ../usage/lifecycle.md
[usage-broadcast]: ../usage/broadcast.md
[api-res]: ../api/resource.md
[api-cmd]: ../api/command.md
