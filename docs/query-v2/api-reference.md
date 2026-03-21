# API Reference — RxQuery v2

> ⚠️ **Экспериментальный модуль.** API может измениться.

## createApi

Фабрика для создания API-инстанса.

```typescript
function createApi<TPlugins extends IPlugin[] = []>(
    options?: ICreateApiOptions<TPlugins>,
): IApi<TPlugins>;
```

### ICreateApiOptions

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|-------------|----------|
| `keyPrefix` | `string \| null` | `null` | Префикс ключей для namespace-изоляции |
| `keyStrategy` | `'serialize' \| 'compare'` | `'serialize'` | Стратегия ключей кэша |
| `serializeArgs` | `TSerializeArgsFn` | — | Кастомная сериализация аргументов |
| `compareArg` | `TCompareArgsFn` | — | Кастомное сравнение аргументов |
| `cacheLifetime` | `number` | `60000` | Время жизни кэша (мс) |
| `plugins` | `IPlugin[]` | `[]` | Массив плагинов |
| `initialSnapshot` | `TApiSnapshot \| null` | `null` | Начальный snapshot (SSR) |
| `maxSnapshotDataAge` | `number` | `300000` | Макс. возраст snapshot-данных (мс) |
| `doCacheArgs` | `boolean` | `false` | Кэшировать ли аргументы в кэш-записи |

### IApi

| Метод | Сигнатура | Описание |
|-------|-----------|----------|
| `createResource` | `<TArgs, TData, TError>(options: IResourceV2Options) => IResourceV2 & PluginAugmentations` | Создать ресурс |
| `resetAll` | `() => void` | Сбросить все ресурсы |
| `getSnapshot` | `() => TApiSnapshot` | Получить snapshot для SSR |

---

## api.createResource

Создаёт ресурс, привязанный к API-инстансу.

### IResourceV2Options

| Параметр | Тип | Описание |
|----------|-----|----------|
| `key` | `string` | Уникальный ключ ресурса (обязателен для SSR snapshots) |
| `queryFn` | `(args: TArgs, tools: TQueryFnTools) => Promise<TData>` | Функция запроса |
| `cacheLifetime` | `number` | Время жизни кэша (мс), переопределяет API-уровень |
| `serializeArgs` | `TSerializeArgsFn` | Кастомная сериализация (переопределяет API-уровень) |
| `compareArg` | `TCompareArgsFn` | Кастомное сравнение (переопределяет API-уровень) |
| `onCacheEntryAdded` | `TOnCacheEntryAdded<TArgs, TData>` | Хук при добавлении записи в кэш |
| `onQueryStarted` | `TOnQueryStarted<TArgs, TData>` | Хук при старте запроса |
| `beforeDevtoolsPush` | `TBeforeDevtoolsPushFn` | Перехват перед devtools |
| `maxSnapshotDataAge` | `number` | Возраст данных для snapshot (мс) |
| `doCacheArgs` | `boolean` | Кэшировать ли аргументы |

### TQueryFnTools

| Поле | Тип | Описание |
|------|-----|----------|
| `abortSignal` | `AbortSignal` | Сигнал для отмены запроса |

---

## IResourceV2

Интерфейс ресурса (публичный API).

| Метод | Сигнатура | Описание |
|-------|-----------|----------|
| `createAgent` | `() => IResourceV2Agent` | Создать агента (observer + SWR) |
| `query` | `(args, doForce?) => Promise<ICacheEntry>` | Выполнить запрос |
| `query$` | `(args, doForce?) => TMachine` | Реактивный запрос (signal read) |
| `entry` | `(args, doInitiate?) => ICacheEntry \| null` | Получить запись кэша (нереактивно) |
| `entry$` | `(args, doInitiate?) => TMachine` | Получить запись кэша (реактивно) |
| `invalidate` | `(args) => void` | Инвалидировать запись |
| `compareArgs` | `(a, b) => boolean` | Сравнить аргументы |

---

## IResourceV2Agent

Агент — наблюдатель за ресурсом с stale-while-revalidate.

| Поле/Метод | Сигнатура | Описание |
|------------|-----------|----------|
| `state$` | `() => IResourceV2AgentState` | Реактивное состояние (computed signal) |
| `start` | `(args: TArgs \| SKIP_TOKEN) => Promise<void>` | Начать запрос с новыми аргументами |
| `compareArgs` | `(a, b) => boolean` | Сравнить аргументы |

### IResourceV2AgentState

