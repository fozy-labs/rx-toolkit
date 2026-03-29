---
title: "External Research: Query Library Patterns"
date: 2026-03-28
stage: 01-research
role: rdpi-external-researcher
---

# External Research: Query Library Patterns

## 1. Initial/Seed Data with Age Checking

### Comparative Analysis

| Library | Approach | Pros | Cons | Confidence |
|---------|----------|------|------|------------|
| TanStack Query | `initialData` + `staleTime` + `initialDataUpdatedAt` | Fine-grained control; age-aware refetch logic; `initialDataUpdatedAt` decouples staleness from provision time | Requires manual timestamp management; three separate options to coordinate | **High** |
| RTK Query | `extractRehydrationInfo` + `refetchOnMountOrArgChange` (seconds) | Integrates with Redux hydration; `refetchOnMountOrArgChange` can be a number (seconds since last fulfilled) | No direct `initialData` per-endpoint; relies on store rehydration; no built-in age-of-initial-data concept | **High** |
| SWR (Vercel) | `fallbackData` option or `SWRConfig.fallback` | Simple; data available immediately; revalidation happens automatically on mount | No built-in age checking for fallback data; always revalidates unless `revalidateIfStale: false` | **High** |
| Apollo Client | `cache.writeQuery` / `cache.restore` for SSR hydration | Normalized cache; deduplication automatic; `fetchPolicy: 'cache-and-network'` controls refetch | No timestamp-based staleness; relies on fetch policies, not age | **High** |

### Established Practices

