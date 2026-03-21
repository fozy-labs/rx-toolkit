# Фаза 5: Unit-тесты — Resource, Command и Lifecycle

## Цель

Создать unit-тесты для ключевых core-модулей: `Resource` (жизненный цикл запросов), `Command` (мутации и link-система), `QueriesLifetimeHooks` (callback lifecycle) и `ResourceDuplicator` (агрегация). Это самая объёмная фаза тестирования.

## Зависимости

- **Requires**: Phase 4 (QueriesCache, ResourceRef протестированы)
- **Blocks**: Phase 6

## Тип выполнения

Последовательная. Рекомендуемый порядок: Resource → Command → QueriesLifetimeHooks → ResourceDuplicator.

---

## Задачи

### Задача 5.1: Тест `Resource`

**Новый файл**: `src/query/core/Resource/Resource.test.ts`

**Исходный файл**: `src/query/core/Resource/Resource.ts`

**Тест-кейсы** (из [06-testcases.md](../02-design/06-testcases.md)):

| # | Кейс | Описание |
|---|------|----------|
| TC-024 | initiate: success flow | `initiate(args)` → queryFn вызван → state = success с data |
| TC-025 | initiate: error flow | queryFn throws → state = error |
| TC-026 | isLoading → success transition | state.isLoading = true → resolve → isLoading = false |
| TC-027 | isInitialLoading vs isReloading | Первый = isInitialLoading; повторный = isReloading |
| TC-028 | abort при повторном вызове | `initiate(a)` → `initiate(b)` → первый aborted |
| TC-029 | тот же args — dedup | Два `initiate({id:1})` → один fetch |
| TC-030 | compareArgs: shallowEqual default | `{a:1}` == `{a:1}` (новый объект) |
| TC-031 | compareArgs: custom function | `compareArgs: deepEqual` |
| TC-032 | createWithData: создание с данными | Предзаполненный state без fetch |
| TC-033 | createWithData: игнорируется если initiated | Если уже initiate вызван — no-op |
| TC-034 | success: сброс transactions | `savedData: null, transactions: null` |
| TC-035 | state transitions: полный цикл | idle → loading → success → loading → success |

**Зависимости для теста**:
- Создание Resource через внутренний конструктор или `createResource()` из `@/query/api/createResource`
- Mock `queryFn` с controlable promise
- `vi.useFakeTimers()` для cache lifetime
- Паттерн: `flushMicrotasks()` из `src/__tests__/helpers/async-helpers.ts`

**Стратегия**:
1. Создать Resource через `createResource({ queryFn: vi.fn(), cacheLifetime })` 
2. Создать agent через `resource.createAgent()`
3. Вызывать `agent.initiate(args)` и проверять `agent.state$`
4. Использовать `controlablePromise` для контроля resolve/reject

**Сложность**: 🔴 Высокая — самый сложный компонент, множество state transitions.

---

### Задача 5.2: Тест `Command`

**Новый файл**: `src/query/core/Command/Command.test.ts`

**Исходный файл**: `src/query/core/Command/Command.ts`

**Тест-кейсы** (из [06-testcases.md](../02-design/06-testcases.md)):

| # | Кейс | Описание |
|---|------|----------|
| TC-047 | initiate: success flow | `initiate(args)` → queryFn → state = success |
| TC-048 | initiate: error flow | queryFn throws → state = error |
| TC-049 | state transitions: idle → loading → success | Полный цикл |
| TC-050 | link: update после success | `link.update(result)` → ResourceRef.patch |
| TC-051 | link: optimisticUpdate → commit | optimistic patch → success → commit |
| TC-052 | link: optimisticUpdate → abort | optimistic patch → error → abort (rollback) |
| TC-053 | link: invalidate после success | `link.invalidate: true` → resource re-initiate |
| TC-054 | concurrent initiate (same args) | Race condition проверка |

**Зависимости для теста**:
- `createCommand()` из `@/query/api/createCommand`
- `createResource()` — для тестов с link
- Mock `queryFn` (для Command и связанного Resource)
- Controlable promise для async-контроля

