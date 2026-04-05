---
title: "Research — api/resource.md structure analysis"
date: 2026-04-05
stage: 01-research
role: rdpi-codebase-researcher
---

# api/resource.md — What should go in the API reference

Sources: usage/resource.md (target design), api/README.md (pattern), concepts/architecture.md (glossary), common-mistakes.md (rules).

## 1. Sections (based on api/README.md pattern)

api/README.md follows: intro sentence → creation example → options table → methods table → link definitions.

api/resource.md should follow the same pattern:
- **Intro** — one sentence: что такое ресурс + ссылка на usage/resource.md
- **Создание** — `api.createResource(options)` minimal example (уже есть в api/README.md#createResource, здесь — с деталями опций)
- **Опции** — полная таблица (сигнатуры, типы, дефолты)
- **Возвращаемое значение** — типы/интерфейс `IApiResource`
- **Методы ресурса** — таблица методов экземпляра (сигнатуры, возвращаемые типы)
- **Типы** — `TResourceState` (возвращаемый useResource/agent), `CacheEntry` shape (если нужен для getEntry)
- **См. также** — ссылки на usage/resource.md, concepts/machine.md, usage/links.md

## 2. Options to document (from usage/resource.md — target design, rule #11)

| Опция | Тип | Default | Примечание |
|---|---|---|---|
| `queryFn` | `(args: TArgs, abortSignal: AbortSignal) => Promise<TData>` | **обязательный** | — |
| `key` | `string` | — | Префикс для кеш-ключей и devtools |
| `cacheRetentionTime` | `number \| false` | `60_000` | Переопределяет API-уровень |
| `serializeArgs` | `(args: TArgs) => string` | `stableStringify` | Переопределяет API-уровень |
| `onCacheEntryAdded` | `(args, lifecycle) => void` | — | Lifecycle hook |
| `onQueryStarted` | `(args, lifecycle) => void \| Promise<void>` | — | Lifecycle hook |

**НЕ добавлять** из кода (rule #11): `strategy`, `compareArg`, `doCacheArgs` — их нет в usage/resource.md. Если они нужны на уровне ресурса — пользователь запросит явно. (NB: они были добавлены в api/README.md по отдельному решению; для ресурса — только то, что в usage/resource.md.)

## 3. Methods to document (from usage/resource.md API table — target design)

| Метод | Сигнатура (из usage doc) | Возвращает |
|---|---|---|
| `useResource(args)` | `useResource(args: TArgs \| typeof SKIP)` | `TResourceState<TData>` |
| `trigger(args, doForce?)` | `trigger(args: TArgs, doForce?: boolean)` | `Promise<TData>` |
| `refresh(args)` | `refresh(args: TArgs)` | `void` |
| `getEntry(args, doInitiate?)` | `getEntry(args: TArgs, doInitiate?: boolean)` | `CacheEntry \| null` |
| `getEntry$(args, doInitiate?)` | `getEntry$(args: TArgs, doInitiate?: boolean)` | `CacheEntry \| null` |
| `createAgent()` | `createAgent()` | `Agent<TArgs, TData>` |
| `link(config)` | `link(config: TLinkConfig)` | `TLinkDeclaration` |

`useResource` — доступен только с `reactHooksPlugin()`. API ref должен указать это, но НЕ дублировать usage-примеры.

## 4. Return types to document

- **`TResourceState`** — объект, возвращаемый `useResource` / `agent.state$()`:
  - `status`: `'idle' | 'pending' | 'success' | 'error' | 'refreshing' | 'refresh-error'`
  - `data: TData | null`
  - `error: unknown`
  - `isLoading`, `isInitialLoading`, `isSuccess`, `isError`, `isRefreshing`, `isRefreshError` — boolean
  - Полная таблица уже в usage/resource.md → в API ref дать TS-интерфейс, НЕ повторять описательную таблицу

- **`CacheEntry`** — возвращается из getEntry/getEntry$. Упомянуть ключевые свойства: `machine$()`, подписка. Детали — ссылка на concepts/cache.md.

- **`Agent`** — возвращается из createAgent(). Ключевые методы: `start(args | SKIP)`, `state$()`. Детали — ссылка на concepts/agent.md.

## 5. How to avoid duplicating usage/resource.md

Принцип: **api/resource.md = ЧТО** (сигнатуры, типы, дефолты, constraints). **usage/resource.md = КАК** (примеры, паттерны, сценарии).

Конкретно:
- **Options**: api/ даёт полные TS-сигнатуры типов хуков (`onCacheEntryAdded`, `onQueryStarted` — lifecycle params). usage/ даёт примеры использования хуков.
- **Methods**: api/ даёт сигнатуру + одно предложение. usage/ даёт развёрнутые примеры и поведение (дедупликация trigger, SWR-семантика refresh).
- **Состояния**: api/ даёт TS-интерфейс `TResourceState`. usage/ даёт таблицу булевых флагов с описаниями и сценарий SWR-поведения.
- **Lifecycle hooks**: api/ даёт сигнатуру параметров lifecycle-объекта (`$cacheDataLoaded`, `$cacheEntryRemoved`, `entry`, `$queryFulfilled`). usage/ даёт примеры (WebSocket, обновление связанных кешей).
- **SKIP**: api/ — тип `typeof SKIP`, семантика в одно предложение. usage/ — примеры условных запросов.
- **createAgent**: api/ — сигнатура + ссылка на concepts/agent.md. usage/ — SWR-поведение, примеры start/idle.
- **useResource**: api/ — сигнатура, зависимость от плагина, ссылка на usage. usage/ — полный React-пример, поведение монтирования/размонтирования.

Перекрёстные ссылки: api/ ссылается на usage/ для примеров, usage/ ссылается на api/ для полных типов.
