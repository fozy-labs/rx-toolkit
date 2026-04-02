---
title: "External Research: TanStack Query v5 Core Architecture"
date: 2026-04-02
stage: 01-research
role: rdpi-external-researcher
---

## Comparative Analysis

| Concept | Query | Mutation | Shared? | Confidence |
|---------|-------|----------|---------|------------|
| Entity class | `Query` | `Mutation` | Both extend `Removable` | High |
| Observer class | `QueryObserver` | `MutationObserver` | Both extend `Subscribable` | High |
| Cache class | `QueryCache` | `MutationCache` | Both extend `Subscribable`, separate instances | High |
| State machine | Inline reducer in `Query.#dispatch()` | Inline reducer in `Mutation.#dispatch()` | **Not shared** — independent reducers | High |
| Subscription mechanism | `Subscribable<TListener>` base | Same | **Shared** — identical base class | High |
| GC mechanism | `Removable` abstract class | Same | **Shared** — identical base class | High |

## 1. How Query vs Mutation Are Separated

- **Completely independent class hierarchies** — no shared "Operation" or "BaseEntity" abstraction
- `packages/query-core/src/query.ts` — `Query extends Removable`
- `packages/query-core/src/mutation.ts` — `Mutation extends Removable`
- `packages/query-core/src/queryObserver.ts` — `QueryObserver extends Subscribable`
- `packages/query-core/src/mutationObserver.ts` — `MutationObserver extends Subscribable`
- Separate cache files: `queryCache.ts`, `mutationCache.ts`
- The only unifying point is `QueryClient`, which holds both caches:
  ```
  QueryClient {
    #queryCache: QueryCache
    #mutationCache: MutationCache
  }
  ```
- Framework adapters (react, vue, svelte, etc.) import from `@tanstack/query-core` and wrap observers

## 2. Shared Base Classes

### `Subscribable<TListener>` (`subscribable.ts`)
- Generic pub/sub with `subscribe(listener) → unsubscribe`
- Tracks listeners in a `Set<TListener>`
- Provides `onSubscribe()` / `onUnsubscribe()` hooks (no-op by default, overridden)
- Used by: `QueryObserver`, `MutationObserver`, `QueriesObserver`, `QueryCache`, `MutationCache`
- ~30 lines total — extremely minimal

### `Removable` (`removable.ts`)
- Abstract class handling garbage collection via `gcTime`
- Methods: `scheduleGc()`, `updateGcTime()`, `clearGcTimeout()`, `destroy()`
- Abstract: `optionalRemove()` — each entity decides its own removal logic
- Used by: `Query`, `Mutation`
- `Query.optionalRemove()` — removes from cache if no observers AND fetchStatus === 'idle'
- `Mutation.optionalRemove()` — removes from cache if no observers AND status !== 'pending'

### What is **NOT** shared
- No abstract `BaseObserver` — QueryObserver (745 lines) and MutationObserver (227 lines) are completely independent
- No shared state type — `QueryState` and `MutationState` are independent interfaces
- No shared action types — each defines its own `Action` union
- No shared result type — `QueryObserverResult` vs `MutationObserverResult`

## 3. Cache Management

- **Two separate caches**, not a unified cache
- `QueryCache` uses `Map<string, Query>` (keyed by `queryHash`)
- `MutationCache` uses `Set<Mutation>` + `Map<string, Mutation[]>` for scopes
- Both extend `Subscribable` to notify external listeners (devtools, persistence)
- Both have a `build()` factory method:
  - `QueryCache.build()` — deduplicates by queryHash (returns existing if found)
  - `MutationCache.build()` — always creates new Mutation (no dedup)
- `QueryClient.clear()` calls both `#queryCache.clear()` and `#mutationCache.clear()`
- Notification event types are separate: `QueryCacheNotifyEvent` vs `MutationCacheNotifyEvent`
  - Query events: `added`, `removed`, `updated`, `observerAdded`, `observerRemoved`, `observerResultsUpdated`, `observerOptionsUpdated`
  - Mutation events: `added`, `removed`, `updated`, `observerAdded`, `observerRemoved`, `observerOptionsUpdated`

## 4. State Machines

### Query state machine (`query.ts` `#dispatch`)
- **Inline reducer** — not extracted, defined as a closure inside `#dispatch()`
- Actions: `fetch`, `success`, `error`, `failed`, `pause`, `continue`, `invalidate`, `setState`
- State shape: `QueryState { data, dataUpdatedAt, error, errorUpdatedAt, fetchStatus, status, isInvalidated, fetchFailureCount, ... }`
- Two status dimensions: `status` (`pending` | `success` | `error`) + `fetchStatus` (`fetching` | `paused` | `idle`)

### Mutation state machine (`mutation.ts` `#dispatch`)
- **Inline reducer** — same pattern, defined as closure inside `#dispatch()`
- Actions: `pending`, `success`, `error`, `failed`, `pause`, `continue`
- State shape: `MutationState { data, error, status, variables, context, isPaused, failureCount, submittedAt, ... }`
- Single status dimension: `status` (`idle` | `pending` | `success` | `error`)

