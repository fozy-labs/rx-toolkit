# Потоки данных

Диаграммы описывают основные сценарии взаимодействия компонентов модуля Query.
Каждая диаграмма — один изолированный поток; переходы [стейт-машины][machine] указаны в скобках.

---

## Первый запрос (cache miss)

UI монтируется с новыми аргументами — агент не находит запись в кеше и инициирует сетевой запрос.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Agent as Agent
    participant Res as Resource
    participant Entry as CacheEntry
    participant Server as Сервер

    UI->>Agent: useResource(args)

    opt args === SKIP
        Agent-->>UI: { status: idle }
    end

    Agent->>Res: getEntry$(args, doInitiate=false)
    Res-->>Agent: null (нет записи)
    Agent-->>UI: { status: pending, entry: null }

    Note over UI,Agent: useImmediateEffect срабатывает
    UI->>Agent: agent.set(args)
    Agent->>Res: getOrCreate(args)
    Res->>Entry: new(args, queryFn)
    Entry->>Server: queryFn(args, { abortSignal })
    Res-->>Agent: новый Entry (pending)

    alt ответ OK
        Server-->>Entry: data
        Entry->>Entry: → success
        Entry-->>Agent: machine$ → success
        Agent-->>UI: { status: success, data }
    else ошибка
        Server-->>Entry: error
        Entry->>Entry: → error
        Entry-->>Agent: machine$ → error
        Agent-->>UI: { status: error, error }
    end
```

## Повторный запрос (cache hit)

Компонент монтируется с аргументами, для которых в кеше уже есть успешная запись — данные возвращаются мгновенно.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Agent as Agent
    participant Res as Resource
    participant Entry as CacheEntry

    UI->>Agent: useResource(args)
    Agent->>Res: getEntry$(args)
    Res-->>Agent: existing Entry (success)
    Agent-->>UI: { status: success, data }
```

## Условный запрос (SKIP → реальные args)

Пока зависимые данные не готовы, передаётся `SKIP` — агент находится в `idle`, запись не создаётся. Как только появляются реальные аргументы, запускается стандартный поток cache miss / cache hit.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Agent as Agent
    participant Res as Resource

    UI->>Agent: useResource(SKIP)
    Agent-->>UI: { status: idle }

    Note over UI: зависимые данные готовы
    UI->>Agent: useResource(args)
    Agent->>Res: getEntry$(args)

    alt cache miss
        Res-->>Agent: null
        Note over Agent: → поток «Первый запрос»
    else cache hit
        Res-->>Agent: existing Entry (success)
        Agent-->>UI: { status: success, data }
    end
```

## Refresh / фоновое обновление

Запись уже в `success` — вызов `refresh()` переводит машину в `refreshing`. UI продолжает показывать устаревшие данные, пока не придёт ответ.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Agent as Agent
    participant Entry as CacheEntry
    participant Server as Сервер

    Note over Entry: machine: success (data v1)

    Agent->>Entry: refresh()
    Entry->>Entry: success → refreshing
    Entry-->>Agent: machine$ → refreshing
    Agent-->>UI: { status: refreshing, data: v1 }

    Entry->>Server: queryFn(args, { abortSignal })

    alt ответ OK
        Server-->>Entry: data v2
        Entry->>Entry: refreshing → success (rebase)
        Entry-->>Agent: machine$ → success
        Agent-->>UI: { status: success, data: v2 }
    else ошибка
        Server-->>Entry: error
        Entry->>Entry: refreshing → refresh-error (fail)
        Entry-->>Agent: machine$ → refresh-error
        Agent-->>UI: { status: refresh-error, data: v1, error }
    end
```

## SWR-fallback при смене аргументов

Агент хранит два слота — текущую и предыдущую запись. При смене аргументов предыдущие данные показываются как устаревшие, пока новый запрос не завершится.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Agent as Agent
    participant Res as Resource
    participant Entry1 as CacheEntry (user/1)
    participant Entry2 as CacheEntry (user/2)
    participant Server as Сервер

    Note over Agent: current = Entry1 (success, data/1)

    UI->>Agent: useResource({ id: 2 })
    Agent->>Agent: prev = Entry1, current = null
    Agent->>Res: getOrCreate({ id: 2 })
    Res->>Entry2: new({ id: 2 }, queryFn)
    Entry2->>Server: queryFn({ id: 2 }, { abortSignal })
    Res-->>Agent: Entry2 (pending)

    Agent-->>UI: { status: refreshing, data: data/1 }

    Server-->>Entry2: data/2
    Entry2->>Entry2: → success
    Entry2-->>Agent: machine$ → success
    Agent->>Agent: prev = null
    Agent-->>UI: { status: success, data: data/2 }
