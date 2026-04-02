---
title: "External Research: OSS Comparison"
date: 2026-04-02
stage: 01-research
role: rdpi-external-researcher
---

## Comparison Matrix

| Dimension | TanStack Query v5 | RTK Query | Apollo Client | SWR v2 | urql | rx-toolkit |
|---|---|---|---|---|---|---|
| **Shared base** | `Subscribable` + `Removable` (~65 LOC) | `CommonEndpointDefinition` + single `executeEndpoint` (~90% shared runtime) | Monolithic `QueryManager` (~1850 LOC, no separation) | `_internal` core: `Cache`, `internalMutate`, `serialize` | `Operation` with `kind` tag, single `executeRequestOperation` | `CacheEntry` base (~76 LOC), separate hierarchies |
| **Machines** | Inline reducers per entity, **not shared** | Separate Redux slices, shared `QueryStatus` enum | `ObservableQuery` (~1700 LOC) vs inline Promise (~180 LOC) | No machine — flat `{ data, error }` objects | No machine — `OperationResult` is flat data | Immutable class hierarchies (4+4), **not shared** |
| **Cache** | Two separate: `QueryCache` (Map) + `MutationCache` (Set) | Single reducer, separate sub-slices (`queries` + `mutations` + `provided`) | Single `InMemoryCache`, shared optimistic layers | Single flat `Map<string, State>`, shared key space | Per-exchange; `cacheExchange` stores queries, invalidates on mutation | Separate `CacheMap` per Resource; `Map` per Command |
| **Lifecycle sharing** | Separate: auto-fetch + stale timers vs idle-until-mutate | **Shared**: `onQueryStarted` + `onCacheEntryAdded` for both, single middleware pipeline | Separate: `ObservableQuery` vs one-shot Promise; shared `broadcastQueries()` | Separate hooks; `internalMutate` is shared write path | Same `Client` dispatch, divergent dedup + teardown | Separate but parallel: both have `onQueryStarted` + `onCacheEntryAdded` (~35-45 LOC dup) |
| **Plugin / extension** | No plugin system; framework adapters wrap observers | `buildCreateApi(...modules)` — composable module system | `ApolloLink` chain + `typePolicies` | `use: [...middlewares]` array | Exchange pipeline (`ExchangeIO` functions) | `IPlugin` with `augmentResource` + `augmentCommand` |
| **React binding** | `useSyncExternalStore` wrapping core observers | `useSelector` + generated per-endpoint hooks | `ObservableQuery` → `useQuery` wrapper | `useSyncExternalStore` + dependency tracking | Wonka streams → hooks | Signals + `useSyncExternalStore` |

## Per-Library Profiles

**TanStack Query v5.** Two tiny base classes (`Subscribable` for pub/sub, `Removable` for GC) — everything else is independent: entity classes, observers, caches, reducers, result types. Closest to rx-toolkit's current structure where query and mutation share only a minimal reactive container. Key insight: *deliberate duplication* between `QueryObserver` (745 LOC) and `MutationObserver` (227 LOC) — no shared observer base despite structural similarity. **Confidence: High.**

**RTK Query.** Deepest sharing in the ecosystem: single `executeEndpoint` payload creator handles both query and mutation thunks (~90% shared code); `onQueryStarted` and `onCacheEntryAdded` lifecycle callbacks run through a single middleware handler that matches both thunk types via `isPending(queryThunk, mutationThunk)`. Separation happens at the slice level (separate reducers, selectors, hooks) and in cache key strategy (args-hash vs requestId). rx-toolkit's lifecycle API was modeled on RTK Query's, making it the most architecturally relevant reference. **Confidence: High.**

**Apollo Client.** No query/mutation separation at the core — monolithic `QueryManager` (~1850 LOC) handles everything. The real asymmetry is at the result level: `ObservableQuery` (rich, long-lived, ~1700 LOC) vs inline mutation Promise (fire-and-forget, ~180 LOC). Single `InMemoryCache` with shared optimistic layers. Key insight: monolithic approach works but makes tree-shaking impossible and mutation code is ~10% of query infrastructure weight. **Confidence: High.**

