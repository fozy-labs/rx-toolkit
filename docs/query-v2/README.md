# RxQuery v2 (**experimental**)

> ⚠️ **Экспериментальный модуль.** API может измениться без предупреждения. Используйте с осторожностью в production.

RxQuery v2 — переработанная система управления асинхронными запросами и кэшированием данных в RxToolkit. В отличие от v1, v2 строится вокруг единой фабрики `createApi`, machine-based состояний и плагинной архитектуры.

## Основные концепции

### createApi

Точка входа для создания API-инстанса. Все ресурсы создаются через API, что обеспечивает общую конфигурацию, snapshot-поддержку и плагины.

```typescript
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

const api = unstable_queryV2.createApi({
    keyPrefix: 'my-app',
    cacheLifetime: 60_000,
    plugins: [new unstable_queryV2.ReactHooksPlugin()],
});
```

**Параметры:**

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|-------------|----------|
| `keyPrefix` | `string \| null` | `null` | Префикс ключей для namespace-изоляции |
| `keyStrategy` | `'serialize' \| 'compare'` | `'serialize'` | Стратегия ключей кэша |
| `serializeArgs` | `(args) => string` | — | Кастомная сериализация аргументов |
| `compareArg` | `(a, b) => boolean` | — | Кастомное сравнение аргументов |
| `cacheLifetime` | `number` | `60000` | Время жизни кэша (мс) |
| `plugins` | `IPlugin[]` | `[]` | Массив плагинов |
| `initialSnapshot` | `TApiSnapshot \| null` | `null` | Начальный snapshot для SSR-гидрации |
| `maxSnapshotDataAge` | `number` | `300000` | Максимальный возраст данных snapshot (мс) |
| `doCacheArgs` | `boolean` | `false` | Кэшировать ли аргументы в кэш-записи |

### ResourceV2

Ресурс — единица кэширования. Создаётся через `api.createResource()`. В отличие от v1, ресурс всегда принадлежит API-инстансу.

```typescript
interface User {
    id: string;
    name: string;
}

const userResource = api.createResource<{ id: string }, User>({
    key: 'users',
    queryFn: async (args, { abortSignal }) => {
        const res = await fetch(`/api/users/${args.id}`, { signal: abortSignal });
        return res.json();
    },
    cacheLifetime: 30_000,
});
```

**Параметры `createResource`:**

| Параметр | Тип | Описание |
|----------|-----|----------|
| `key` | `string` | Уникальный ключ ресурса (обязателен для SSR) |
| `queryFn` | `(args, tools) => Promise<TData>` | Функция запроса |
| `cacheLifetime` | `number` | Время жизни кэша (переопределяет API-уровень) |
| `serializeArgs` | `(args) => string` | Кастомная сериализация (переопределяет API-уровень) |
| `compareArg` | `(a, b) => boolean` | Кастомное сравнение (переопределяет API-уровень) |
| `onCacheEntryAdded` | `(args, tools) => void` | Хук при добавлении записи в кэш |
| `onQueryStarted` | `(args, tools) => void` | Хук при старте запроса |
| `beforeDevtoolsPush` | `(value, push) => void` | Перехват состояния перед отправкой в devtools |
| `maxSnapshotDataAge` | `number` | Возраст данных для snapshot |
| `doCacheArgs` | `boolean` | Кэшировать ли аргументы |

### Agents (Агенты)

Agent — наблюдатель за ресурсом с поддержкой stale-while-revalidate. Предоставляет вычисляемое состояние с удобными флагами.

```typescript
const agent = userResource.createAgent();
agent.start({ id: '1' });

// Реактивное состояние
const state = agent.state$();
console.log(state.status);      // 'pending' | 'success' | ...
console.log(state.data);        // TData | null
console.log(state.isLoading);   // true/false
```

**Состояние агента (`IResourceV2AgentState`):**

| Поле | Тип | Описание |
|------|-----|----------|
| `status` | `TMachineStatus` | Текущий статус машины |
| `data` | `TData \| null` | Текущие данные (могут быть устаревшими при обновлении) |
| `error` | `TError \| null` | Текущая ошибка |
| `args` | `TArgs \| null` | Текущие аргументы |
| `isLoading` | `boolean` | Индикатор загрузки |
| `isInitialLoading` | `boolean` | `true` только при первой загрузке (нет предыдущих данных) |
| `isRefreshing` | `boolean` | `true` при обновлении существующих данных |
| `isSuccess` | `boolean` | `true` когда данные доступны |
| `isError` | `boolean` | `true` при ошибке |
| `refreshError` | `TError \| null` | Ошибка фонового обновления (устаревшие данные сохранены) |

### Machine States (Машина состояний)

В v2 состояние кэш-записи описывается машиной состояний вместо набора boolean-флагов:

| Состояние | Описание | Данные |
|-----------|----------|--------|
| `idle` | Начальное состояние | — |
| `pending` | Первый запрос выполняется | — |
| `success` | Данные загружены | ✅ |
| `error` | Запрос завершился с ошибкой | — |
| `refreshing` | Обновление при наличии данных | ✅ (устаревшие) |

