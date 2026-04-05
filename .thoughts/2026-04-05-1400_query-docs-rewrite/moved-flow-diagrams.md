## Поток данных

### Первый запрос (cache miss)

Последовательность шагов при первом обращении компонента к ресурсу, когда в кеше ещё нет записи.

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
        Entry->>Entry: → MachineSuccess
        Entry-->>Agent: machine$ → MachineSuccess
        Agent-->>UI: { status: success, data }
    else ошибка
        Server-->>Entry: error
        Entry->>Entry: → MachineError
        Entry-->>Agent: machine$ → MachineError
        Agent-->>UI: { status: error, error }
    end
```

> **Попадание в кеш (cache hit):** если запись уже существует и находится в `status: success`, [Agent][agent] возвращает данные синхронно — запроса к серверу не происходит.