**Стратегия**:
1. Простые тесты (TC-047..049): `createCommand({ queryFn })` без link
2. Link-тесты (TC-050..053): `createCommand({ queryFn, link: { resource, getArgs, ... } })`
3. Для link-тестов нужен предварительно инициализированный Resource с данными

**Сложность**: 🟡 Средняя — link-система добавляет сложность, но основана на уже протестированном ResourceRef.

---

### Задача 5.3: Тест `QueriesLifetimeHooks`

**Новый файл**: `src/query/core/QueriesLifetimeHooks.test.ts`

**Исходный файл**: `src/query/core/QueriesLifetimeHooks.ts`

**Тест-кейсы** (из [06-testcases.md](../02-design/06-testcases.md)):

| # | Кейс | Описание |
|---|------|----------|
| TC-058 | onQueryStarted: вызывается при initiate | callback вызван с args |
| TC-059 | $queryFulfilled: resolves при success | Promise resolves с data |
| TC-060 | $queryFulfilled: rejects при error | Promise rejects с error |
| TC-061 | onCacheEntryAdded: вызывается при создании | callback вызван |
| TC-062 | SharedOptions.onQueryError: при ошибке | Глобальный error handler |
| TC-063 | Devtools: условный вызов | `Devtools.hasDevtools` → stateDevtools вызван |

**Зависимости для теста**:
- `QueriesLifetimeHooks` из `@/query/core/QueriesLifetimeHooks`
- `SharedOptions` из `@/common/options/SharedOptions` — для мока `onQueryError`
- `Devtools` из `@/signals` — для TC-063
- `resetSharedOptions()` — из setup

**Стратегия**: тестировать `QueriesLifetimeHooks` изолированно через конструктор, либо через интеграцию с `Resource` (если hooks тяжело тестировать напрямую).

**Сложность**: 🟡 Средняя.

---

### Задача 5.4: Тест `ResourceDuplicator`

**Новый файл**: `src/query/core/Resource/ResourceDuplicator.test.ts`

**Исходный файл**: `src/query/core/Resource/ResourceDuplicator.ts`

**Тест-кейсы** (из [06-testcases.md](../02-design/06-testcases.md)):

| # | Кейс | Описание |
|---|------|----------|
| TC-064 | Создание из нескольких ресурсов | `createResourceDuplicator([res1, res2])` |
| TC-065 | initiate: все ресурсы инициируются | Каждый ресурс получает свои args |
| TC-066 | Агрегация: isLoading | isLoading пока хотя бы один loading |
| TC-067 | Агрегация: isError | isError если хотя бы один error |
| TC-068 | serialize: уникальный ключ | Разные args → разные ключи |

**Зависимости для теста**:
- `createResourceDuplicator()` из `@/query/api/createResourceDuplicator`
- `createResource()` — несколько ресурсов для агрегации
- Mock queryFn для каждого ресурса

**Сложность**: 🟡 Средняя — `ResourceDuplicator` имеет сложную внутреннюю логику, но тестируем через публичный API.

---

## Верификация

```bash
# 1. TypeScript компилируется
npx tsc --noEmit

# 2. Новые тесты проходят
npx vitest run src/query/core/Resource/Resource.test.ts src/query/core/Command/Command.test.ts src/query/core/QueriesLifetimeHooks.test.ts src/query/core/Resource/ResourceDuplicator.test.ts

# 3. Все тесты проходят
npx vitest run
```

## Conventional commit

```
test(query): add unit tests for Resource, Command, LifetimeHooks and ResourceDuplicator

- Resource: full lifecycle (initiate, success, error, abort, dedup, compareArgs, createWithData)
- Command: initiate flow, link system (update, optimisticUpdate, invalidate, abort)
- QueriesLifetimeHooks: onQueryStarted, onCacheEntryAdded, $queryFulfilled, SharedOptions.onQueryError
- ResourceDuplicator: creation, initiate, state aggregation, serialize
```
