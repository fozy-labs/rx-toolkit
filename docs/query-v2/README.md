# Query v2

RxQuery v2 — система управления асинхронными запросами и кэшированием данных в RxToolkit. Строится вокруг единой фабрики `createApi`, иммутабельных machine-based состояний и плагинной архитектуры.

## Подробнее

- [Оптимистичные обновления](./optimistic-updates.md) — гайд по патчам
- [SSR](./ssr.md) — серверный рендеринг и snapshots
- [Миграция с v1](../../migrations/query-v2.md) — гайд по миграции

---

## Быстрый старт

```typescript
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

// 1. Создаём API
const api = unstable_queryV2.createApi({
    plugins: [new unstable_queryV2.ReactHooksPlugin()],
});

// 2. Создаём ресурс
const todoResource = api.createResourceV2<void, { items: string[] }>({
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

---

## Основные концепции

### 5-уровневая архитектура

1. **API** — `createApi()` — единая точка конфигурации, snapshot/hydration, плагины
2. **Resource** — `api.createResourceV2()` — единица кэширования, queryFn, lifecycle hooks
3. **CacheEntry** — запись кэша, machine state, оптимистичные патчи
4. **Agent** — SWR-наблюдатель, вычисляемое состояние с удобными флагами
5. **Plugins** — расширение ресурсов (React hooks и др.)

### createApi

Точка входа для создания API-инстанса. Все ресурсы создаются через API.

```typescript
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

const api = unstable_queryV2.createApi({
    keyPrefix: 'my-app',
    cacheLifetime: 60_000,
    plugins: [new unstable_queryV2.ReactHooksPlugin()],
});
```

**Параметры `createApi`:**

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|-------------|----------|
| `keyPrefix` | `string \| null` | `null` | Префикс ключей для namespace-изоляции |
| `keyStrategy` | `'serialize' \| 'compare'` | `'serialize'` | Стратегия ключей кэша |
| `serializeArgs` | `(args) => string` | — | Кастомная сериализация аргументов |
| `compareArg` | `(a, b) => boolean` | — | Кастомное сравнение аргументов |
| `cacheLifetime` | `number` | `60000` | Время жизни кэша (мс) |
| `plugins` | `IPlugin[]` | `[]` | Массив плагинов |
| `initialSnapshot` | `TApiSnapshot \| null` | `null` | Начальный snapshot для SSR-гидрации |
| `maxSnapshotDataAge` | `number` | — | Максимальный возраст данных snapshot (мс) |
| `doCacheArgs` | `boolean` | `false` | Кэшировать ли аргументы в кэш-записи |

**Методы `IApi`:**

| Метод | Описание |
|-------|----------|
| `createResourceV2(options)` | Создать ресурс |
| `resetAll()` | Сбросить все ресурсы и очистить snapshot |
| `getSnapshot()` | Получить snapshot всех ресурсов |

### ResourceV2

Ресурс — единица кэширования. Создаётся через `api.createResourceV2()`.

```typescript
interface User {
    id: string;
    name: string;
}

