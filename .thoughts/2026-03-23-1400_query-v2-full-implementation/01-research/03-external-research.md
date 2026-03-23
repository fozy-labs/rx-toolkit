---
title: "External Research: Query/Cache Management Best Practices"
date: 2026-03-23
stage: 01-research
role: rdpi-external-researcher
---

# External Research: Query/Cache Management Best Practices

Research across 5 major query/cache management libraries in the frontend/reactive ecosystem, supporting the full implementation of query-v2 in rx-toolkit.

---

## 1. Comparative Analysis

### 1.1 Cache Architecture Overview

| Library | Cache Type | Cache Key | Normalization | Default TTL | Confidence |
|---------|-----------|-----------|---------------|-------------|------------|
| TanStack Query v5 | Document cache | Serialized query key (array) | No ("deliberately not a normalized cache") | gcTime=5min, staleTime=0 | **High** |
| RTK Query | Document cache | Endpoint name + serialized params | No (deliberately, per docs: "intentionally does NOT implement a normalized cache") | keepUnusedDataFor=60s | **High** |
| SWR v2 | Document cache | String key (or stable-serialized object key) | No | No built-in TTL; stale-while-revalidate pattern | **High** |
| Apollo Client v3/v4 | Normalized cache | `__typename:id` (configurable via `keyFields`) | Yes — flat lookup table with `__ref` pointers | No time-based expiry; manual gc() or evict() | **High** |
| Relay v20 | Normalized store | Compiler-generated IDs; fragment-level access | Yes — graph-based, compiler-driven | No time-based expiry by default; explicit invalidation only | **High** |

### 1.2 Subscription & Reference Counting

| Library | Mechanism | Cleanup Strategy | Confidence |
|---------|-----------|-----------------|------------|
| TanStack Query | Observer pattern: multiple observers per query key; shared cache entry | gcTime timer starts when all observers unsubscribe; data deleted after timer expires | **High** |
| RTK Query | Subscription reference counting per endpoint+params | Data kept while refCount > 0; `keepUnusedDataFor` timer after last unsubscribe (default 60s) | **High** |
| SWR | Hook-level; same key across components = single request via deduplication | No explicit GC; relies on JavaScript's native garbage collection when cache entries removed or provider cleared | **High** |
| Apollo Client | `ObservableQuery` watchers; `cache.retain(id)` / `cache.release(id)` for manual control | `cache.gc()` — tracing from root objects (Query/Mutation), removing unreachable objects; `cache.evict({id})` for targeted removal | **High** |
| Relay | `environment.retain(query)` returns `Disposable`; fragment subscriptions per component | GC removes unreferenced data; `gcReleaseBufferSize` (default=10) keeps N recently-released queries as a back-navigation buffer; `gcScheduler` controls GC timing | **High** |

### 1.3 Invalidation Patterns

| Library | Invalidation Approach | Granularity | Confidence |
|---------|----------------------|-------------|------------|
| TanStack Query | `queryClient.invalidateQueries()` — marks stale + triggers refetch for active queries | Filter by prefix matching, exact matching, or predicate function on query keys | **High** |
| RTK Query | Tag-based: queries `providesTags`, mutations `invalidatesTags`; tag = `{type, id?}` | By tag type/id; `'LIST'` abstract ID pattern for collection-level invalidation | **High** |
| SWR | `mutate(key)` (global) or bound `mutate()` (per-hook); `mutate(filterFn)` for multi-key | Per-key or filter function across all keys | **High** |
| Apollo Client | `cache.evict({id, fieldName?})` + `cache.gc()`; or `refetchQueries` option on mutations | Per-object, per-field, or per-query; TypePolicy `merge`/`read` functions for field-level control | **High** |
| Relay | `environment.getStore().invalidateStore()` (global) or `commitLocalUpdate` → `invalidateRecord(id)` (per-record); `queryCacheExpirationTime` for time-based | Per-store, per-record, or time-based via store configuration | **High** |

### 1.4 Optimistic Updates