```

## Дедупликация параллельных запросов

Два компонента запрашивают одни и те же аргументы одновременно — ресурс создаёт единственную запись и выполняет один сетевой запрос.

```mermaid
sequenceDiagram
    participant UI_A as Компонент A
    participant UI_B as Компонент B
    participant Agent_A as Agent A
    participant Agent_B as Agent B
    participant Res as Resource
    participant Entry as CacheEntry
    participant Server as Сервер

    UI_A->>Agent_A: useResource(args)
    UI_B->>Agent_B: useResource(args)

    Agent_A->>Res: getOrCreate(args)
    Res->>Entry: new(args, queryFn)
    Entry->>Server: queryFn(args, { abortSignal })

    Agent_B->>Res: getOrCreate(args)
    Res-->>Agent_B: existing Entry (pending)

    Server-->>Entry: data
    Entry->>Entry: → success
    Entry-->>Agent_A: machine$ → success
    Entry-->>Agent_B: machine$ → success
    Agent_A-->>UI_A: { status: success, data }
    Agent_B-->>UI_B: { status: success, data }
```

---

## Мутация — базовый поток

Вызов `trigger(args)` создаёт запись кеша команды, выполняет `queryFn` и переводит машину в `success` или `error`. По умолчанию `retentionTime: 0` — запись удаляется сразу после завершения.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Hook as useCommand
    participant Cmd as Command
    participant Entry as CacheEntry
    participant Server as Сервер

    UI->>Hook: const [trigger, state] = cmd.useCommand()
    Hook-->>UI: { status: idle }

    UI->>Hook: trigger(args)
    Hook->>Cmd: execute(args)
    Cmd->>Entry: new(args, queryFn)
    Entry->>Entry: → pending
    Entry-->>Hook: machine$ → pending
    Hook-->>UI: { status: pending }

    Entry->>Server: queryFn(args, { abortSignal })

    alt ответ OK
        Server-->>Entry: data
        Entry->>Entry: pending → success
        Entry-->>Hook: machine$ → success
        Hook-->>UI: { status: success, data }
    else ошибка
        Server-->>Entry: error
        Entry->>Entry: pending → error
        Entry-->>Hook: machine$ → error
        Hook-->>UI: { status: error, error }
    end
```

## Инвалидация через link после мутации

Команда объявляет связь с ресурсом (`invalidate: true`). После успешного выполнения `queryFn` link срабатывает: `forwardArgs` вычисляет ключ целевой записи, и ресурс запускает рефетч.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Cmd as Command
    participant Server as Сервер
    participant Link as Link
    participant Res as Resource
    participant Entry as CacheEntry (ресурса)

    UI->>Cmd: trigger(args)
    Cmd->>Server: queryFn(args, { abortSignal })
    Server-->>Cmd: result (success)

    Note over Cmd,Link: invalidate: true → link срабатывает

    Cmd->>Link: onSuccess(args, result)
    Link->>Link: forwardArgs(args) → targetArgs
    Link->>Res: invalidate(targetArgs)
    Res->>Entry: refresh()
    Entry->>Entry: success → refreshing

    Entry->>Server: queryFn(targetArgs, { abortSignal })
    Server-->>Entry: fresh data
    Entry->>Entry: refreshing → success (rebase)
    Entry-->>UI: machine$ → success (fresh data)
```

## Оптимистичное обновление через link

Link с `optimisticUpdate` мгновенно применяет Immer-рецепт к данным ресурса через систему [патчинга][patching]. UI обновляется до ответа сервера. При успехе патч коммитится; при ошибке — откатывается через `inversePatches`.

```mermaid
sequenceDiagram
    participant UI as React-компонент
    participant Cmd as Command
    participant Link as Link
    participant Res as Resource
    participant Entry as CacheEntry (ресурса)
    participant Patcher as Patcher
    participant Server as Сервер

    UI->>Cmd: trigger(args)

    Note over Cmd,Link: optimisticUpdate → немедленно

    Cmd->>Link: onTrigger(args)
    Link->>Link: forwardArgs(args) → targetArgs
    Link->>Res: getEntry(targetArgs)
    Res-->>Link: Entry
    Link->>Patcher: createPatch(entry, recipe)
    Patcher->>Patcher: Immer produce → changes + inversePatches
    Patcher->>Entry: apply changes → data обновлена
    Entry-->>UI: machine$ → data (оптимистичная)

    Cmd->>Server: queryFn(args, { abortSignal })

    alt ответ OK
        Server-->>Cmd: result
        Cmd->>Link: onSuccess
        Link->>Patcher: patch.commit()
        Patcher->>Entry: patchState очищается
    else ошибка
        Server-->>Cmd: error
        Cmd->>Link: onError
        Link->>Patcher: patch.abort()
        Patcher->>Entry: inversePatches → rollback
        Entry-->>UI: machine$ → data (исходная)
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
    participant A as Вкладка A (Resource)
    participant BC as BroadcastChannel
    participant B as Вкладка B (Resource)

    Note over A: запись отсутствует

    A->>BC: REQUEST { key, args }
    BC->>B: REQUEST { key, args }

    B->>B: getEntry(args) → success, нет патчей
    B->>BC: RESPONSE { key, args, data }
    BC->>A: RESPONSE { key, args, data }

    A->>A: createEntry(args, data) → success
    Note over A: данные получены\nбез сетевого запроса
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
