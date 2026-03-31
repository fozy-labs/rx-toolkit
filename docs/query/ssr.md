# SSR

RxQuery поддерживает серверный рендеринг (SSR) через механизм **snapshot** — сериализуемого слепка кэша, который можно передать с сервера на клиент.

## Обзор

1. **Сервер**: выполняет запросы, собирает данные в snapshot через `api.getSnapshot()`
2. **Передача**: snapshot сериализуется и встраивается в HTML
3. **Клиент**: создаёт API с `initialSnapshot` или вызывает `hydrateSnapshot(api, snapshot)` — данные доступны мгновенно

## Требования

- `keyStrategy` должен быть `'serialize'` (по умолчанию)
- Каждый ресурс должен иметь уникальный `key`
- Только записи в состоянии `success` включаются в snapshot

---

## Серверная часть: getSnapshot

```typescript
import { query } from '@fozy-labs/rx-toolkit';

// На сервере: создаём API и выполняем запросы
const api = createApi({
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
    version: number;              // CURRENT_SNAPSHOT_VERSION
    keyPrefix: string | null;     // Префикс API
    resources: {
        [resourceKey: string]: {
            entries: {
                [serializedArgs: string]: {
                    status: 'success';
                    args: unknown;
                    data: unknown;
                    updatedAt: number;
                };
            };
        };
    };
}
```

---

## Клиентская част: initialSnapshot


```typescript
import { query } from '@fozy-labs/rx-toolkit';

const initialSnapshot = window.__API_SNAPSHOT__ ?? null;
window.__API_SNAPSHOT__ = null;

const api = createApi({
    keyPrefix: 'my-app',
    initialSnapshot,
    maxSnapshotDataAge: 5 * 60_000, // 5 минут
    plugins: [new ReactHooksPlugin()],
});

const userResource = api.createResource<{ id: string }, User>({
    key: 'users',
    queryFn: fetchUser,
});

// Данные из snapshot доступны мгновенно
function UserProfile({ userId }: { userId: string }) {
    const state = userResource.useResourceAgent({ id: userId });
    return <div>{state.data?.name}</div>;
}
```

---

## maxSnapshotDataAge

Определяет максимальный возраст данных snapshot (в мс). Если запись старше этого значения, она игнорируется при гидрации, и запрос выполняется заново.

| Уровень | По умолчанию | Описание |
|---------|-------------|----------|
| `createApi` | — | Глобальное значение |
| `createResource` | — | Переопределяет API-уровень |

```typescript
const api = createApi({
    maxSnapshotDataAge: 60_000, // 1 минута для всего API
});

const frequentResource = api.createResource({
    key: 'prices',
    queryFn: fetchPrices,
    maxSnapshotDataAge: 10_000, // 10 секунд для этого ресурса
});
```

---

## Пример: Next.js

```typescript
// server.ts
export async function getServerSideProps() {
    const api = createApi({ keyPrefix: 'app' });
    const userResource = api.createResource<{ id: string }, User>({
        key: 'users',
        queryFn: fetchUser,
    });

    await userResource.query({ id: '1' });
    const snapshot = api.getSnapshot();

    return { props: { snapshot } };
}

// client.tsx
function App({ snapshot }: { snapshot: TApiSnapshot }) {
    // Гидрация через initialSnapshot
    const api = createApi({
        keyPrefix: 'app',
        initialSnapshot: snapshot,
        plugins: [new ReactHooksPlugin()],
    });
    // ...
}
```

## Пример: Vite SSR

```typescript
// entry-server.ts
export async function render() {
    const api = createApi({ keyPrefix: 'vite-app' });
    const resource = api.createResource({ key: 'data', queryFn: fetchData });

    await resource.query(undefined);
    const snapshot = api.getSnapshot();

    const html = renderToString(<App />);
    return { html, snapshot };
}

// entry-client.ts
const snapshot = window.__SNAPSHOT__;
const api = createApi({
    keyPrefix: 'vite-app',
    initialSnapshot: snapshot,
    plugins: [new ReactHooksPlugin()],
});
```

---

## Ограничения

- **Стратегия `compare`** не поддерживает snapshots — используйте `keyStrategy: 'serialize'` (по умолчанию)
- В snapshot попадают **только** записи в состоянии `success`
- Snapshot не включает информацию о патчах или pending-запросах
- `keyPrefix` на сервере и клиенте должен совпадать

### Оптимистичные обновления и snapshot

- Если snapshot создаётся во время активных патчей, `data` в snapshot — это **пропатченное** (оптимистичное) значение
- `originalData` и `patches` не включаются в snapshot
- Гидрация такого snapshot установит оптимистичные данные как канонические

### Ошибки гидрации

- `hydrateSnapshot` выбрасывает ошибку при несовпадении `version`
- `hydrateSnapshot` выбрасывает ошибку при несовпадении `keyPrefix`
- `createApi` с `initialSnapshot` выполняет ту же валидацию при создании