const userResource = api.createResourceV2<{ id: string }, User>({
    key: 'users',
    queryFn: async (args, { abortSignal }) => {
        const res = await fetch(`/api/users/${args.id}`, { signal: abortSignal });
        return res.json();
    },
    cacheLifetime: 30_000,
});
```

**Параметры `createResourceV2`:**

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

**Методы `IResourceV2`:**

| Метод | Описание |
|-------|----------|
| `createAgent()` | Создать агента (SWR-наблюдатель) |
| `query(args, doForce?)` | Выполнить запрос |
| `getEntry(args)` | Получить кэш-запись (non-reactive). Возвращает `null` если нет. С `doInitiate: true` — гарантирует создание |
| `getEntry$(args)` | Получить кэш-запись (reactive Signal). Возвращает `null` при отсутствии или после `resetAll()`. С `doInitiate: true` — гарантирует создание |
| `invalidate(args)` | Принудительный рефетч для args в состоянии success |

### Machine States (Машина состояний)

Состояние кэш-записи описывается иммутабельной машиной состояний:

| Состояние | Описание | Данные |
|-----------|----------|--------|
| `pending` | Начальное состояние (первый запрос выполняется) | — |
| `success` | Данные загружены | ✅ |
| `error` | Запрос завершился с ошибкой | — |
| `refreshing` | Обновление при наличии данных | ✅ (устаревшие) |

Машины экспортируются как классы (`Machine`, `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`, `MachineWithData`) и как типы дискриминированных union (`TMachineState`). `MachinePending` — начальное состояние при создании кэш-записи.

Состояния `success` и `refreshing` (наследуют `MachineWithData`) содержат `patchState` для оптимистичных обновлений.

### Обработка ошибок (Error Handling)

Query v2 реализует SWR-семантику ошибок: при повторном запросе (refetch) с уже загруженными данными, ошибка **не стирает** предыдущие данные. Это означает, что `isError=true` и `data` (устаревшие) могут сосуществовать одновременно:

```typescript
// Состояние после неудачного refetch при наличии данных:
// {
//   status: "refreshing",
//   isError: true,
//   data: staleData,      // предыдущие данные остаются доступны
//   error: Error,          // текущая ошибка
// }
```

При переходе обратно в `MachineSuccess` (после неудачного refetch), поле `lastError` сохраняет последнюю ошибку для отображения уведомлений. `lastError` автоматически очищается при следующем успешном запросе.

Для восстановления после ошибки используйте `invalidate()` или измените аргументы запроса — это запустит повторный fetch.

> **Рекомендация:** Используйте булевые флаги `isError`, `isLoading`, `isSuccess` вместо прямых проверок `status` для условного рендеринга. Это обеспечивает корректное поведение при всех комбинациях состояний, включая SWR-ошибки.

### Cache Entries (Кэш-записи)

`IResourceV2CacheEntry` предоставляет API для работы с конкретной записью кэша:

| Метод / Свойство | Описание |
|-------|----------|
| `machine$` | Signal (reactive) — текущее состояние машины |
| `peek()` | Non-reactive чтение машины |
| `isMyArgs(args)` | Проверить, соответствуют ли аргументы записи |
| `createPatch(patchFn)` | Создать оптимистичный патч. Возвращает `IPatchHandle \| null` |
| `invalidate()` | Принудительный рефетч для этой записи |
| `query(doForce?)` | Выполнить queryFn для аргументов записи |

### Agents (Агенты)

Agent — SWR-наблюдатель за ресурсом. Предоставляет вычисляемое состояние с удобными флагами.

```typescript
const agent = userResource.createAgent();
agent.start({ id: '1' });

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
| `error` | `unknown` | Текущая ошибка |
| `args` | `TArgs \| null` | Текущие аргументы |
| `isLoading` | `boolean` | Индикатор загрузки |
| `isInitialLoading` | `boolean` | `true` только при первой загрузке (нет предыдущих данных) |
| `isRefreshing` | `boolean` | `true` при обновлении существующих данных |
| `isSuccess` | `boolean` | `true` когда данные доступны |
| `isError` | `boolean` | `true` при ошибке |
| `entry` | `IResourceV2CacheEntry \| null` | Handle кэш-записи для оптимистичных патчей |

### SKIP

Специальный токен для пропуска запроса (полезен при условных запросах).

```typescript
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

const { SKIP } = unstable_queryV2;

const state = userResource.useResourceV2Agent(
    userId ? { id: userId } : SKIP,
);
```

### Cache Strategies (Стратегии кэша)

- **`serialize`** (по умолчанию) — аргументы сериализуются в строку (поддерживает SSR snapshots)
- **`compare`** — аргументы сравниваются функцией (не поддерживает snapshots)

### GC (Garbage Collection)

Кэш использует гибридную модель: refcount + timer.

- Пока есть активные подписчики (агенты), запись живёт
- Когда refcount падает до 0, запускается таймер `cacheLifetime`
- По истечении таймера запись удаляется из кэша

---

## Lifecycle Hooks (Хуки жизненного цикла)

### onCacheEntryAdded

Вызывается при создании новой записи кэша. Полезен для WebSocket-подписок.

> **Важно:** `$cacheDataLoaded` отклоняется (reject) при сбросе кэша (`resetAll()`) или удалении записи до загрузки данных. Всегда оборачивайте `await $cacheDataLoaded` в `try/catch`:

```typescript
const resource = api.createResourceV2({
    key: 'messages',
    queryFn: fetchMessages,
    onCacheEntryAdded: async (args, { $cacheDataLoaded, $cacheEntryRemoved }) => {
        try {
            await $cacheDataLoaded;
            // Устанавливаем подписки после загрузки данных
            const connection = wsClient.connect(`/ws/messages?userId=${args.id}`);
            await $cacheEntryRemoved;
            connection.close();
        } catch {
            // Запись удалена до загрузки данных — очистка не нужна
        }
    },
});
```

**Tools (`onCacheEntryAdded`):**

| Поле | Тип | Описание |
|------|-----|----------|
| `$cacheDataLoaded` | `Promise<TData>` | Разрешается при первом `success` |
| `$cacheEntryRemoved` | `Promise<void>` | Разрешается при удалении записи из кэша |

### onQueryStarted

Вызывается при каждом старте запроса (`queryFn`). `$queryFulfilled` разрешается с `{ data }` при успехе или отклоняется при ошибке:

```typescript
const resource = api.createResourceV2({
    key: 'todos',
    queryFn: fetchTodos,
    onQueryStarted: async (args, { $queryFulfilled, getCacheEntry }) => {
        const entry = getCacheEntry();
        const patch = entry.createPatch(draft => {
            draft.items.push({ id: 'temp', text: 'Saving...', completed: false });
        });
        try {
            await $queryFulfilled;
            patch?.commit();
        } catch {
            patch?.abort();
        }
    },
});
```

**Tools (`onQueryStarted`):**

| Поле | Тип | Описание |
|------|-----|----------|
| `$queryFulfilled` | `Promise<{ data: TData }>` | Разрешается при завершении запроса |
| `getCacheEntry` | `() => IResourceV2CacheEntry` | Получить текущую кэш-запись |

> **Миграция:** Подробный гайд по миграции с Query v1 на v2 планируется в `docs/migrations/`. Текущие примеры и API уже стабильны для использования.

---

## Plugins

Плагины расширяют ресурсы дополнительными методами. Типизация через generics.

### ReactHooksPlugin

Добавляет React-хуки к ресурсам:

```typescript
const api = unstable_queryV2.createApi({
    plugins: [new unstable_queryV2.ReactHooksPlugin()],
});

const userResource = api.createResourceV2<{ id: string }, User>({ /* ... */ });

function UserProfile({ userId }: { userId: string }) {
    const state = userResource.useResourceV2Agent({ id: userId });

    if (state.isLoading) return <div>Загрузка...</div>;
    if (state.isError) return <div>Ошибка</div>;

    return <div>{state.data?.name}</div>;
}
```

**Методы, добавляемые `ReactHooksPlugin`:**

| Метод | Описание |
|-------|----------|
| `useResourceV2Agent(args)` | React-хук агента (реактивное состояние + entry handle) |

> React-хуки можно использовать и без плагина:
> `unstable_queryV2.useResourceV2Agent(resource, args);`

---

## Сильная типизация

- Если `TArgs = void`, аргумент не нужен: `resource.query()` вместо `resource.query(undefined)`
- `getEntry(args, true)` / `getEntry$(args, true)` — возвращает `IResourceV2CacheEntry` (не `null`), т.к. запись гарантированно создаётся
- `useResourceV2Agent` принимает `SKIP` в аргументах
- Машины строго типизированы: методы доступны только для соответствующего состояния

---

## API Reference (экспорты)

```typescript
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

// Sentinel tokens
unstable_queryV2.SKIP;

// Machine classes
unstable_queryV2.Machine;
unstable_queryV2.MachinePending;
unstable_queryV2.MachineSuccess;
unstable_queryV2.MachineError;
unstable_queryV2.MachineRefreshing;
unstable_queryV2.MachineWithData;

// API
unstable_queryV2.createApi(options);

// React
unstable_queryV2.useResourceV2Agent(resource, args);

// Plugins
unstable_queryV2.ReactHooksPlugin;

// Snapshot version
unstable_queryV2.CURRENT_SNAPSHOT_VERSION;
```
