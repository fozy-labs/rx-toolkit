---
title: "External Research: Apollo Client Query/Mutation Core Separation"
date: 2026-04-02
stage: 01-research
role: rdpi-external-researcher
---

## Architecture Overview

- **No separate MutationManager** — Apollo has a single `QueryManager` class (~1850 lines) that handles queries, mutations, AND subscriptions
- `ApolloClient` delegates everything to one `QueryManager` instance
- `QueryManager` holds shared refs: `cache`, `link`, `localState`, `documentTransform`

Source: `src/core/QueryManager.ts`, `src/core/ApolloClient.ts` — **Confidence: High**

## Query vs Mutation Execution

### Shared Link Chain
- Both queries and mutations use the same `ApolloLink` chain
- `QueryManager.getObservableFromLink()` is the single gateway to the network for all operation types
- Operation type (`OperationTypeNode.QUERY | MUTATION | SUBSCRIPTION`) is detected via `getDocumentInfo()` and passed through the link chain
- Deduplication is applied per-query but mutations always pass `deduplication: false`

### Execution Differences
- **Query**: `fetchQuery()` → `fetchObservableWithInfo()` → `fetchQueryByPolicy()` → complex fetchPolicy logic (cache-first, network-only, etc.)
- **Mutation**: `mutate()` → creates `QueryInfo`, calls `getObservableFromLink()` directly, skips fetchPolicy routing
- Mutations only support `network-only` or `no-cache` fetch policies (enforced in `ApolloClient.mutate()`)
- Queries have ~7 fetch policy strategies; mutations have 2

Source: `QueryManager.mutate()` L267-450, `QueryManager.fetchQueryByPolicy()` L1547-1765 — **Confidence: High**

## Shared Core Infrastructure

| Component | Shared? | Notes |
|-----------|---------|-------|
| `ApolloLink` chain | Yes | Single `this.link` getter on QueryManager |
| `ApolloCache` (InMemoryCache) | Yes | Single `this.cache` getter on QueryManager |
| `DocumentTransform` | Yes | Single transform pipeline for all documents |
| `LocalState` (@client) | Yes | Shared resolver execution |
| `QueryInfo` | Yes | Same class used for query and mutation network requests |
| `broadcastQueries()` | Yes | Mutation completion triggers same broadcast mechanism |
| `getDocumentInfo()` | Yes | Transform cache shared, converts mutations to query AST for cache reads |

Source: `QueryManager` constructor L209-240, `QueryInfo` class — **Confidence: High**

## InMemoryCache Sharing

- Single cache instance, same `data` (EntityStore) and `optimisticData` layers
- Queries read from `ROOT_QUERY`; mutations write/read from `ROOT_MUTATION`
- Mutations create **optimistic layers** on the same `optimisticData` stack
- After mutation completes:
  1. Results written to `ROOT_MUTATION`
  2. `ROOT_MUTATION` fields cleaned up (all non-`__typename` fields deleted via `cache.modify`)
  3. Optimistic layer removed via `removeOptimistic`
  4. `refetchQueries` triggered
  5. `broadcastWatches()` notifies all query watchers
- `asQuery` transform: mutations are converted to query operations for cache reads (`def.operation = "query"`)
- `broadcastWatches()` iterates ALL watchers — no per-operation-type filtering

Source: `QueryInfo.markMutationResult()` L340-543, `InMemoryCache.broadcastWatches()` L539-556 — **Confidence: High**

## State Management Per Operation Type

### Query State
- `ObservableQuery` — long-lived observable per `watchQuery()` call
- Tracked in `QueryManager.obsQueries` (a `Set<ObservableQuery>`)
- Has: polling, refetch, fetchMore, subscribeToMore, reobserve
- Manages `BehaviorSubject` for reactive emission
- Supports `nextFetchPolicy` transitions
- `QueryInfo` per network fetch (may be reused across reobserves)

### Mutation State
- `mutationStore` — simple `{ [mutationId]: MutationStoreValue }` dictionary on QueryManager
- `MutationStoreValue` = `{ mutation, variables, loading, error }` — flat, minimal
- No long-lived observable; returns a one-shot `Promise`
- `QueryInfo` created fresh per mutation, not reused
- Only exists if `onBroadcast` is set (devtools enabled)
- No polling, no refetch, no variable tracking

### Key Asymmetry
- Queries: rich lifecycle (`ObservableQuery` ~1700 lines), persistent subscription, cache-first patterns
- Mutations: fire-and-forget via `Promise`, temporary `QueryInfo`, cleanup after completion
- `obsQueries` set only tracks queries — mutations have no equivalent tracking

Source: `ObservableQuery.ts`, `QueryManager.mutationStore`, `MutationStoreValue` interface — **Confidence: High**

## ObservableQuery vs "MutationManager"

- **There is no MutationManager** — mutations are inline methods on `QueryManager`
- `ObservableQuery`:
  - ~1700 lines, full class with complex state machine
  - `BehaviorSubject` for reactive results
  - `reobserve()`, `refetch()`, `fetchMore()`, `setVariables()`, `subscribeToMore()`
  - Polling support with `startPolling()`/`stopPolling()`
  - `nextFetchPolicy` transitions
  - Registered in `QueryManager.obsQueries` for broadcast notifications
  - Disposable observables for refetch/poll (don't mutate original options)

- Mutation execution (inside `QueryManager.mutate()`):
  - ~180 lines of inline code, no separate class
  - Creates temporary `QueryInfo` (same class as queries)
  - One-shot `Promise` resolution
  - Optimistic response handling via `queryInfo.markMutationOptimistic()`
  - Result processing via `queryInfo.markMutationResult()`
  - After-mutation: refetchQueries, broadcastQueries, cleanup ROOT_MUTATION

Source: `ObservableQuery.ts` L88-1702, `QueryManager.mutate()` L267-450 — **Confidence: High**

## Pitfalls

- Monolithic `QueryManager` makes it hard to tree-shake mutation code from query-only apps
- `broadcastWatches()` iterates all watchers even if only a mutation finished — O(n) with all active queries
- `mutationStore` is conditionally created (only with devtools) — inconsistent state tracking
- `asQuery` document transform hack for reading mutation results from cache is fragile

## Key Takeaway for rx-toolkit

Apollo does NOT separate queries from mutations at the core level. They share:
- Same manager class
- Same link chain
- Same cache
- Same QueryInfo for network requests
- Same broadcast mechanism

The only true separation is:
- `ObservableQuery` (rich, long-lived) vs inline Promise (fire-and-forget) for result delivery
- Different cache root IDs (`ROOT_QUERY` vs `ROOT_MUTATION`)
- Different fetchPolicy sets (7 vs 2)

## Sources
- [QueryManager.ts](https://github.com/apollographql/apollo-client/blob/main/src/core/QueryManager.ts) — core orchestration, ~1850 lines
- [ApolloClient.ts](https://github.com/apollographql/apollo-client/blob/main/src/core/ApolloClient.ts) — public API facade
- [ObservableQuery.ts](https://github.com/apollographql/apollo-client/blob/main/src/core/ObservableQuery.ts) — query lifecycle, ~1700 lines
- [QueryInfo.ts](https://github.com/apollographql/apollo-client/blob/main/src/core/QueryInfo.ts) — per-request state, shared by queries and mutations
- [InMemoryCache.ts](https://github.com/apollographql/apollo-client/blob/main/src/cache/inmemory/inMemoryCache.ts) — cache layer with optimistic support
- [CLAUDE.md](https://github.com/apollographql/apollo-client/blob/main/CLAUDE.md) — architecture overview