| Поле | Тип | Описание |
|------|-----|----------|
| `status` | `TMachineStatus` | Текущий статус: `'idle'` \| `'pending'` \| `'success'` \| `'error'` \| `'refreshing'` |
| `data` | `TData \| null` | Текущие данные |
| `error` | `TError \| null` | Текущая ошибка |
| `args` | `TArgs \| null` | Текущие аргументы |
| `isLoading` | `boolean` | Загрузка (pending или refreshing) |
| `isInitialLoading` | `boolean` | Первая загрузка (нет предыдущих данных) |
| `isRefreshing` | `boolean` | Обновление существующих данных |
| `isSuccess` | `boolean` | Данные доступны |
| `isError` | `boolean` | Ошибка |
| `refreshError` | `TError \| null` | Ошибка фонового обновления |

---

## IResourceV2Ref

Императивный доступ к записи кэша.

| Поле/Метод | Сигнатура | Описание |
|------------|-----------|----------|
| `has` | `boolean` (readonly) | Наличие записи в кэше |
| `lock` | `() => { unlock: () => void }` | Заблокировать запись |
| `invalidate` | `() => void` | Инвалидировать |
| `createPatch` | `(patchFn: TPatchFn<TData>) => { commit, abort } \| null` | Создать оптимистичный патч |
| `create` | `(data: TData) => void` | Предзаполнить кэш |

---

## Machine Classes

Классы машины состояний, определяющие текущее состояние кэш-записи.

| Класс | Статус | Данные | Ошибка | Описание |
|-------|--------|--------|--------|----------|
| `MachineIdle` | `'idle'` | `null` | `null` | Начальное состояние |
| `MachinePending` | `'pending'` | `null` | `null` | Запрос выполняется |
| `MachineSuccess` | `'success'` | `TData` | `null` | Данные загружены |
| `MachineError` | `'error'` | `null` | `TError` | Ошибка запроса |
| `MachineRefreshing` | `'refreshing'` | `TData` | `null` | Обновление с данными |

### TMachineStatus

```typescript
type TMachineStatus = 'idle' | 'pending' | 'success' | 'error' | 'refreshing';
```

---

## Lifecycle Hooks

### TOnCacheEntryAdded

```typescript
type TOnCacheEntryAdded<TArgs, TData> = (
    args: TArgs,
    tools: TCacheEntryAddedTools<TData>,
) => void | Promise<void>;
```

#### TCacheEntryAddedTools

| Поле | Тип | Описание |
|------|-----|----------|
| `$cacheDataLoaded` | `Promise<TData>` | Разрешается при первом `MachineSuccess` |
| `$cacheEntryRemoved` | `Promise<void>` | Разрешается при удалении записи |
| `getCacheEntry` | `() => TMachine` | Текущее состояние машины |

### TOnQueryStarted

```typescript
type TOnQueryStarted<TArgs, TData> = (
    args: TArgs,
    tools: TQueryStartedTools<TData>,
) => void | Promise<void>;
```

#### TQueryStartedTools

| Поле | Тип | Описание |
|------|-----|----------|
| `$queryFulfilled` | `Promise<{ data: TData; isError: false }>` | Разрешается при завершении запроса |
| `getCacheEntry` | `() => ICacheEntry` | Запись кэша для патчинга |

---

## Plugins

### IPlugin

```typescript
interface IPlugin {
    readonly name: string;
    install(context: IPluginContext): void;
    augmentResource<TArgs, TData, TError>(
        resource: IResourceV2<TArgs, TData, TError>,
        options: IResourceV2Options<TArgs, TData, TError>,
    ): Record<string, unknown>;
}
```

### ReactHooksPlugin

Добавляет React-хуки к ресурсам:

| Метод | Сигнатура | Описание |
|-------|-----------|----------|
| `useResourceV2Agent` | `(args: TArgs \| SKIP_TOKEN) => IResourceV2AgentState` | React-хук агента |
| `useResourceV2Ref` | `(args: TArgs \| SKIP_TOKEN) => IResourceV2Ref` | React-хук ref |

> **Standalone-импорт:** Хуки `useResourceV2Agent` и `useResourceV2Ref` доступны как отдельные функции без `ReactHooksPlugin`:
> ```typescript
> import { useResourceV2Agent } from '@fozy-labs/rx-toolkit/query-v2/react';
> const state = useResourceV2Agent(resource, args);
> ```

---

## Snapshot Types

### TApiSnapshot

| Поле | Тип | Описание |
|------|-----|----------|
| `version` | `number` | Версия формата |
| `keyPrefix` | `string \| null` | Префикс ключей API |
| `resources` | `Record<string, TResourceSnapshot>` | Snapshots ресурсов |

### TResourceSnapshot

| Поле | Тип | Описание |
|------|-----|----------|
| `entries` | `Record<string, TResourceV2SnapshotSlice>` | Записи кэша |

### TResourceV2SnapshotSlice

| Поле | Тип | Описание |
|------|-----|----------|
| `status` | `'success'` | Всегда success (только успешные записи) |
| `args` | `unknown` | Аргументы запроса |
| `data` | `TData` | Данные |
| `updatedAt` | `number` | Timestamp обновления |
