# Внешнее исследование

## 1. Сравнение с аналогами

### 1.1 TanStack Query (React Query)

**Архитектурные параллели с rx-toolkit:**

| Концепция | TanStack Query | rx-toolkit |
|-----------|---------------|------------|
| Кэшируемый запрос | `useQuery` | `useResourceAgent` + `createResource` |
| Мутация | `useMutation` | `useCommandAgent` + `createCommand` |
| Skip запроса | `enabled: false` / `skipToken` | `SKIP` symbol |
| Инвалидация | `queryClient.invalidateQueries()` | `ref.invalidate()` / link с `invalidate: true` |
| Глобальный сброс | `queryClient.clear()` | `resetAllQueriesCache()` |
| Optimistic updates | `onMutate` + `onError` rollback | `link.optimisticUpdate` + auto-rollback |
| Состояние | `{ isLoading, isError, data, error }` | `{ isLoading, isError, isInitialLoading, isReloading, data, error }` |
| Cache lifetime | `gcTime`, `staleTime` | `cacheLifetime` (single parameter) |
| Devtools | @tanstack/query-devtools | Встроенный через Redux DevTools |

**Что TanStack Query делает лучше:**
- Отдельные `staleTime` (когда считать данные устаревшими) и `gcTime` (когда удалять из кэша) — rx-toolkit объединяет это в `cacheLifetime`.
- Retry logic — автоматические повторные попытки при ошибке. В rx-toolkit отсутствует.
- Refetch on window focus / network reconnect — автоматическая перезагрузка. В rx-toolkit отсутствует.
- Infinite queries / pagination — встроенная поддержка пагинации. В rx-toolkit нет.
- **Типы полностью экспортированы** и являются частью публичного API.
- Обширный набор тестов (1600+).

**Что rx-toolkit делает интересно:**
- **Patch-транзакции** (commit/abort) — уникальная фича, отсутствующая в TanStack Query.
- **Signal-based reactivity** — вычислениe state через Computed signals вместо subscription + re-render.
- **Link система** — декларативная связь команд с ресурсами.
- **ResourceDuplicator** — агрегация нескольких ресурсных запросов.

### 1.2 SWR (Stale-While-Revalidate)

| Аспект | SWR | rx-toolkit |
|--------|-----|------------|
| Подход | Hooks-first, минимализм | Signal-based, OOP core |
| Mutations | `useSWRMutation` | `useCommandAgent` |
| Cache | Global cache by key (string) | Per-instance cache by args (object comparison) |
| Revalidation | Automatic (focus, interval, network) | Manual (initiate, invalidate) |
| Bundle size | ~4KB | Зависит от tree-shaking |

**SWR — ключевой урок**: простота API. SWR доказал, что минимальный API (`useSWR(key, fetcher)`) может покрыть 80% use cases. rx-toolkit имеет более сложный API (`createResource + useResourceAgent`), что увеличивает порог входа.

### 1.3 RTK Query (Redux Toolkit Query)

| Аспект | RTK Query | rx-toolkit |
|--------|-----------|------------|
| Подход | Endpoints definition | createResource / createCommand |
| Store integration | Redux store | Signals + RxJS |
| Code generation | OpenAPI codegen | Нет |
| Cache tags | Tag-based invalidation | Link-based invalidation |
| Optimistic updates | `onQueryStarted` + `updateQueryData` | `link.optimisticUpdate` |
| TypeScript | Полная типизация, экспортированные типы | Частичная (типы не экспортируются) |

**RTK Query — ключевой урок**: `link` система rx-toolkit концептуально близка к `providesTags/invalidatesTags` RTK Query, но мощнее благодаря прямому patching через Immer.

---

## 2. Best Practices для TypeScript-библиотек

### 2.1 Публичный API

1. **Все публичные типы должны быть экспортированы** — потребителям нужны типы для generic-функций, HOC, и proper typing. rx-toolkit нарушает это правило для query-типов.
2. **Avoid `any` in public API** — даже в internal helpers, `any` может "протечь" через type inference. Предпочитать `unknown` или generic constraints.
3. **Consistent naming** — опечатки в типах (`Instanse`) становятся постоянной частью API. Исправление позже — breaking change.
4. **Barrel exports должны быть полными** — если тип используется в return type публичной функции, он должен быть экспортирован.