**SWR v2.** Mutation is literally a middleware wrapping the query hook (`useSWRMutation = withMiddleware(useSWR, mutation)`). Shared: flat key-value `Cache`, `internalMutate` for writes, `serialize` for keys. But mutation maintains its own state via `useStateWithDeps`, separate from the query cache subscription. Key insight: shared write path, separate read behavior. **Confidence: High.**

**urql.** Stream-based unification via exchanges: every request becomes an `Operation` with explicit `kind` tag (`query`/`mutation`/`subscription`), dispatched through `executeRequestOperation`. Exchanges filter by `operation.kind` — so operations share the pipeline but diverge immediately. Key insight: kind-tagged dispatch is clean, but per-exchange filtering recreates the separation. **Confidence: High.**

## Two Reference Models

### 1. TanStack Query — Minimal Shared Base

Shares only ~65 lines of infrastructure. Entity hierarchies, observers, caches, and state machines are fully independent. This validates rx-toolkit's current `CacheEntry` approach (~76 LOC shared) — the scale of sharing is comparable. TanStack proves that keeping query/mutation separate works at scale (20k+ GitHub stars, adopted across 4 framework adapters). The cost is structural duplication (~50% of observer logic is parallel), accepted as a tradeoff for simplicity.

### 2. RTK Query — Deep Lifecycle Sharing

Shares ~90% of the execution runtime via `executeEndpoint`, plus unified lifecycle middleware for `onQueryStarted`/`onCacheEntryAdded`. This is directly relevant because rx-toolkit copied RTK Query's lifecycle API design. RTK Query proves that deeper sharing of lifecycle plumbing is viable and well-tested in production. The separation boundary is at reducers, selectors, and hooks — not at the execution or lifecycle layer.

## Ecosystem Consensus (Corrected)

The ecosystem does NOT converge on a single answer. Two viable patterns coexist:

1. **Minimal base** (TanStack, urql, SWR): share only the thinnest infrastructure (pub/sub, GC, cache primitives). Keep machines, fetch logic, and lifecycle separate. Optimizes for simplicity and independence.

2. **Shared execution + lifecycle** (RTK Query): share the fetch executor and lifecycle hook machinery; separate at the state/selector/hook layer. Optimizes for consistency and reduces lifecycle duplication.

**Universal agreement**: no library shares state machines between queries and mutations. Status enums may overlap, but reducer logic always diverges (auto-fetch + stale tracking vs fire-and-forget + idle state).

## Lessons for rx-toolkit

| Source | Lesson | Applicability |
|---|---|---|
| TanStack | ~65 LOC shared base is sufficient; don't over-abstract observers/machines | Validates current `CacheEntry` size; confirms machines should stay separate |
| RTK Query | Lifecycle middleware can be unified for both entity types without merging state logic | Directly applicable — rx-toolkit already has parallel `onQueryStarted`/`onCacheEntryAdded`; shared lifecycle helpers are proven viable |
| RTK Query | `executeEndpoint` branches on entity type at runtime — works for ~90% shared code | Consider for shared fetch orchestration if duplication grows beyond current ~35-45 lines |
| Apollo | Monolithic approach creates tree-shaking and maintainability debt | Confirms: avoid merging Resource + Command into a single class |
| SWR | Pure utility functions (`internalMutate`, `serialize`) are the lightest sharing mechanism | Supports utility-function approach for lifecycle cleanup (~15 LOC, zero structural change) |
| urql | Kind-tagged `Operation` model is clean but exchanges immediately filter — separation is still real | Don't expect a unified "operation" abstraction to eliminate per-type logic |

## Sources

- [TanStack/query — subscribable.ts, removable.ts, query.ts, mutation.ts](https://github.com/TanStack/query/tree/main/packages/query-core/src) — core architecture
- [RTK Query — buildThunks.ts, queryLifecycle.ts, cacheLifecycle.ts](https://github.com/reduxjs/redux-toolkit/tree/master/packages/toolkit/src/query/core) — shared execution + lifecycle
- [Apollo Client — QueryManager.ts, ObservableQuery.ts](https://github.com/apollographql/apollo-client/tree/main/src/core) — monolithic approach
- [SWR — _internal/, mutation/](https://github.com/vercel/swr/tree/main/src) — middleware-based sharing
- [urql — core/client.ts, exchanges/](https://github.com/urql-graphql/urql/tree/main/packages/core/src) — exchange pipeline