| Library | Approach | Rollback Mechanism | Confidence |
|---------|----------|-------------------|------------|
| TanStack Query | Two patterns: (1) UI-only via mutation `variables` (no cache touch); (2) Cache-based via `onMutate` (snapshot + update), `onError` (rollback from snapshot), `onSettled` (invalidate) | Manual snapshot/restore in `onMutate`/`onError` callbacks; must cancel outgoing refetches before optimistic update | **High** |
| RTK Query | `updateQueryData` in `onQueryStarted` lifecycle hook; returns `patches` and `undo()` | `undo()` reverts patches; can also `dispatch(api.util.patchQueryData(...))` for manual patching | **High** |
| SWR | `optimisticData` option on `mutate()`; `rollbackOnError: true` (default) | Automatic rollback: SWR snapshots previous data and restores on error; `populateCache` + `revalidate` options for fine control | **High** |
| Apollo Client | `optimisticResponse` option on mutations; stored as separate optimistic layer (doesn't overwrite canonical data) | Automatic rollback when server response arrives (success = replace optimistic with real; error = remove optimistic layer); `IGNORE` sentinel for conditional bail-out | **High** |
| Relay | `optimisticResponse` on mutations (static data) + `optimisticUpdater` (imperative store modifications); `@raw_response_type` directive for typed optimistic responses | Automatic rollback: on success, optimistic update is rolled back and replaced with server response; on error, optimistic update is rolled back entirely; execution order: optimisticResponse → optimisticUpdater → declarative directives | **High** |

---

## 2. Established Practices

### 2.1 State Machine Patterns for Async Operations

All five libraries converge on a similar conceptual state model for query lifecycle, though they differ in API exposure:

**Common States Across Libraries** (Confidence: **High** — universal pattern)

- **Idle/Uninitialized**: No fetch has been triggered. In TanStack Query: `status: 'pending'` with `fetchStatus: 'idle'`. In SWR: all of `data`, `error`, `isLoading` are falsy before first mount.
- **Loading/Fetching**: Initial fetch in progress. All libraries distinguish "first load" from "background refetch." TanStack Query uses `fetchStatus: 'fetching'` + `status: 'pending'` for hard loading. SWR exposes `isLoading: true` (first load) vs `isValidating: true` (any revalidation).
- **Success**: Data available. May be fresh or stale depending on policy. TanStack Query: `status: 'success'`, `isStale` flag separate. Apollo: data available from cache, freshness determined by fetch policy.
- **Error**: Fetch failed. In SWR and TanStack Query, `data` and `error` can coexist (stale data from previous success + new error). Apollo Client returns both cached data and error information.
- **Stale**: Data is available but marked for revalidation. TanStack Query: `staleTime` determines when data becomes stale (default 0 = immediately stale). SWR: all data is conceptually "stale" (stale-while-revalidate). RTK Query: data becomes stale on tag invalidation.
- **Refreshing/Revalidating**: Background refetch with existing data visible. TanStack Query: `status: 'success'` + `fetchStatus: 'fetching'`. SWR: `isValidating: true` + `data` available.

**Sources:**
- [TanStack Query — Query Status](https://tanstack.com/query/latest/docs/framework/react/guides/queries) — two-axis model (status + fetchStatus)
- [SWR — Getting Started](https://swr.vercel.app/docs/getting-started) — isLoading/isValidating/data/error
- [RTK Query — Cache Behavior](https://redux-toolkit.js.org/rtk-query/usage/cache-behavior) — subscription lifecycle
- [Apollo Client — Queries](https://www.apollographql.com/docs/react/data/queries) — loading/error/data
- [Relay — Fetch Policies](https://relay.dev/docs/guided-tour/reusing-cached-data/fetch-policies/) — store-or-network / store-and-network / network-only / store-only

### 2.2 Stale-While-Revalidate Pattern

This pattern is central to SWR (named after it) and TanStack Query, and partially adopted by others. (Confidence: **High**)

**Core Flow:**
1. Return cached (possibly stale) data immediately
2. Send fetch request in background
3. Update cache with fresh response
4. Notify subscribers of new data

**Library-Specific Implementations:**
- **TanStack Query**: `staleTime=0` by default (data immediately stale). On mount: if cached data exists → return it + refetch. `gcTime=5min` controls when unused data is garbage collected.
- **SWR**: Built-in stale-while-revalidate. Auto-revalidation triggers: focus event (default on), reconnect (default on), interval (`refreshInterval`), mount (configurable). `useSWRImmutable` disables all auto-revalidation.
- **RTK Query**: `refetchOnMountOrArgChange` (default false), `refetchOnFocus` (default false), `refetchOnReconnect` (default false) — all opt-in, opposite of SWR/TanStack defaults.
- **Apollo Client**: Fetch policies control behavior: `cache-first` (return cache, no refetch), `cache-and-network` (return cache + refetch), `network-only` (skip cache), `no-cache` (skip cache storage).
- **Relay**: `store-or-network` (default — use cache if complete, else fetch), `store-and-network` (use cache + always fetch).

**Sources:**
- [SWR Revalidation](https://swr.vercel.app/docs/revalidation) — focus/interval/reconnect/mount triggers
- [TanStack Query Caching](https://tanstack.com/query/latest/docs/framework/react/guides/caching) — staleTime/gcTime lifecycle
- [RTK Query Automated Refetching](https://redux-toolkit.js.org/rtk-query/usage/automated-refetching) — tag-based + conditional refetch

### 2.3 Retry and Backoff Strategies

- **SWR**: Exponential backoff by default on error. `onErrorRetry(err, key, config, revalidate, {retryCount})` is fully customizable. `shouldRetryOnError` toggle (default true). (Confidence: **High**)
- **TanStack Query**: `retry: 3` by default for failed queries (not mutations). `retryDelay` supports exponential backoff. Configurable per-query. (Confidence: **High**)
- **Apollo Client**: `RetryLink` provides configurable retry with backoff for network errors. Not built into base client — requires explicit link chain setup. (Confidence: **High**)
- **RTK Query**: No built-in retry. Can be implemented via `baseQueryFn` wrapper or middleware. (Confidence: **High**)
- **Relay**: No built-in retry mechanism in the core library. Application-level responsibility. (Confidence: **High**)

**Sources:**
- [SWR Error Handling](https://swr.vercel.app/docs/error-handling) — exponential backoff, onErrorRetry
- [TanStack Query — Queries](https://tanstack.com/query/latest/docs/framework/react/guides/queries) — retry/retryDelay options
- [Apollo RetryLink](https://www.apollographql.com/docs/react/api/link/apollo-link-retry) — configurable retry link

### 2.4 Request Deduplication

Universal pattern across all document-cache libraries. (Confidence: **High**)

- **TanStack Query**: Same query key across components → single request. Automatic.
- **SWR**: Same key across components → single request, shared automatically. Built into core.
- **RTK Query**: Same endpoint + same serialized params → shared subscription, single request.
- **Apollo Client**: Deduplication at the link level (default in HttpLink). Fragment-level dedup via normalized cache.
- **Relay**: Compiler-driven deduplication; identical queries consolidated at build time.

### 2.5 Cache Garbage Collection Approaches

Three primary approaches observed across libraries. (Confidence: **High**)

| Approach | Libraries | How It Works |
|----------|-----------|-------------|
| **Timer-based** | TanStack Query, RTK Query | After all subscribers unsubscribe, a timer starts. Data deleted after timer expires (TanStack: gcTime=5min; RTK: keepUnusedDataFor=60s) |
| **Reachability tracing** | Apollo Client | `cache.gc()` traces from root objects (Query/Mutation), removing unreachable normalized objects. Manual or scheduled call. `cache.retain(id)` prevents GC of specific objects. |
| **Reference counting + release buffer** | Relay | `environment.retain(query)` → Disposable. Unreferenced data deleted by GC. `gcReleaseBufferSize=10` keeps recently-released queries buffered. `gcScheduler` controls when GC runs (default: `resolveImmediate`). |

**Sources:**
- [TanStack Query Caching](https://tanstack.com/query/latest/docs/framework/react/guides/caching) — gcTime lifecycle
- [RTK Query Cache Behavior](https://redux-toolkit.js.org/rtk-query/usage/cache-behavior) — keepUnusedDataFor, refCount
- [Apollo Client GC & Eviction](https://www.apollographql.com/docs/react/caching/garbage-collection) — gc(), evict(), retain(), release()
- [Relay Presence of Data](https://relay.dev/docs/guided-tour/reusing-cached-data/presence-of-data/) — GC, retain, gcReleaseBufferSize, gcScheduler

---

## 3. Snapshot / Immutable State Patterns

### 3.1 Apollo Client — Optimistic Layers

Apollo's InMemoryCache uses a layered approach for optimistic updates. (Confidence: **High**)

- Optimistic data is stored in a **separate layer** on top of canonical data, not merged into it.
- When a mutation provides `optimisticResponse`, Apollo writes it to an optimistic layer identified by a mutation ID.
- Reads merge canonical and optimistic layers transparently.
- On mutation success: optimistic layer is removed, canonical data is updated with server response.
- On mutation error: optimistic layer is simply removed, reverting to canonical state.
- `cache.batch({optimistic: "layerId"})` allows named optimistic layers with `removeOptimistic("layerId")` for manual control.
- Multiple concurrent optimistic updates each get their own layer — layers are composable.

**Source:** [Apollo Client Optimistic UI](https://www.apollographql.com/docs/react/performance/optimistic-ui) — optimisticResponse, layered architecture

### 3.2 TanStack Query — Structural Sharing

TanStack Query preserves referential identity for unchanged parts of data across refetches. (Confidence: **High**)

- When a background refetch returns new data, TanStack Query performs structural sharing: it deep-compares old and new data, reusing references for unchanged subtrees.
- This minimizes unnecessary re-renders in React (since unchanged references pass `Object.is()` checks).
- Configurable via `structuralSharing` option (can be disabled or customized).

**Source:** [TanStack Query — Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults) — structural sharing behavior

### 3.3 SWR — Data and Error Coexistence

SWR allows `data` and `error` to coexist, showing stale data alongside an error. (Confidence: **High**)

- When a revalidation fails, the previous successfully fetched `data` is retained.
- `error` is set to the new error.
- This means `data` and `error` can both be truthy simultaneously — an important UX pattern.
- `keepPreviousData` option (via middleware) preserves data across key changes.

**Source:** [SWR Error Handling](https://swr.vercel.app/docs/error-handling) — data/error coexistence
**Source:** [SWR Middleware](https://swr.vercel.app/docs/middleware) — laggy data (keepPreviousData) pattern

### 3.4 Relay — Fragment-Level Reads and Compiler-Driven Optimization

Relay takes a fundamentally different approach via its compiler. (Confidence: **High**)

- Components declare data needs via fragments; reads are at the fragment level, not the query level.
- The Relay compiler statically analyzes all fragments at build time, generating optimized read selectors.
- Data is read from the normalized store using fragment references — components see only their own slice.
- `useFragment` returns data that re-renders only when the specific fragment's fields change.
- No runtime structural sharing needed — the compiler guarantees minimal reads.

**Source:** [Relay — Reusing Cached Data](https://relay.dev/docs/guided-tour/reusing-cached-data/) — fragment-level data access

### 3.5 Apollo Client — Memory Management

Apollo Client v3.9+ includes configurable LRU memoization caches for internal computations. (Confidence: **High**)

- Internal caches use weak references + LRU eviction.
- Cache sizes configurable via `cacheSizes` global or per-cache.
- Default base: 1000 entries for user-provided DocumentNodes, scaled upward for transformed docs.
- `cache.gc({resetResultCache: true})` releases memory used for result memoization.
- `client.getMemoryInternals()` API for development-only cache usage measurement.

**Source:** [Apollo Client Memory Management](https://www.apollographql.com/docs/react/caching/memory-management) — cache sizes, LRU, weak caches

---

## 4. Plugin / Middleware Architectures

### 4.1 SWR — Hook Wrapping Middleware

SWR's middleware system wraps the `useSWR` hook itself. (Confidence: **High**)

**Pattern:**
```ts
function myMiddleware(useSWRNext) {
  return (key, fetcher, config) => {
    // before hook logic
    const swr = useSWRNext(key, fetcher, config)
    // after hook logic
    return swr
  }
}
```

**Composition:** `use: [a, b, c]` in SWRConfig. Execution order: `a → b → c → useSWR → c → b → a` (onion model).

**Examples from docs:**
- Request logger (wrap fetcher)
- Keep previous result across key changes ("laggy data")
- Serialize object keys to stable strings

**Pros:** Very composable; each middleware can modify key, fetcher, config, or result. React hooks rules preserved since middleware IS a hook wrapper.

**Cons:** Middleware must follow React hooks rules; can't be async; ordering matters.

**Source:** [SWR Middleware](https://swr.vercel.app/docs/middleware) — wrapping pattern, composition, examples

### 4.2 SWR — Cache Provider System

SWR allows replacing the cache implementation entirely. (Confidence: **High**)

**Interface:** Map-like with `get`, `set`, `delete`, `keys` methods.

**Configuration:** `<SWRConfig value={{ provider: () => new Map() }}>` — wraps in React context.

**Capabilities:**
- Nestable: inner SWRConfig can override outer provider.
- localStorage persistence: wrap default cache, sync to localStorage.
- Test isolation: `new Map()` per test.
- Experimental `extend` for cache provider composition.

**Source:** [SWR Advanced — Cache](https://swr.vercel.app/docs/advanced/cache) — provider option, Map interface, nesting, persistence example

### 4.3 Apollo Client — Link Chain (Request Pipeline)

Apollo Client uses a chainable middleware pattern for the network layer. (Confidence: **High**)

**Pattern:** `ApolloLink` — each link receives an operation and a `forward` function to pass to the next link.

**Built-in Links:**
- `HttpLink` — sends operations via HTTP (terminal link)
- `ErrorLink` — catches and handles GraphQL + network errors
- `RetryLink` — retries failed operations with configurable backoff
- `BatchLink` / `BatchHttpLink` — batches multiple operations into a single HTTP request
- `SetContextLink` — adds headers/auth tokens to operation context
- `PersistedQueryLink` — automatic persisted queries (APQ)
- `RemoveTypenameFromVariablesLink` — strips `__typename` from variables

**Composition:** `ApolloLink.from([link1, link2, ..., terminalLink])` or `link1.concat(link2)`.

**Pros:** Powerful separation of concerns; each link handles one aspect (auth, logging, retry, batching). Community links ecosystem.

**Cons:** Links operate at network/operation level, not at cache level. Not a general plugin system for cache behavior.

**Source:** [Apollo Client — Link Overview](https://www.apollographql.com/docs/react/api/link/introduction) — link chain architecture

### 4.4 Apollo Client — TypePolicy System (Cache-Level Extensibility)

Apollo's `InMemoryCache` supports per-type and per-field customization via TypePolicies. (Confidence: **High**)

**Capabilities:**
- `keyFields`: customize cache ID generation per type (array of field names, function, or `false` to disable normalization)
- `fields`: per-field `read` and `merge` functions
  - `read(existing, {args, toReference, canRead})` — transform data on read (virtual fields, computed fields, pagination)
  - `merge(existing, incoming, {args, mergeObjects})` — custom merge logic (pagination, dedup, deep merge)
- `possibleTypes`: interface/union type mapping
- `resultCaching` (default true): memoize query results

**Source:** [Apollo Client — Cache Configuration](https://www.apollographql.com/docs/react/caching/cache-configuration) — typePolicies, keyFields, read/merge

### 4.5 RTK Query — Tag-Based Declarative Invalidation

RTK Query uses a declarative tag system rather than imperative middleware. (Confidence: **High**)

**Pattern:**
- Queries declare what tags they provide: `providesTags: ['Post', {type: 'Post', id: 'LIST'}]`
- Mutations declare what tags they invalidate: `invalidatesTags: ['Post']`
- Runtime automatically matches invalidated tags to provided tags and refetches affected queries.

**`'LIST'` Pattern:** Abstract tag ID for collection endpoints. Mutation invalidating `{type: 'Post', id: 'LIST'}` triggers refetch of the list query without affecting individual item queries.

**Lifecycle Hooks:**
- `onQueryStarted(arg, {dispatch, queryFulfilled, getCacheEntry, updateCachedData})` — lifecycle for side effects
- `onCacheEntryAdded(arg, {dispatch, cacheDataLoaded, cacheEntryRemoved, updateCachedData})` — streaming updates (WebSocket)

**Source:** [RTK Query — Automated Refetching](https://redux-toolkit.js.org/rtk-query/usage/automated-refetching) — providesTags/invalidatesTags, LIST pattern

### 4.6 Relay — Compiler-Driven Architecture (No Runtime Plugins)

Relay does not have a runtime plugin/middleware system. Its extensibility is at the compiler level. (Confidence: **High**)

**Extensibility Points:**
- Relay Compiler transforms at build time (custom directives, generated artifacts)
- `Environment` configuration: network layer (custom `fetchFunction`), store configuration
- Declarative mutation directives: `@deleteRecord`, `@appendEdge`, `@prependEdge`, `@appendNode`, `@prependNode`
- Imperative `updater` / `optimisticUpdater` functions for store modifications during mutations

**Notable Design Choices:**
- Fragment-based colocation: each component declares exactly what data it needs
- No runtime query composition — all resolved at compile time
- `useSubscribeToInvalidationState(dataIDs, callback)` — reactive hook for responding to store invalidation

**Source:** [Relay — GraphQL Mutations](https://relay.dev/docs/guided-tour/updating-data/graphql-mutations/) — updater functions, declarative directives, optimistic updates order of execution

---

## 5. Opinions and Speculation

### 5.1 Normalized vs Document Cache

There is ongoing debate in the community about whether normalized caching is worth the complexity. (Confidence: **Low** — community opinions, not consensus)

- TanStack Query author (Tanner Linsley) has publicly stated that normalized caching adds significant complexity with diminishing returns for most applications. Document caching + smart invalidation is simpler and sufficient.
- Apollo and Relay teams argue normalization is essential for consistency in graph-heavy applications.
- RTK Query documentation explicitly says "RTK Query intentionally does NOT implement a normalized cache" and suggests `createEntityAdapter` for normalized state alongside it.

### 5.2 Compiler-Driven vs Runtime Approaches

Relay's compiler-driven approach (static analysis at build time) is highly effective for large codebases at Meta's scale but considered heavyweight for smaller projects. (Confidence: **Medium** — reflected in adoption patterns)

---

## 6. Pitfalls

### 6.1 Optimistic Update Race Conditions

**TanStack Query:** Must cancel outgoing refetches before applying optimistic update (`await queryClient.cancelQueries()`), otherwise the refetch response can overwrite the optimistic data. (Confidence: **High**)

**SWR:** Has built-in race condition avoidance for mutations — automatically discards responses from outdated requests. (Confidence: **High**)

**Relay:** Warns that if multiple optimistic responses each modify the same field (e.g., incrementing like_count), rollback of the first optimistic update can leave the store in an incorrect state. Recommends `optimisticUpdater` (imperative) over `optimisticResponse` (static) for counter-style updates. (Confidence: **High**)

**Source:** [TanStack Query — Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) — cancelQueries requirement
**Source:** [SWR — Mutation](https://swr.vercel.app/docs/mutation) — race condition avoidance
**Source:** [Relay — Optimistic Updates](https://relay.dev/docs/guided-tour/updating-data/graphql-mutations/) — concurrent optimistic update pitfall

### 6.2 Cache Key Serialization

- **TanStack Query:** Query keys are deterministically serialized (JSON-stable sort for objects). Developers must ensure key stability. Accidentally different key = cache miss = duplicate fetch. (Confidence: **High**)
- **RTK Query:** Uses `serializeQueryArgs` (configurable) — default is stable JSON stringify. (Confidence: **High**)
- **SWR:** String keys by default; object keys need serialization middleware (shown in middleware docs as "serialize object keys" example). (Confidence: **High**)

### 6.3 Stale Closure / React Concurrency

- All hook-based libraries face stale closure issues in callbacks within React concurrent mode.
- TanStack Query and SWR handle this via internal ref patterns.
- `useSyncExternalStore` (React 18+) is the standard way to safely subscribe to external stores without tearing. (Confidence: **High** — React team recommendation)

### 6.4 Apollo GC — Dangling References

After `cache.evict()`, references to the evicted object may remain in other cached objects ("dangling references"). Apollo preserves these by default. Custom `read` functions with `canRead` are needed to handle cleanup (e.g., filtering arrays, setting null). The default `read` function for list fields automatically filters dangling references. (Confidence: **High**)

**Source:** [Apollo Client — Dangling References](https://www.apollographql.com/docs/react/caching/garbage-collection) — canRead, automatic list filtering

### 6.5 Relay GC — Release Buffer Tuning

Relay's `gcReleaseBufferSize=10` default means the most recent 10 released queries remain cached for back-navigation. Too small = frequent refetches; too large = memory bloat. Must be tuned per application's navigation patterns. (Confidence: **High**)

**Source:** [Relay — Presence of Data](https://relay.dev/docs/guided-tour/reusing-cached-data/presence-of-data/) — gcReleaseBufferSize

---

## 7. Performance

### 7.1 Structural Sharing (TanStack Query)

TanStack Query performs deep structural sharing on every refetch response, preserving referential identity for unchanged subtrees. This is a tree-walk operation proportional to response size. Can be disabled via `structuralSharing: false` for large datasets where object identity is not important. (Confidence: **High**)

**Source:** [TanStack Query — Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)

### 7.2 Apollo Client — Result Caching and LRU

Apollo's `InMemoryCache` uses LRU memoization caches internally for `executeSelectionSet`, `maybeBroadcastWatch`, and other hot paths. Default base size: 1000 entries. `resultCaching: true` (default) memoizes read results so repeated reads with the same data return referentially identical objects. `cache.gc({resetResultCache: true})` releases this memory if needed. (Confidence: **High**)

**Source:** [Apollo Client — Memory Management](https://www.apollographql.com/docs/react/caching/memory-management) — LRU sizes, getMemoryInternals()

### 7.3 Relay — Compiler-Time Optimization

Relay's compiler generates optimized read/write selectors at build time, eliminating runtime overhead of parsing and resolving queries. This makes runtime reads very fast (direct field access on normalized records) at the cost of a build step. (Confidence: **High**)

**Source:** [Relay Docs — Introduction](https://relay.dev/docs/)

### 7.4 SWR — Deduplication Window

SWR deduplicates identical requests within a configurable `dedupingInterval` (default 2 seconds). Multiple components mounting with the same key within this window share a single request. (Confidence: **High**)

**Source:** [SWR — Getting Started](https://swr.vercel.app/docs/getting-started)

---

## 8. Sources

### TanStack Query
- [Overview / Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults) — staleTime, gcTime, structural sharing, retry defaults
- [Caching](https://tanstack.com/query/latest/docs/framework/react/guides/caching) — gcTime lifecycle, cache/network flow diagram
- [Query Invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation) — invalidateQueries, prefix/exact/predicate matching
- [Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) — onMutate/onError/onSettled pattern, cancelQueries

### RTK Query
- [Cache Behavior](https://redux-toolkit.js.org/rtk-query/usage/cache-behavior) — endpoint+params key, reference counting, keepUnusedDataFor
- [Automated Refetching](https://redux-toolkit.js.org/rtk-query/usage/automated-refetching) — providesTags/invalidatesTags, LIST pattern, tag invalidation flow

### SWR
- [Getting Started](https://swr.vercel.app/docs/getting-started) — useSWR API, 3 states, deduplication
- [Revalidation](https://swr.vercel.app/docs/revalidation) — on focus/interval/reconnect/mount, useSWRImmutable
- [Mutation](https://swr.vercel.app/docs/mutation) — global/bound mutate, useSWRMutation, optimisticData, rollbackOnError, race conditions
- [Error Handling](https://swr.vercel.app/docs/error-handling) — exponential backoff, onErrorRetry, shouldRetryOnError
- [Middleware](https://swr.vercel.app/docs/middleware) — wrapping pattern, composition order, examples
- [Advanced — Cache](https://swr.vercel.app/docs/advanced/cache) — Map-like interface, SWRConfig provider, persistence, test isolation

### Apollo Client
- [Caching Overview](https://www.apollographql.com/docs/react/caching/overview) — InMemoryCache, normalization, flat lookup table
- [Cache Configuration](https://www.apollographql.com/docs/react/caching/cache-configuration) — TypePolicy, keyFields, possibleTypes, resultCaching
- [Cache Interaction](https://www.apollographql.com/docs/react/caching/cache-interaction) — readQuery/writeQuery/readFragment/writeFragment/cache.modify/cache.batch
- [Garbage Collection and Eviction](https://www.apollographql.com/docs/react/caching/garbage-collection) — gc(), evict(), retain(), release(), dangling references, canRead
- [Memory Management](https://www.apollographql.com/docs/react/caching/memory-management) — LRU cache sizes, weak references, getMemoryInternals()
- [Optimistic UI](https://www.apollographql.com/docs/react/performance/optimistic-ui) — optimisticResponse, layered architecture, IGNORE sentinel
- [Link — Introduction](https://www.apollographql.com/docs/react/api/link/introduction) — link chain, middleware pattern

### Relay
- [Reusing Cached Data — Introduction](https://relay.dev/docs/guided-tour/reusing-cached-data/) — fragment-level caching
- [Fetch Policies](https://relay.dev/docs/guided-tour/reusing-cached-data/fetch-policies/) — store-or-network, store-and-network, network-only, store-only
- [Presence of Data](https://relay.dev/docs/guided-tour/reusing-cached-data/presence-of-data/) — GC, retain/Disposable, gcScheduler, gcReleaseBufferSize
- [Staleness of Data](https://relay.dev/docs/guided-tour/reusing-cached-data/staleness-of-data/) — invalidateStore(), invalidateRecord(), queryCacheExpirationTime, useSubscribeToInvalidationState
- [GraphQL Mutations](https://relay.dev/docs/guided-tour/updating-data/graphql-mutations/) — optimisticResponse, optimisticUpdater, updater, declarative directives, execution order