Классы машин: `MachineIdle`, `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`.

### Cache Strategies (Стратегии кэша)

Доступны две стратегии определения ключей кэша:

- **`serialize`** (по умолчанию) — аргументы сериализуются в строку (поддерживает SSR snapshots)
- **`compare`** — аргументы сравниваются функцией (не поддерживает snapshots)

### SKIP_TOKEN

Специальный токен для пропуска запроса (полезен при условных запросах).

```typescript
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

const { SKIP } = unstable_queryV2;

// В React с плагином
const state = userResource.useResourceV2Agent(
    userId ? { id: userId } : SKIP,
);
```

### Lifecycle Hooks (Хуки жизненного цикла)

#### onCacheEntryAdded

Вызывается при создании новой записи кэша. Полезен для WebSocket-подписок.

```typescript
const resource = api.createResource({
    key: 'messages',
    queryFn: fetchMessages,
    onCacheEntryAdded: async (args, { $cacheDataLoaded, $cacheEntryRemoved }) => {
        await $cacheDataLoaded;
        const ws = new WebSocket(`/ws/messages/${args.channelId}`);
        await $cacheEntryRemoved;
        ws.close();
    },
});
```

**Tools (onCacheEntryAdded):**

| Поле | Тип | Описание |
|------|-----|----------|
| `$cacheDataLoaded` | `Promise<TData>` | Разрешается при первом `MachineSuccess` |
| `$cacheEntryRemoved` | `Promise<void>` | Разрешается при удалении записи из кэша |
| `getCacheEntry()` | `() => TMachine` | Текущее состояние машины |

#### onQueryStarted

Вызывается при каждом старте запроса. Полезен для оптимистичных обновлений.

```typescript
const resource = api.createResource({
    key: 'todos',
    queryFn: updateTodo,
    onQueryStarted: async (args, { $queryFulfilled, getCacheEntry }) => {
        // Оптимистичное обновление
        const entry = getCacheEntry();
        // ...
        try {
            await $queryFulfilled;
        } catch {
            // Откат
        }
    },
});
```

**Tools (onQueryStarted):**

| Поле | Тип | Описание |
|------|-----|----------|
| `$queryFulfilled` | `Promise<{ data, isError }>` | Разрешается/отклоняется при завершении запроса |
| `getCacheEntry()` | `() => ICacheEntry` | Текущая запись кэша для патчинга |

### Plugins (Плагины)

Плагинная архитектура позволяет расширять ресурсы дополнительными методами.

#### ReactHooksPlugin

Добавляет React-хуки к ресурсам:

```typescript
const api = unstable_queryV2.createApi({
    plugins: [new unstable_queryV2.ReactHooksPlugin()],
});

const userResource = api.createResource({ /* ... */ });

// Теперь доступны хуки:
function UserProfile({ userId }: { userId: string }) {
    const state = userResource.useResourceV2Agent({ id: userId });
    const ref = userResource.useResourceV2Ref({ id: userId });

    if (state.isLoading) return <div>Загрузка...</div>;
    if (state.isError) return <div>Ошибка</div>;

    return <div>{state.data?.name}</div>;
}
```

**Методы, добавляемые плагином:**

| Метод | Описание |
|-------|----------|
| `useResourceV2Agent(args)` | React-хук агента (реактивное состояние) |
| `useResourceV2Ref(args)` | React-хук ref (императивный доступ к кэш-записи) |

### ResourceV2Ref (Ссылка на ресурс)

Ref предоставляет императивный доступ к конкретной записи кэша.

| Метод | Описание |
|-------|----------|
| `has` | Проверить наличие записи в кэше |
| `lock()` | Заблокировать запись (предотвратить удаление) |
| `invalidate()` | Инвалидировать (принудительный перезапрос) |
| `createPatch(fn)` | Создать оптимистичный патч |
| `create(data)` | Предзаполнить кэш данными |

---

## Быстрый старт

```typescript
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

// 1. Создаём API
const api = unstable_queryV2.createApi({
    plugins: [new unstable_queryV2.ReactHooksPlugin()],
});

// 2. Создаём ресурс
const todoResource = api.createResource<void, { items: string[] }>({
    key: 'todos',
    queryFn: async (_args, { abortSignal }) => {
        const res = await fetch('/api/todos', { signal: abortSignal });
        return res.json();
    },
});

// 3. Используем в React
function TodoList() {
    const { data, isLoading, isError } = todoResource.useResourceV2Agent(undefined);

    if (isLoading) return <div>Загрузка...</div>;
    if (isError) return <div>Ошибка</div>;

    return (
        <ul>
            {data?.items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
    );
}
```

## Дополнительные материалы

- [API Reference](./api-reference.md) — полная таблица типов и параметров
- [Оптимистичные обновления](./optimistic-updates.md) — гайд по патчам
- [SSR](./ssr.md) — серверный рендеринг и snapshots
- [Миграция с v1](../migrations/query-v2.md) — гайд по миграции
