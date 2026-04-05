# Research: Patching / Optimistic Updates (from existing docs + source)

## Patch Lifecycle: create → commit / abort
- `entry.createPatch(patchFn)` — принимает Immer-рецепт, возвращает `IPatchHandle { commit, abort }` или `null` (если статус не `success`/`refreshing` или нет изменений)
- `handle.commit()` → патч переходит `pending → committed`, «вплавляется» в базовые данные
- `handle.abort()` → патч переходит `pending → aborted`, применяются inversePatches — данные откатываются
- `abortAllPendingPatches()` — на машине, отменяет все pending-патчи разом (метод `MachineWithData`)

## patchState field semantics
- `TPatchState<TData> = { originalData, patches: TPatch[], isConsistencyViolation }`
- Присутствует на состояниях `success`, `refreshing`, `refresh-error`; `null` когда нет активных патчей
- Когда patchState != null: `data` = результат всех применённых патчей; `originalData` = нетронутые серверные данные
- `TPatch = { patches: Patch[], inversePatches: Patch[], status: "pending" | "committed" | "aborted" }`

## Immer integration
- `Patcher.createPatch` использует `produceWithPatches` из Immer (оригинал не мутируется)
- `Patcher.resolvePatches` и `Patcher.finishPatch` — статические методы, работают с Immer Patch[]
- Требуется `enablePatches()` из Immer
- Рецепт пользователя — стандартный Immer draft (`(draft) => { draft.x = 1 }`)

## Rebase on refresh
- `MachineRefreshing.successHappened(data)` → если patchState существует, вызывает `Patcher.resolvePatches(freshServerData, existingPatches)` — pending-патчи «ребейсятся» на свежие серверные данные
- committed-патчи при ребейсе потребляются (вливаются в базу), pending остаются в очереди

## Consistency violation detection
- Если abort одного патча ломает данные, на которые опирался другой (aborted out-of-order) → `isConsistencyViolation = true`
- При нарушении `_finishPatch` вызывает `invalidate()` — принудительный рефетч с сервера

## Links: optimisticUpdate (command.md)
- `resource.link({ optimisticUpdate: (draft, args) => void })` — декларативный API
- Немедленно мутирует кеш ресурса; при ошибке мутации — автоматический откат
- Можно комбинировать с `invalidate: true` в одном link

## Cross-references
- [machine.md](../docs/query/concepts/machine.md) — диаграмма: `createPatch/finishPatch/finishAllPatches` как self-loop на success/refreshing/refresh-error
- [architecture.md](../docs/query/concepts/architecture.md) → глоссарий: «Патч — оптимистичное обновление через Immer. Патчи накапливаются и ребейсятся при ответе сервера»
- [command.md](../docs/query/usage/command.md) → Links секция: `optimisticUpdate` field
- `patching.md` — запланированный NEW документ (ещё не создан), ссылка в docs-toc.md