- **TanStack Query** is the only library with explicit age-aware initial data semantics. `initialData` is persisted to the cache. By default (`staleTime: 0`), it is considered stale immediately, triggering a refetch on mount. Setting `initialDataUpdatedAt` to a timestamp allows TanStack Query to calculate whether `staleTime` has been exceeded since the data was last updated, thus deciding to refetch or not. This is the closest analog to `initialSnapshot` + `maxSnapshotDataAge`. *Source: [TanStack Query — Initial Query Data](https://tanstack.com/query/latest/docs/framework/react/guides/initial-query-data)*. **Confidence: High**.

- **TanStack Query** distinguishes `initialData` (persisted to cache, treated as real data) from `placeholderData` (not persisted, purely UI convenience). This prevents stale placeholder data from polluting the cache. *Source: [TanStack Query — Placeholder Query Data](https://tanstack.com/query/latest/docs/framework/react/guides/placeholder-query-data)*. **Confidence: High**.

- **RTK Query** uses `refetchOnMountOrArgChange` which can accept a number (seconds). If a number is provided, it compares `Date.now()` against the last fulfilled timestamp and only refetches if enough time has elapsed. This is a global or per-hook setting, not per-initial-data. RTK Query does not have a direct equivalent of `initialDataUpdatedAt`. *Source: [RTK Query — createApi refetchOnMountOrArgChange](https://redux-toolkit.js.org/rtk-query/api/createApi)*. **Confidence: High**.

- **SWR** uses `fallbackData` (per-hook) or `SWRConfig.fallback` (provider-level) to pre-fill cache data. There is no age-checking mechanism for fallback data. SWR always revalidates on mount unless `revalidateIfStale: false` is set. The `dedupingInterval` (default 2000ms) prevents duplicate requests within a window, but this is unrelated to data age. *Source: [SWR — Prefetching Data](https://swr.vercel.app/docs/prefetching)*. **Confidence: High**.

- **Apollo Client** does not have a timestamp-based staleness concept. Cache data is either present or absent. The `fetchPolicy` (`cache-first`, `cache-and-network`, `network-only`) determines whether cached data is used and whether a network request is made. SSR hydration restores the full cache via `cache.restore()`. *Source: [Apollo Client — Caching](https://www.apollographql.com/docs/react/caching/overview)*. **Confidence: High**.

### Key Pattern: TanStack Query's `initialDataUpdatedAt`

The canonical pattern for "use this data if fresh enough, otherwise refetch" is:

```ts
useQuery({
  queryKey: ['todos'],
  queryFn: fetchTodos,
  initialData: cachedTodos,
  staleTime: 60_000, // 1 minute
  initialDataUpdatedAt: cachedTodosTimestamp, // e.g. Date.now() when snapshot was taken
})
```

If `Date.now() - initialDataUpdatedAt > staleTime`, a refetch is triggered immediately on mount. This is the direct equivalent of `maxSnapshotDataAge` semantics.

---

## 2. Lifecycle Hooks (onQueryStarted)

### Comparative Analysis

| Library | Approach | Pros | Cons | Confidence |
|---------|----------|------|------|------------|
| RTK Query | `onQueryStarted` per-endpoint | Runs on every query/mutation dispatch; provides `queryFulfilled` promise, `dispatch`, `updateCachedData`; supports optimistic & pessimistic patterns | Complex API surface; must handle promise rejection manually | **High** |
| RTK Query | `onCacheEntryAdded` per-endpoint | Runs once per cache entry creation; provides `cacheDataLoaded` and `cacheEntryRemoved` promises; ideal for streaming/WebSocket | Different lifecycle than `onQueryStarted`; only fires once per unique cache key | **High** |
| TanStack Query | `onMutate`, `onSuccess`, `onError`, `onSettled` on `useMutation` | Clean separation of lifecycle stages; `onMutate` runs synchronously before mutation | No equivalent for query lifecycle (only mutations); query side uses `enabled`, `select`, etc. | **High** |
| SWR | `onSuccess`, `onError` config options | Simple callback model; global or per-hook | No pre-query hook; no `onMutate` equivalent | **High** |
| Apollo Client | `update` function on `useMutation`; `onCompleted`, `onError` callbacks | Direct cache manipulation via `update`; `optimisticResponse` for pre-update | No `onQueryStarted` equivalent for queries | **High** |

### RTK Query `onQueryStarted` — Detailed Behavior

**When triggered**: Called every time a query or mutation is initiated (dispatched). For queries, this means every fetch (including refetches). For mutations, every call to `mutate()`.

**Arguments received**:
1. `arg` — the query/mutation argument
2. Lifecycle API object containing:
   - `dispatch` — Redux store dispatch
   - `getState` — current store state
   - `extra` — thunk extra argument
   - `requestId` — unique ID for this request
   - `queryFulfilled` — Promise that resolves with `{ data, meta }` on success, rejects on error
   - `getCacheEntry` — current cache entry value
   - `updateCachedData` (query endpoints only) — Immer-based cache updater

**Typical usage patterns**:
- **Optimistic updates**: Dispatch `updateQueryData` immediately, then `await queryFulfilled`; on catch, call `patchResult.undo()`.
- **Pessimistic updates**: `await queryFulfilled` to get server response, then use `updateQueryData` or `upsertQueryData`.
- **Side effects**: Dispatch actions at start, success, or error points.

*Source: [RTK Query — createApi onQueryStarted](https://redux-toolkit.js.org/rtk-query/api/createApi), [RTK Query — Manual Cache Updates](https://redux-toolkit.js.org/rtk-query/usage/manual-cache-updates)*. **Confidence: High**.

### RTK Query `onCacheEntryAdded` — `cacheDataLoaded` Promise

`cacheDataLoaded` resolves with the first value for a cache key. Critical behavior:

> "If the cache entry is removed from the cache before any value has ever been resolved, this Promise will reject with `new Error('Promise never resolved before cacheEntryRemoved.')` to prevent memory leaks."

This is the established pattern for handling pending promises when cache is cleared. RTK Query explicitly rejects the promise rather than leaving it hanging.

*Source: [RTK Query — createApi onCacheEntryAdded](https://redux-toolkit.js.org/rtk-query/api/createApi)*. **Confidence: High**.

---

## 3. SWR Error State Management

### Comparative Analysis

| Library | `data` after failed refetch | `error` after failed refetch | `isError` / error flag | Confidence |
|---------|---------------------------|-----------------------------|-----------------------|------------|
| SWR (Vercel) | Previous successful data retained | Error object set | Both `data` and `error` coexist | **High** |
| RTK Query | Last "good" `data` kept in cache | `error` set on the endpoint state | `isError: true`, but `data` still available | **High** |
| TanStack Query | Previous `data` retained | `error` set; `status` becomes `'error'` | `isError: true`; `isRefetchError: true`; `data` still returned | **High** |
| Apollo Client | Depends on `errorPolicy` (`none`/`all`/`ignore`) | With `errorPolicy: 'all'`, both data and errors coexist | GraphQL errors in `error.graphQLErrors`; network errors discard data by default | **High** |

### Established Practices

- **SWR explicitly documents that `data` and `error` can exist at the same time**: "Note that `data` and `error` can exist at the same time. So the UI can display the existing data, while knowing the upcoming request has failed." This is by design — SWR never clears previously fetched data when a revalidation fails. *Source: [SWR — Error Handling](https://swr.vercel.app/docs/error-handling)*. **Confidence: High**.

- **RTK Query documents the same behavior**: "It is possible for a hook to return `data` and `error` at the same time. By default, RTK Query will keep whatever the last 'good' result was in `data` until it can be updated or garbage collected." *Source: [RTK Query — Automatic retries](https://redux-toolkit.js.org/rtk-query/usage/customizing-queries)*. **Confidence: High**.

- **TanStack Query** differentiates between `isLoadingError` (first fetch failure) and `isRefetchError` (refetch failure). When a refetch fails, `status` becomes `'error'` but `data` from the previous successful fetch is preserved. The `isRefetchError` flag specifically indicates "query failed while refetching." *Source: [TanStack Query — useQuery Reference](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery)*. **Confidence: High**.

### Error Masking Analysis

No major library "masks" errors when stale data exists. The established pattern across all libraries is:

1. **Keep stale data available** in `data` field
2. **Set error information** in `error` field
3. **Set error flags** (`isError`, etc.) to `true`
4. Let the consumer decide how to render (show stale data with error banner, show error only, etc.)

If a library sets `isError: false` when `error` is non-null, that would be a genuine bug — it contradicts the universal pattern where error flags derive directly from `error`/`status` state.

---

## 4. Optimistic Update Rollback (Patcher/Commit Patterns)

### Comparative Analysis

| Library | Approach | Rollback Mechanism | Concurrent Mutation Safety | Confidence |
|---------|----------|-------------------|---------------------------|------------|
| RTK Query | `updateQueryData` returns `{ undo }` | Call `patchResult.undo()` to revert Immer patches | `.undo()` reverts specific patches; but overlapping mutations can conflict — docs recommend tag invalidation for concurrent case | **High** |
| TanStack Query (cache) | `setQueryData` in `onMutate`; snapshot previous value | Restore snapshot via `setQueryData` in `onError` | `cancelQueries` before optimistic update prevents overwrites; refetch on settled | **High** |
| TanStack Query (UI) | Use `variables` from pending mutation | No rollback needed — item disappears when mutation settles; refetch restores truth | Multiple pending mutations shown simultaneously via `useMutationState` | **High** |
| Apollo Client | `optimisticResponse` on `mutate()` | Automatic: optimistic layer stored separately; removed on server response or error; canonical data untouched | Optimistic responses stored in separate layer per mutation; rolled back independently | **High** |
| SWR | `mutate(key, data, { optimisticData, rollbackOnError })` | Built-in `rollbackOnError: true` (default) reverts to previous cache value | No explicit concurrent mutation handling | **Medium** |

### Established Practices

- **RTK Query** uses Immer-based patches. `dispatch(api.util.updateQueryData(...))` returns `{ patches, inversePatches, undo }`. The `undo()` function applies `inversePatches` to revert. For concurrent mutations, the docs explicitly warn: "Where many mutations are potentially triggered in short succession causing overlapping requests, you may encounter race conditions if attempting to roll back patches using the `.undo` property on failures. For these scenarios, it is often simplest and safest to invalidate the tags on error instead." *Source: [RTK Query — Optimistic Updates](https://redux-toolkit.js.org/rtk-query/usage/manual-cache-updates)*. **Confidence: High**.

- **Apollo Client** takes the strongest consistency approach: optimistic responses are stored in a separate layer, never overwriting the canonical cache. On server response, the optimistic layer is removed and canonical data is updated. On error/rejection, the optimistic layer is simply discarded, reverting to canonical state. Multiple concurrent optimistic updates each maintain their own layer. *Source: [Apollo Client — Optimistic UI](https://www.apollographql.com/docs/react/performance/optimistic-ui)*. **Confidence: High**.

- **TanStack Query** v5 offers two approaches: (1) UI-based optimistic updates using `variables` from the pending mutation (no cache manipulation, no rollback needed); (2) Cache-based using `onMutate` snapshot + `onError` restore + `onSettled` invalidation. For concurrent safety, the cache approach requires `cancelQueries` before the update. *Source: [TanStack Query — Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates)*. **Confidence: High**.

### Consistency Violation Patterns

A "consistency violation on commit" typically means the base state changed between when a patch was computed and when it was applied. This is the classic optimistic concurrency problem:

1. **RTK Query**: Immer patches are positional — if underlying data structure changes between patch creation and undo, `undo()` can produce incorrect results. This is a known limitation documented in their recommendation to use tag invalidation for concurrent cases.
2. **Apollo Client**: Avoids this entirely via layered storage — optimistic data never modifies canonical cache.
3. **TanStack Query**: The snapshot approach (`previousTodos` saved in `onMutate`) can conflict if two mutations snapshot and restore concurrently. The `cancelQueries` step partially mitigates this.

---

## 5. Cache Reset and Pending Promises

### Comparative Analysis

| Library | Cache Reset API | Pending Promise Behavior | Confidence |
|---------|----------------|--------------------------|------------|
| RTK Query | `api.util.resetApiState()` | `cacheDataLoaded` rejects with `Error('Promise never resolved before cacheEntryRemoved.')` | **High** |
| TanStack Query | `queryClient.clear()`, `queryClient.removeQueries()` | Active queries refetch; observers notified; no hanging promises (query lifecycle managed by observer) | **Medium** |
| SWR | `mutate(() => true, undefined, { revalidate: false })` or clear provider | Keys cleared; no explicit promise management documented | **Low** |
| Apollo Client | `client.clearStore()`, `client.resetStore()` | `resetStore()` triggers refetch of all active queries; `clearStore()` does not | **High** |

### Established Practices

- **RTK Query's explicit promise rejection on cache removal** is the canonical pattern for this problem. The `onCacheEntryAdded` lifecycle provides two promises: `cacheDataLoaded` (resolves when data first arrives) and `cacheEntryRemoved` (resolves when entry is evicted). If entry is removed before data arrives, `cacheDataLoaded` **rejects** to prevent memory leaks. The recommended pattern:

```ts
async onCacheEntryAdded(arg, { cacheDataLoaded, cacheEntryRemoved }) {
  try {
    const { data } = await cacheDataLoaded
    // set up streaming, etc.
  } catch {
    // cacheEntryRemoved before data loaded — no-op
  }
  await cacheEntryRemoved
  // cleanup (close WebSocket, etc.)
}
```

*Source: [RTK Query — onCacheEntryAdded](https://redux-toolkit.js.org/rtk-query/api/createApi)*. **Confidence: High**.

- **Apollo Client's `resetStore()`** calls `reFetchObservableQueries()` after clearing, ensuring all active watchers get fresh data. `clearStore()` simply empties the cache without refetching. Neither leaves promises hanging — the observable-based architecture means queries re-emit based on cache state changes. *Source: [Apollo Client docs](https://www.apollographql.com/docs/react/api/core/ApolloClient)*. **Confidence: High**.

- **TanStack Query** manages query lifecycle through observers. Removing a query from cache triggers observer notifications. There's no concept of a "hanging promise" because the observer pattern decouples fetching from consuming — if a query is removed, the observer state transitions to `pending` for the next fetch. *Source: Community consensus and library architecture.* **Confidence: Medium**.

### Key Insight

The established best practice is: **pending promises associated with cache entries MUST be rejected or resolved when the cache entry is destroyed.** Leaving them hanging causes memory leaks and can leave consumers in an indefinite waiting state. RTK Query explicitly implements this with a descriptive error message.

---

## 6. Documentation Patterns for Query Libraries

### Comparative Analysis

| Library | API Reference | Guides | Interactive Examples | Migration Guides | Recipes | Confidence |
|---------|--------------|--------|---------------------|-----------------|---------|------------|
| TanStack Query | Full TypeScript-driven API docs for every hook, class, method | 25+ detailed guides (queries, mutations, SSR, optimistic updates, suspense, etc.) | 15+ CodeSandbox/StackBlitz examples (simple, pagination, optimistic updates, infinite scroll, etc.) | v3→v4, v4→v5 migration guides | Guides double as recipes with code examples | **High** |
| RTK Query | Comprehensive API docs (createApi, fetchBaseQuery, hooks, utils) | Usage guides (queries, mutations, caching, polling, SSR, streaming, etc.) | Examples section with CodeSandbox links | Migrating to RTK Query guide | Multiple recipe sections (optimistic updates, pessimistic updates, streaming) | **High** |
| SWR | Single API page; concise | ~15 pages (getting started, error handling, pagination, mutation, revalidation, etc.) | CodeSandbox links on select pages | Not applicable (single major version) | "Advanced" section (understanding, performance, cache, React Native) | **High** |
| Apollo Client | Detailed API docs per hook and class | Extensive guides (queries, mutations, fragments, caching, SSR, subscriptions) | CodeSandbox examples for complex scenarios | v3→v4, v4→v5 migration guides | Dedicated "Performance" section (optimistic UI, SSR) | **High** |

### Established Documentation Patterns

1. **Getting Started / Quick Start**: All libraries have a "start here" page showing basic usage in < 20 lines of code. *Confidence: High*.

2. **API Reference**: All libraries provide per-export API documentation with TypeScript signatures, parameter descriptions, and return value documentation. TanStack Query is the most granular (per-hook pages). *Confidence: High*.

3. **Guides & Concepts**: Separate from API reference. Cover specific use cases (SSR, optimistic updates, pagination, error handling, streaming). These are the most-read pages. *Confidence: High*.

4. **Interactive Examples**: TanStack Query leads with 15+ embedded CodeSandbox/StackBlitz examples linked directly from the docs sidebar. Each example is a standalone working app. RTK Query provides CodeSandbox links within guide pages. SWR includes occasional CodeSandbox links. *Confidence: High*.

5. **Migration Guides**: TanStack Query and Apollo Client provide detailed version-to-version migration guides listing breaking changes, new APIs, and code transformation examples. *Confidence: High*.

6. **Comparison Pages**: TanStack Query has a dedicated comparison page (`/comparison`) comparing itself with RTK Query, SWR, and Apollo Client across features. *Confidence: High*.

7. **Devtools Documentation**: TanStack Query, RTK Query, and SWR all document dedicated devtools for inspecting cache state, queries, and mutations. *Confidence: High*.

8. **TypeScript Integration**: All libraries document TypeScript usage, type inference, and type-safety patterns. *Confidence: High*.

### Documentation Structure (TanStack Query — Gold Standard)

```
├── Getting Started (Overview, Installation, Quick Start, Devtools, Comparison, TypeScript)
├── Guides & Concepts (25+ pages)
│   ├── Important Defaults
│   ├── Queries, Query Keys, Query Functions
│   ├── Network Mode, Parallel Queries, Dependent Queries
│   ├── Background Fetching, Window Focus, Disabling, Retries
│   ├── Paginated, Infinite Queries
│   ├── Initial Data, Placeholder Data
│   ├── Mutations, Invalidation, Optimistic Updates
│   ├── Cancellation, Filters, Prefetching, SSR, Caching
│   ├── Suspense, Testing
│   └── Migration Guides (v3, v4, v5)
├── API Reference (per hook/class/utility)
├── ESLint Plugin (dedicated section)
├── Examples (15+ interactive)
└── Plugins (persistence, broadcast, etc.)
```

---

## Opinions and Speculation

- **TanStack Query's UI-based optimistic update pattern** (using `variables` instead of cache manipulation) is gaining popularity as a simpler alternative to cache patching. TkDodo (maintainer) has written about this approach being preferred for single-location updates. *Source: [TkDodo's blog](https://tkdodo.eu/blog/concurrent-optimistic-updates-in-react-query)*. **Confidence: Medium** (expert opinion, not official docs).

- Some community discussions suggest that SWR's simplicity in error handling (both `data` and `error` coexist without explicit flags like `isRefetchError`) can lead to confusion for developers who expect `data` to be cleared on error. This is a design choice, not a bug. **Confidence: Low** (community sentiment).

---

## Pitfalls

1. **TanStack Query `initialData` vs `placeholderData` confusion**: Using `initialData` with stale data pollutes the cache. Use `placeholderData` for temporary display-only data. *Source: [TanStack Query docs](https://tanstack.com/query/latest/docs/framework/react/guides/placeholder-query-data)*. **Confidence: High**.

2. **RTK Query optimistic rollback with concurrent mutations**: Using `patchResult.undo()` with overlapping mutations can produce incorrect cache state. The official recommendation is to use tag invalidation instead. *Source: [RTK Query docs](https://redux-toolkit.js.org/rtk-query/usage/manual-cache-updates)*. **Confidence: High**.

3. **Forgetting to `try/catch` `cacheDataLoaded`**: In RTK Query's `onCacheEntryAdded`, if you `await cacheDataLoaded` without catching, and the cache is cleared before data loads, the unhandled rejection can cause issues. *Source: [RTK Query docs](https://redux-toolkit.js.org/rtk-query/api/createApi)*. **Confidence: High**.

4. **SWR `fallbackData` does not have age semantics**: Unlike TanStack Query's `initialData` + `staleTime`, SWR's `fallbackData` has no age-checking mechanism. SWR will always revalidate on mount (unless disabled). Developers expecting "use this data if fresh enough" must implement the logic themselves. *Source: [SWR docs](https://swr.vercel.app/docs/prefetching)*. **Confidence: High**.

5. **Apollo Client `optimisticResponse` requires `__typename` and `id`**: Forgetting these fields means Apollo cannot normalize the optimistic result, leading to cache misses. *Source: [Apollo docs](https://www.apollographql.com/docs/react/performance/optimistic-ui)*. **Confidence: High**.

---

## Performance

No specific benchmarks were found comparing these libraries' initial data/snapshot handling or optimistic update performance. The performance characteristics are primarily determined by:

- **Cache normalization overhead**: Apollo Client (normalized) > TanStack Query / RTK Query (key-based) > SWR (key-based, minimal).
- **Immer overhead**: RTK Query and TanStack Query (cache-based optimistic) use Immer for immutable updates, which has measurable overhead on large data structures.
- **Layer-based optimistic updates**: Apollo Client's layered approach avoids data copying for rollback but requires more memory for concurrent optimistic mutations.

**Confidence: Medium** (architectural analysis, no benchmarks).

---

## Sources

- [TanStack Query — Initial Query Data](https://tanstack.com/query/latest/docs/framework/react/guides/initial-query-data) — `initialData`, `initialDataUpdatedAt`, `staleTime` interaction
- [TanStack Query — Placeholder Query Data](https://tanstack.com/query/latest/docs/framework/react/guides/placeholder-query-data) — `placeholderData` vs `initialData`
- [TanStack Query — useQuery Reference](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery) — full return type including `isRefetchError`, `isLoadingError`
- [TanStack Query — Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) — UI-based and cache-based approaches
- [RTK Query — createApi](https://redux-toolkit.js.org/rtk-query/api/createApi) — `onQueryStarted`, `onCacheEntryAdded`, `cacheDataLoaded`, `refetchOnMountOrArgChange`
- [RTK Query — Manual Cache Updates](https://redux-toolkit.js.org/rtk-query/usage/manual-cache-updates) — optimistic/pessimistic update patterns, `updateQueryData`, `undo()`
- [RTK Query — Customizing Queries](https://redux-toolkit.js.org/rtk-query/usage/customizing-queries) — `data` and `error` coexistence note
- [SWR — Error Handling](https://swr.vercel.app/docs/error-handling) — `data` and `error` coexistence, error retry
- [SWR — Understanding SWR](https://swr.vercel.app/docs/advanced/understanding) — state machine diagrams, `isLoading` vs `isValidating`
- [SWR — Prefetching Data](https://swr.vercel.app/docs/prefetching) — `fallbackData`, `preload`, pre-fill patterns
- [SWR — Automatic Revalidation](https://swr.vercel.app/docs/revalidation) — `revalidateIfStale`, `revalidateOnMount`
- [SWR — Usage with Next.js](https://swr.vercel.app/docs/with-nextjs) — `SWRConfig.fallback`, RSC prefetching
- [Apollo Client — Optimistic UI](https://www.apollographql.com/docs/react/performance/optimistic-ui) — `optimisticResponse`, layered cache, rollback lifecycle
