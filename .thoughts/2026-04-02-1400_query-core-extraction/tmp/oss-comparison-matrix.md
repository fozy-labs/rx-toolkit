---
title: "OSS Comparison Matrix: Query/Mutation Architecture"
date: 2026-04-02
stage: 01-research
role: synthesis
sources:
  - tanstack-query-analysis.md
  - rtk-query-analysis.md
  - apollo-analysis.md
  - swr-urql-analysis.md
  - shared-infra.md
  - command-structure.md
  - cache-entry-comparison.md
---

## 1. Comparison Matrix

| Dimension | rx-toolkit (current) | TanStack React Query v5 | RTK Query | Apollo Client | SWR | urql |
|---|---|---|---|---|---|---|
| **Shared Base** | `CacheEntry` base class (~74 lines): Signal.state + RxJS share/GC. Separate machine hierarchies, no shared fetch base | `Subscribable` (~30 lines) + `Removable` (~35 lines). No shared observer/state/reducer base | `CommonEndpointDefinition` for shared fields. Single `executeEndpoint` payload creator for both thunks | Monolithic `QueryManager` handles queries + mutations + subscriptions. Single class, no separation | `_internal` core: shared `Cache`, `internalMutate`, `serialize`, `withMiddleware`. No operation-kind concept | `Operation` with `kind` tag (`query`/`mutation`/`subscription`). Single `executeRequestOperation` dispatch |
| **Machine Approach** | Resource: 4 immutable classes (Pending/Success/Error/Refreshing) with `MachineWithData` abstract base. Command: 4 standalone classes (Idle/Loading/Success/Error), no shared base | Inline reducers per entity. Query: `#dispatch()` with 8 action types + 2 status dimensions. Mutation: `#dispatch()` with 6 actions + 1 status dimension. **Not shared** | Separate Redux slices (`querySlice`, `mutationSlice`), same status enum. Shared `executeEndpoint` but separate reducer logic | Query: `ObservableQuery` (~1700 lines, rich state machine). Mutation: ~180 lines inline in `QueryManager.mutate()`. No shared machine | No state machine — flat `{ data, error, isValidating, isLoading }` objects. Imperative transitions via `setCache()` | No state machine — `OperationResult` is a flat data object. State lifecycle managed by stream completion/emission |
| **Cache Sharing** | Separate: `CacheMap<args, ResourceCacheEntry>` per Resource instance; `Map<symbol, CommandCacheEntry>` per Command. No unified cache | **Two separate caches**: `QueryCache` (Map by hash, deduplicates) + `MutationCache` (Set, no dedup). Held by `QueryClient` | **Single reducer** with separate sub-slices: `state.queries` + `state.mutations` + `state.provided`. Combined via `combineReducers` | **Single `InMemoryCache`** instance. Queries on `ROOT_QUERY`, mutations on `ROOT_MUTATION`. Same optimistic layer stack | **Single flat cache** (`Map<string, State>`). Query and mutation share key space. Mutation writes via `internalMutate` | **Per-exchange caching**. `cacheExchange` stores query results; mutations trigger invalidation by typename. No unified store |
| **Lifecycle Sharing** | Separate but parallel: both have `onCacheEntryAdded` + `onQueryStarted` hooks with `PromiseResolver`-based promises. ~78 lines duplicated across `ResourceCacheEntry` and `CommandCacheEntry` | Separate lifecycles. Query: auto-fetch, stale timers, refetch on focus/reconnect. Mutation: idle until explicit `mutate()`. No shared lifecycle hooks | **Shared `onQueryStarted`** callback for both queries and mutations. Shared `onCacheEntryAdded`. Single middleware pipeline handles both | Separate: Query has `ObservableQuery` with rich lifecycle (polling, refetch, fetchMore). Mutation is one-shot `Promise`. Shared `broadcastQueries()` post-mutation | Separate hooks: `useSWR` (auto-revalidation, focus/reconnect) vs `useSWRMutation` (imperative trigger). `internalMutate` is shared write path | Separate: `useQuery` auto-subscribes; `useMutation` is explicit trigger. Both use same `Client` dispatch but diverge on dedup + stream teardown |
| **Plugin/Extension** | `IPlugin` interface with `augmentResource` + `augmentCommand` (separate). Only `ReactHooksPlugin` exists. `Object.assign` contributions onto instances | No plugin system. Framework adapters wrap core observers. Community plugins via cache/mutation callbacks | `buildCreateApi(...modules)` — composable module system. `coreModule()` + `reactHooksModule()`. Lifecycle via middleware sub-handlers | `ApolloLink` chain (middleware pipeline). Cache policies. `typePolicies` for cache customization. No explicit plugin API | Middleware array: `useSWRConfig({ use: [...middlewares] })`. `useSWRMutation` is itself a middleware wrapping `useSWR` | **Exchange pipeline**: composable `ExchangeIO` functions. Each exchange filters by `operation.kind`. Rich ecosystem of exchange packages |
| **Subscription Mechanism** | RxJS `share({ resetOnRefCountZero })` + Signals (`Signal.state`, `Signal.compute`, `signalize`). React bridge via `useSyncExternalStore` | `Subscribable<TListener>` base class (Set-based pub/sub). `notifyManager.batch()` for coalescing. React: `useSyncExternalStore` | Redux store subscriptions. Selectors via `createSelector`. React: `useSelector` + hooks per endpoint | `ObservableQuery` uses `BehaviorSubject`. Cache uses `broadcastWatches()` iterating all watchers. No batching manager | `useSyncExternalStore` + `stateDependencies` for render tracking. `SWRGlobalState` WeakMap for side-channel state | Wonka streams (Observable-like). `share()` operator for multicast. React hooks subscribe to client streams |