### 2.2 Предрелизный чеклист для npm-пакетов

- [ ] `npm pack` + проверка содержимого tarball
- [ ] Проверка, что `dist/` содержит все необходимые файлы
- [ ] `.d.ts` файлы сгенерированы и корректны
- [ ] `exports` в package.json соответствуют реальной структуре dist
- [ ] `peerDependencies` верны и не слишком restrictive
- [ ] `sideEffects` поле корректно
- [ ] README.md содержит установку, базовый пример, ссылки на docs
- [ ] CHANGELOG актуален
- [ ] Лицензия (LICENSE) включена в `files`
- [ ] Все `@deprecated` API задокументированы с migration path
- [ ] Тесты проходят (`npm test`)
- [ ] Type check проходит (`tsc --noEmit`)
- [ ] Нет console.log/warn/error в production коде (кроме намеренных)

### 2.3 Политика экспортов

Рекомендуемая структура exports для library:

```json
{
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./signals": { "import": "./dist/signals/index.js", "types": "./dist/signals/index.d.ts" },
    "./query": { "import": "./dist/query/index.js", "types": "./dist/query/index.d.ts" }
  }
}
```

Это позволяет:
- Tree-shaking на уровне модулей
- Потребителям, не использующим query, не загружать immer/RxJS операторы
- Более чистые imports

---

## 3. Паттерны тестирования React hooks-библиотек

### 3.1 Рекомендуемая стратегия

1. **Unit-тесты core logic** (без React) — тестировать Resource, Command, QueriesCache, ReactiveCache, IndirectMap в изоляции.
2. **Integration-тесты hooks** — с `@testing-library/react` + `renderHook` для useResourceAgent, useCommandAgent, useResourceRef.
3. **Scenario-тесты** — имитация реальных сценариев (fetch → cache → refetch → invalidate → optimistic update → rollback).

### 3.2 Mock-стратегия для async queries

```typescript
// Паттерн: controlable promise для тестирования loading states
function createControllablePromise<T>() {
  let resolve: (value: T) => void;
  let reject: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve: resolve!, reject: reject! };
}
```

### 3.3 Что тестировать в query-библиотеке

- Cache hit / miss
- Cache expiration (timer-based)
- Concurrent requests (same args)
- Args comparison (shallow equal edge cases)
- Abort on re-initiate
- Error → retry → success flow
- Optimistic update → commit flow
- Optimistic update → abort (rollback) flow
- SKIP token behaviour
- Lifecycle hooks (onCacheEntryAdded, onQueryStarted)
- Global reset (resetAllQueriesCache)
- Lock/unlock mechanics
- ResourceRef operations (patch, create, invalidate)
- Memory leaks (cache cleanup after timeout)

---

## 4. Риски зависимостей

### 4.1 `observable-hooks` ^4.2.4

В `package.json` как `dependency`, но ни один import в src/query/ не использует его. Возможно используется в signals (через `useSignal` → `useObservable` из observable-hooks).

- **Вопрос**: является ли observable-hooks необходимой dependency, или может быть заменена?
- **Риск**: дополнительная зависимость увеличивает bundle size.

### 4.2 `immer` ^10.1.3

- Используется для patch-транзакций в ResourceRef.
- `enablePatches()` — глобальный side-effect.
- **Риск**: потребители, не использующие patch API, всё равно загружают immer.

### 4.3 `zod` ^4.0.0

- Peer dependency, используется только в LocalState (signals).
- **Риск**: потребители, не использующие LocalState с zod-валидацией, всё равно должны установить zod (хоть peer dependency nullable с npm 7+, но TypeScript может жаловаться).

### 4.4 `react` ^19.0.0

- **Крайне ограничительно**. React 19 вышел в декабре 2024. Многие проекты ещё на React 18.
- Внутренний код не использует React 19-specific API (нет `use()`, нет Actions).
- **Рекомендация**: расширить до `^18.0.0 || ^19.0.0`.
