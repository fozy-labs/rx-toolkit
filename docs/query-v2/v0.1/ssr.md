# SSR — RxQuery v2

> ⚠️ **Экспериментальный модуль.**

RxQuery v2 поддерживает серверный рендеринг (SSR) через механизм **snapshot** — сериализуемого слепка кэша, который можно передать с сервера на клиент.

## Обзор

1. **Сервер**: выполняет запросы, собирает данные в snapshot через `getSnapshot()`
2. **Передача**: snapshot сериализуется и встраивается в HTML
3. **Клиент**: создаёт API с `initialSnapshot`, данные доступны мгновенно

## Требования

- `keyStrategy` должен быть `'serialize'` (по умолчанию)
- Каждый ресурс должен иметь уникальный `key`
- Только записи в состоянии `success` включаются в snapshot

## Серверная часть: getSnapshot

```typescript
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

// На сервере: создаём API и выполняем запросы
const api = unstable_queryV2.createApi({
    keyPrefix: 'my-app',
});

const userResource = api.createResource<{ id: string }, User>({
    key: 'users',
    queryFn: fetchUser,
});

// Выполняем запросы
await userResource.query({ id: '1' });
await userResource.query({ id: '2' });

// Собираем snapshot
const snapshot = api.getSnapshot();
// snapshot — сериализуемый объект, готовый к JSON.stringify
```

### Формат snapshot

```typescript
interface TApiSnapshot {
    version: number;              // Версия формата
    keyPrefix: string | null;     // Префикс API
    resources: {
        [resourceKey: string]: {
            entries: {
                [serializedArgs: string]: {
                    status: 'success';
                    args: unknown;
                    data: unknown;
                    updatedAt: number;  // Timestamp
                };
            };
        };
    };
}
```

## Клиентская часть: initialSnapshot

```typescript
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

// На клиенте: создаём API с начальным snapshot
const api = unstable_queryV2.createApi({
    keyPrefix: 'my-app',
    initialSnapshot: window.__API_SNAPSHOT__ ?? null, // Например, через объект window
    maxSnapshotDataAge: 300_000, // 5 минут (по умолчанию)
    plugins: [new unstable_queryV2.ReactHooksPlugin()],
});

const userResource = api.createResource<{ id: string }, User>({
    key: 'users',
    queryFn: fetchUser,
});

// Данные из snapshot доступны мгновенно, без запроса к серверу
function UserProfile({ userId }: { userId: string }) {
    const state = userResource.useResourceV2Agent({ id: userId });
    // state.data — данные из snapshot (если не устарели)
    return <div>{state.data?.name}</div>;
}
```

## maxSnapshotDataAge

Определяет максимальный возраст данных snapshot (в мс). Если запись старше этого значения, она будет проигнорирована при гидрации, и запрос будет выполнен заново.

| Уровень | По умолчанию | Описание |
|---------|-------------|----------|
| `createApi` | `300000` (5 мин) | Глобальное значение |
| `createResource` | — | Переопределяет API-уровень |

```typescript
const api = unstable_queryV2.createApi({
    maxSnapshotDataAge: 60_000, // 1 минута для всего API
});

const frequentResource = api.createResource({
    key: 'prices',
    queryFn: fetchPrices,
    maxSnapshotDataAge: 10_000, // 10 секунд для этого ресурса
});
```

## Ограничения

- **Стратегия `compare`** не поддерживает snapshots. Используйте `keyStrategy: 'serialize'` (по умолчанию).
- В snapshot попадают **только** записи в состоянии `success`.
- Snapshot не включает информацию о патчах или pending-запросах.
- `keyPrefix` на сервере и клиенте должен совпадать.

### Оптимистичные обновления и snapshot

- Во время активных оптимистичных патчей `data` в snapshot — это **патченное** (оптимистичное) значение, а не `originalData`.
- `originalData` и `patches` не включаются в `TResourceV2SnapshotSlice`.
- Гидрация snapshot, сделанного в момент патча (оптимистичного обновления), установит оптимистичные данные как канонические серверные данные.

### Ошибки гидрации

- `hydrateSnapshot` **выбрасывает ошибку** при несовпадении `version` (формат snapshot несовместим).
- `hydrateSnapshot` **выбрасывает ошибку** при несовпадении `keyPrefix` (snapshot от другого API-инстанса).