## 2. Patterns Summary: Shared vs Separate

| Library | What's Shared | What's Separate |
|---|---|---|
| **rx-toolkit** | `CacheEntry` base (reactive container + GC), `CacheMap` factory, `Patcher` utility, `PromiseResolver`, `Batcher`, plugin system, signal primitives, `SKIP_TOKEN`, `stableStringify` | Machine hierarchies (4+4 classes), cache entry fetch logic (~78 dup lines), lifecycle hook types, agent classes, React hooks |
| **TanStack Query v5** | `Subscribable` (pub/sub), `Removable` (GC scheduling), `notifyManager` (batch), `QueryClient` (composition root) | Entity classes, observer classes, cache instances, state shapes, action types, result types, reducers |
| **RTK Query** | `CommonEndpointDefinition`, `executeEndpoint` (async executor), `QueryStatus` enum, `withRequestFlags`, tag system (`calculateProvidedBy`), middleware pipeline, `onQueryStarted`/`onCacheEntryAdded` callbacks | Thunks (query/mutation), reducer slices, selectors, React hooks, cache key strategies (args-hash vs requestId), TTL/cleanup |
| **Apollo Client** | `QueryManager` (everything in one class), `ApolloLink` chain, `InMemoryCache`, `QueryInfo`, `broadcastQueries()`, `DocumentTransform` | `ObservableQuery` (rich, long-lived) vs inline mutation Promise (fire-and-forget), fetch policy sets (7 vs 2), cache root IDs |
| **SWR** | `Cache` (single Map), `internalMutate` (shared write fn), `serialize` (key resolution), `withMiddleware` (hook composition), `SWRGlobalState` | Hook behavior (`useSWR` auto-revalidation vs `useSWRMutation` imperative), return shape, mutation's own `useStateWithDeps` |
| **urql** | `Operation` model (kind-tagged), `Client.executeRequestOperation`, exchange pipeline, `OperationResult` type, all exchanges see all operations | Per-kind filtering in exchanges, dedup behavior (queries dedup, mutations don't), stream teardown semantics, `_instance` uniqueness for mutations |

## 3. Key Insight: Ecosystem Consensus

**Minimal shared base is the consensus.** Every major library keeps query and mutation as fundamentally separate entities with only thin shared infrastructure:

- **TanStack Query**: 2 tiny base classes (~65 lines total), everything else independent. Most explicit about this choice.
- **RTK Query**: Deepest sharing via single `executeEndpoint` + shared middleware, but still uses separate slices, selectors, hooks.
- **Apollo Client**: Appears monolithic (`QueryManager`), but this is a liability — hard to tree-shake, mutation code is 10% of query infrastructure.
- **SWR**: Mutation wraps query hook via middleware — clever but confusing; mutation has its own internal state separate from cache.
- **urql**: Stream-based unification via exchanges, but per-kind filtering means operations diverge immediately after dispatch.

**No library shares state machines between queries and mutations.** All treat the state lifecycle as fundamentally different (auto-fetch + stale tracking vs fire-and-forget + idle state).

**Cache sharing varies**: RTK Query and Apollo unify into one store; TanStack and rx-toolkit use separate caches; SWR shares key space; urql delegates to exchanges.

## 4. Relevance to rx-toolkit

**TanStack Query v5 is the closest architectural match and most applicable reference.**

| Factor | Why TanStack |
|---|---|
| **Entity model** | Both have independent entity + observer + cache hierarchies for query/mutation |
| **Shared base size** | Both share ~60-80 lines of infrastructure (TanStack: `Subscribable` + `Removable`; rx-toolkit: `CacheEntry`) |
| **Machine approach** | Both use per-entity state machines with different state sets (TanStack: inline reducers; rx-toolkit: immutable classes) |
| **Framework-agnostic core** | Both separate core from React bindings |
| **No shared observer base** | Both have independent agent/observer classes despite structural similarity |
| **GC via ref-counting** | Both use subscriber-count-driven GC (TanStack: `Removable.scheduleGc`; rx-toolkit: RxJS `resetOnRefCountZero`) |

**RTK Query's `executeEndpoint` pattern** is relevant for the "shared fetch engine" option — a single executor that branches on entity type. But RTK's Redux dependency makes the pattern less directly portable.

**What rx-toolkit already does better than most**: explicit plugin system with typed augmentation (only RTK Query has comparable modularity via `buildCreateApi`). Signal-based reactivity (unique in the ecosystem — all others use pub/sub or Redux or streams).

**Recommendation for extraction**: Follow TanStack's philosophy — keep shared base minimal (enhance `CacheEntry` with the ~78 lines of duplicated abort/lifecycle/resolver logic), keep machine hierarchies and fetch logic separate. Do not attempt Apollo-style monolithic unification or SWR-style mutation-wraps-query. The duplication is small enough that over-abstraction is a bigger risk than the DRY violation.