### Key difference: **reducers are NOT shared**
- Both use `switch (action.type)` reducer pattern
- Both call `notifyManager.batch()` after state update to notify observers
- But the state shapes and action sets are different enough that sharing isn't practical
- Query has `fetchStatus`/`isInvalidated`/`dataUpdatedAt` concepts that don't apply to mutations
- Mutations have `variables`/`context`/`submittedAt` that don't apply to queries

## 5. Subscription Mechanism

### Entity → Observer notification
- `Query` maintains `observers: Array<QueryObserver>` — calls `observer.onQueryUpdate()` on dispatch
- `Mutation` maintains `#observers: Array<MutationObserver>` — calls `observer.onMutationUpdate(action)` on dispatch
- Pattern identical, but method names differ (`onQueryUpdate` vs `onMutationUpdate`)

### Observer → Consumer notification
- Both observers extend `Subscribable` — consumers call `observer.subscribe(callback)`
- `QueryObserver.#notify()` — iterates `this.listeners`, also notifies `QueryCache`
- `MutationObserver.#notify()` — iterates `this.listeners`, also fires lifecycle callbacks (onSuccess, onError, onSettled)

### Cache → External notification
- Both caches extend `Subscribable` — devtools/persistence subscribe to cache events
- Same pattern: `cache.subscribe((event) => ...)` returns unsubscribe fn
- `persistQueryClientSubscribe()` subscribes to BOTH caches independently

### All notification goes through `notifyManager`
- `notifyManager.batch()` — batches updates to avoid excessive re-renders
- Shared across queries and mutations
- Framework adapters use `notifyManager.batchCalls()` to wrap observer callbacks

## Established Practices

- **Minimal shared abstraction**: Only 2 shared base classes (~65 lines combined). Everything else is specialized
- **Composition over inheritance**: `QueryClient` composes `QueryCache` + `MutationCache` rather than having a unified cache
- **Framework-agnostic core**: `@tanstack/query-core` has zero framework dependencies. Framework packages wrap core observers
- **Observer pattern is the integration seam**: React/Vue/Svelte all use `observer.subscribe()` + `useSyncExternalStore` (or equivalent)
- **Each entity owns its reducer**: No extracted state machine library — reducers are inline closures in `#dispatch()`
- **Deduplication only for queries**: `QueryCache.build()` returns existing query by hash; `MutationCache.build()` always creates new

## Opinions and Speculation

- The lack of a shared Observer base class means significant code duplication (~50% of observer logic is structurally similar: constructor, setOptions, subscribe lifecycle, notify pattern). This appears to be a deliberate choice for simplicity over DRY. **Low** — architectural inference
- The inline reducer approach (instead of a state machine library like XState) keeps the bundle small and dependency-free, but makes state transitions harder to visualize/test in isolation. **Medium** — based on codebase inspection

## Pitfalls

- **Separate caches mean separate subscription management**: Persistence plugins must subscribe to both caches independently (`persistQueryClientSubscribe` in `persist.ts`)
- **No shared "operation" concept**: If you need cross-cutting behavior across queries and mutations, you must implement it in `QueryClient` or duplicate it
- **Observer lifecycle differences**: `QueryObserver` auto-fetches on subscribe and has stale/refetch timers. `MutationObserver` does nothing on subscribe — waits for explicit `mutate()` call. Abstracting over both would lose these semantics
- **GC timing**: Both use `Removable.scheduleGc()`, but removal conditions differ (Query checks fetchStatus, Mutation checks status)

## Performance

- `Subscribable` uses `Set<TListener>` for O(1) add/remove — confirmed in source
- `QueryCache` uses `Map<string, Query>` for O(1) lookup by hash
- `MutationCache` uses `Set<Mutation>` — no dedup, O(n) for `find()`/`findAll()` with filters
- `notifyManager.batch()` coalesces notifications to avoid render thrashing
- `timeoutManager` is configurable for environments with setTimeout scalability issues (thousands of queries)
- **No benchmarks found** in repo or docs for core operation overhead

## Sources
- [TanStack/query `subscribable.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/subscribable.ts) — shared pub/sub base
- [TanStack/query `removable.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/removable.ts) — shared GC base
- [TanStack/query `query.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/query.ts) — Query entity + state machine
- [TanStack/query `mutation.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/mutation.ts) — Mutation entity + state machine
- [TanStack/query `queryObserver.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/queryObserver.ts) — Query observer
- [TanStack/query `mutationObserver.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/mutationObserver.ts) — Mutation observer
- [TanStack/query `queryCache.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/queryCache.ts) — Query cache
- [TanStack/query `mutationCache.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/mutationCache.ts) — Mutation cache
- [TanStack/query `queryClient.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/queryClient.ts) — unifying client
- [TanStack/query `index.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/index.ts) — public API surface
- [TanStack Query Overview](https://tanstack.com/query/latest/docs/framework/react/overview) — official docs
