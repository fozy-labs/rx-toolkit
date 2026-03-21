# Фаза 4: Unit-тесты — ResourceRef и Store

## Цель

Создать unit-тесты для модулей управления кэшем и транзакциями: `QueriesCache`, `ResetAllQueriesSignal`, `ResourceRef`. Эти модули используют `IndirectMap` и `ReactiveCache` (протестированные в Phase 3).

## Зависимости

- **Requires**: Phase 3 (базовые модули протестированы)
- **Blocks**: Phase 5

## Тип выполнения

Последовательная. Рекомендуемый порядок: QueriesCache → ResetAllQueriesSignal → ResourceRef.

---

## Задачи

### Задача 4.1: Тест `QueriesCache`

**Новый файл**: `src/query/core/QueriesCache.test.ts`

**Исходный файл**: `src/query/core/QueriesCache.ts`

**Тест-кейсы** (из [06-testcases.md](../02-design/06-testcases.md)):

| # | Кейс | Описание |
|---|------|----------|
| TC-018 | getOrCreate: новый entry | Первый вызов создаёт ReactiveCache |
| TC-019 | getOrCreate: cache hit | Повторный вызов с тем же args → тот же cache |
| TC-020 | getOrCreate: разные args | `getOrCreate({id:1})` и `getOrCreate({id:2})` — разные entries |
| TC-021 | values(): все entries | Возвращает все активные ReactiveCache |
| TC-022 | Cleanup по таймеру | `cacheLifetime` истёк → entry удалён из IndirectMap |
| TC-023 | Default cacheLifetime = 60000 | Соответствует документации |

**Зависимости для теста**:
- Import: `QueriesCache` из `@/query/core/QueriesCache`
- `vi.useFakeTimers()` — для контроля таймеров
- Реальные зависимости: `IndirectMap`, `ReactiveCache` (не мокать — уже протестированы)

**Важно**: изучить конструктор `QueriesCache` — он может требовать `cacheLifetime` и другие параметры. Метод `getOrCreate` может принимать `args` и `initialState`.

---

### Задача 4.2: Тест `ResetAllQueriesSignal`

**Новый файл**: `src/query/core/ResetAllQueriesSignal.test.ts`

**Исходный файл**: `src/query/core/ResetAllQueriesSignal.ts`

**Тест-кейсы** (из [06-testcases.md](../02-design/06-testcases.md)):

| # | Кейс | Описание |
|---|------|----------|
| TC-055 | clean: вызывает next() через Batcher | Подписчики получают сигнал |
| TC-056 | Несколько подписчиков | Broadcast всем |
| TC-057 | Подписка/отписка | Нет утечек |

**Зависимости для теста**:
- Import: `ResetAllQueriesSignal` из `@/query/core/ResetAllQueriesSignal`
- Возможно потребуется `Batcher` для flush

**Примечание**: `ResetAllQueriesSignal` — статический singleton. Требуется reset между тестами (проверить есть ли метод reset или нужно подписываться/отписываться).

---

### Задача 4.3: Тест `ResourceRef`

**Новый файл**: `src/query/core/Resource/ResourceRef.test.ts`

**Исходный файл**: `src/query/core/Resource/ResourceRef.ts`

**Тест-кейсы** (из [06-testcases.md](../02-design/06-testcases.md)):

| # | Кейс | Описание |
|---|------|----------|
| TC-036 | createRef: создание ref для args | `resource.createRef(args)` возвращает ResourceRef |
| TC-037 | patch: produce + patches generated | `ref.patch(draft => { draft.x = 1 })` → UI обновляется |
| TC-038 | patch: inverse patches сохраняются | Для rollback |
| TC-039 | commit: фиксация транзакции | `ref.commit()` → из pending в committed |
| TC-040 | abort: откат к оригинальным данным | `ref.patch(...)` → `ref.abort()` → данные до patch |
| TC-041 | reapply: pending поверх свежих данных | Server update → pending patches переприменяются |
| TC-042 | Несколько patch подряд | `patch → patch → commit` → оба применены |
| TC-043 | patch → server update → reapply → commit | Комплексный сценарий |
| TC-044 | abort после commit — без эффекта | Committed нельзя отменить |
| TC-045 | invalidate: делегирует на resource.initiate | `ref.invalidate()` → re-fetch |
| TC-046 | enablePatches() вызван | immer patches работают |

**Зависимости для теста**:
- Import: нужно изучить как `ResourceRef` создаётся — вероятно через `Resource.createRef(args)`. Значит нужен объект `Resource` (или mock).
- `immer` — реальная реализация (тестируем patch-транзакции)
- Возможно потребуется создать `Resource` через `createResource()` с mock `queryFn`

**Сложность**: 🔴 Высокая — самый сложный тестовый файл фазы. Транзакционная логика с commit/abort/reapply требует тщательного тестирования.

**Стратегия**: создать минимальный Resource с mock queryFn, затем тестировать ResourceRef через `resource.createRef(args)`.

---

## Верификация

```bash
# 1. TypeScript компилируется
npx tsc --noEmit

# 2. Новые тесты проходят
npx vitest run src/query/core/QueriesCache.test.ts src/query/core/ResetAllQueriesSignal.test.ts src/query/core/Resource/ResourceRef.test.ts

# 3. Все тесты проходят
npx vitest run
```

## Conventional commit

```
test(query): add unit tests for QueriesCache, ResetAllQueriesSignal and ResourceRef

- QueriesCache: getOrCreate, cache hit/miss, cleanup timers
- ResetAllQueriesSignal: clean, broadcast, subscription lifecycle
- ResourceRef: patch/commit/abort/reapply transactions, invalidate, enablePatches
```
