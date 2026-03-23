---
title: "External Research: Reset All Cache → Refetch Active Queries"
date: 2026-03-23
stage: 01-research
role: rdpi-external-researcher
---

## Comparative Analysis

| Feature | RTK Query (v2.x) | TanStack Query (v5.x) |
|---|---|---|
| Reset method | `api.util.resetApiState()` | `queryClient.resetQueries(filters?)` |
| Scope | Entire cache (all endpoints) | Filterable by query key, predicate, exact match |
| State after reset | All slices → initial Redux state | Each query → `#initialState` (respects `initialData`) |
| Cancels in-flight | Yes — aborts all running queries and mutations | Yes — per-query via `query.destroy()` |
| Auto-refetch active | **No** — hooks must detect uninitialized state on next render | **Yes** — explicitly calls `refetchQueries({ type: 'active' })` |
| Returns promise | No (sync Redux action dispatch) | Yes — resolves when all active refetches complete |
| Preserves subscriptions | No — clears all subscriptions map to `{}` | Yes — observers remain attached to queries |
| Notifies observers directly | No — state change is indirect via Redux store | Yes — `query.setState()` triggers `onQueryUpdate()` on observers |
| Confidence | **High** (official docs + source code) | **High** (official docs + source code) |

---

## RTK Query: `resetApiState`

### Mechanism (Source Code)

**Action creation** (`buildSlice.ts`):

```ts
const resetApiState = createAction(`${reducerPath}/resetApiState`)
```

**Combined reducer** (`buildSlice.ts` ~line 719):

```ts
const reducer = (state, action) =>
  combinedReducer(resetApiState.match(action) ? undefined : state, action)
```

When `resetApiState` matches, passes `undefined` as state to the combined reducer, which resets ALL slices (queries, mutations, subscriptions, config, provided) to their initial Redux state.

**Confidence:** High — verified in RTK source: [`packages/toolkit/src/query/core/buildSlice.ts`](https://github.com/reduxjs/redux-toolkit/blob/master/packages/toolkit/src/query/core/buildSlice.ts)

### Middleware Behavior on Reset

The RTKQ middleware intercepts `resetApiState` in multiple handlers:

1. **`batchActions.ts`**: Clears `previousSubscriptions` to `{}`, clears `internalState.currentSubscriptions`, nulls sync timer. Returns `[true, false]` allowing action to continue to reducer.

2. **`cacheCollection.ts`**: Clears all removal timeouts, calls `abortAllPromises(internalState.runningQueries)` and `abortAllPromises(internalState.runningMutations)` — aborts ALL in-flight network requests.

3. **`devMiddleware.ts`**: Re-dispatches `api.internalActions.middlewareRegistered(apiUid)` to re-register middleware after state reset.

4. **`invalidationByTags.ts`** and **`windowEventHandling.ts`**: Not triggered by resetApiState — these respond to tag invalidation and window focus events respectively.

**Key finding**: resetApiState does NOT invoke any refetch logic. It only clears state and aborts running requests.

**Confidence:** High — verified across 4 middleware handler files in RTK source code.

### How Hooks Detect Reset

After `resetApiState`, all queries are in `uninitialized` status. The `useQuery`/`useQuerySubscription` hooks detect this on the next React render cycle:

- Hook's subscription effect depends on `stableArg` and query state
- When state becomes uninitialized, the hook re-initiates the query via `endpoint.initiate()`
- This is an **indirect** refetch — requires a React re-render to trigger

**Test evidence** (`buildHooks.test.tsx` ~line 905):
> "hook should not be stuck loading post resetApiState after re-render"

This test unmounts/remounts a component after reset to verify the hook re-initiates the query. The test name itself reveals the concern: hooks CAN get stuck if re-render doesn't happen.

**Official documentation caveat**:
> "Note that hooks also track state in local component state and might not fully be reset by resetApiState."

Source: [RTK Query API Slice Utilities — resetApiState](https://redux-toolkit.js.org/rtk-query/api/created-api/api-slice-utils#resetapistate)

**Confidence:** High — official docs + test file confirm the limitation.

### Subscription Tracking Model

- Subscriptions are reference-counted Maps in middleware internal state (`internalState.currentSubscriptions`)
- Each `useQuery` hook subscribes on mount, unsubscribes on unmount
- Cache key = endpoint name + serialized args (e.g., `getUser({"id":1})`)
- Data retained while subscriber count > 0; removal timer starts when count reaches 0 (default `keepUnusedDataFor: 60` seconds)

Source: [RTK Query Cache Behavior](https://redux-toolkit.js.org/rtk-query/usage/cache-behavior)

**Confidence:** High

### Tag Invalidation as Comparison Point

`invalidateTags` (via `invalidationByTags.ts`) uses a different approach that DOES refetch active queries:

```ts
// For each invalidated query:
if (subscriberCount > 0) {
  dispatch(refetchQuery(querySubState))  // refetch active
} else {
  dispatch(removeQueryResult())          // remove inactive
}
```

Where `refetchQuery` calls:
```ts
endpoint.initiate(originalArgs, { subscribe: false, forceRefetch: true })
```

This is the mechanism `resetApiState` does NOT use — it clears everything instead of selectively refetching.

**Confidence:** High — source code verified.

---

## TanStack Query: `resetQueries`

### Mechanism (Source Code)

**`queryClient.ts`** (lines 257–277):

```ts
resetQueries(filters?, options?) {
  const queryCache = this.#queryCache
  return notifyManager.batch(() => {
    queryCache.findAll(filters).forEach((query) => {
      query.reset()
    })
    return this.refetchQueries(
      { type: 'active', ...filters },
      options,
    )
  })
}
```

Two-phase design:
1. **Reset**: iterates matching queries, calls `query.reset()` on each
2. **Refetch**: explicitly calls `this.refetchQueries({ type: 'active', ...filters })` to refetch active queries

Source: [`packages/query-core/src/queryClient.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/queryClient.ts)

**Confidence:** High — exact source code.

### `query.reset()` Implementation

```ts
// query.ts (lines 270-273)
reset(): void {
  this.destroy()           // cancel in-flight fetch
  this.setState(this.resetState)  // restore to #initialState
}

get resetState(): QueryState {
  return this.#initialState  // includes initialData if set
}

isActive(): boolean {
  return this.observers.some(
    (observer) => resolveEnabled(observer.options.enabled, this) !== false,
  )
}
```

- `destroy()` cancels the current fetch via `this.#retryer?.cancel()`
- `setState()` dispatches state change, which triggers `onQueryUpdate()` on all attached observers
- If `initialData` was configured, data resets to that value; otherwise data becomes `undefined`, status becomes `pending`

Source: [`packages/query-core/src/query.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/query.ts)

**Confidence:** High

### Observer Pattern

- `QueryObserver` extends `Subscribable<QueryObserverListener>`
- Each `useQuery` hook creates a `QueryObserver` instance
- Observer subscribes to query via `query.addObserver(this)` on mount
- When query state changes → `observer.onQueryUpdate()` → `updateResult()` → `#updateTimers()` → notifies React via listener callback
- Active query = has at least one observer with `enabled !== false`

Observer lifecycle:
```
useQuery mount  →  new QueryObserver  →  query.addObserver(observer)
useQuery unmount →  observer.destroy() →  query.removeObserver(observer)
```

Source: [`packages/query-core/src/queryObserver.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/queryObserver.ts)

**Confidence:** High

### `invalidateQueries` vs `resetQueries` (from source)

```ts
// invalidateQueries — queryClient.ts lines 292-313
invalidateQueries(filters?, options?) {
  return notifyManager.batch(() => {
    this.#queryCache.findAll(filters).forEach((query) => {
      query.invalidate()  // marks isInvalidated=true, keeps existing data
    })
    return this.refetchQueries(
      { ...filters, type: filters?.refetchType ?? filters?.type ?? 'active' },
      options,
    )
  })
}
```

| Aspect | `resetQueries` | `invalidateQueries` |
|--------|---------------|---------------------|
| Existing data | Cleared (or reset to `initialData`) | Preserved (shown during background refetch) |
| Query status | → `pending` | Stays `success` (with `isInvalidated: true`) |
| Observer notification | Yes (via `setState`) | Yes (via `invalidate()` dispatch) |
| Active query refetch | Yes | Yes |
| UX during refetch | Loading state (no data visible) | Stale data visible with background refresh |

Source: [`packages/query-core/src/queryClient.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/queryClient.ts)

**Confidence:** High

### Other Cache Operations (for completeness)

| Method | Clears data | Notifies observers | Refetches | Use case |
|--------|------------|-------------------|-----------|----------|
| `resetQueries` | Yes (to initial) | Yes | Active only | Logout / full reset |
| `invalidateQueries` | No (marks stale) | Yes | Active (default) | Data changed on server |
| `removeQueries` | Yes (removes entry) | No | No | Cleanup |
| `clear` | Yes (all caches) | Removes all subscribers | No | Teardown |

Source: [QueryClient Reference](https://tanstack.com/query/latest/docs/reference/QueryClient)

**Confidence:** High

### Test Coverage for `resetQueries`

From `packages/query-core/src/__tests__/queryClient.test.tsx`:
- "should notify listeners when a query is reset" — verifies cache subscription callback fires
- "should reset query" — data→`undefined`, status→`pending`
- "should reset query data to initial data if set" — `initialData: 'initial'` is restored after reset
- "should refetch all active queries" — confirms only active (observed) queries are refetched

From `packages/react-query/src/__tests__/useQuery.test.tsx`:
- "should update query state and refetch when reset with resetQueries" — full React integration: verifies component sees pending→success transition after button click triggers `queryClient.resetQueries()`

**Confidence:** High — verified in test files.

---

## Established Practices

### Two-Phase Reset Pattern

Both libraries conceptually implement reset as a two-phase operation, though with different execution models:

1. **Phase 1 — Clear state**: Reset cache entries to initial/empty state
2. **Phase 2 — Refetch active**: Re-execute queries that have active subscribers/observers

TanStack Query makes both phases explicit in a single synchronous batch. RTK Query only implements Phase 1 explicitly; Phase 2 happens implicitly when hooks re-render and detect uninitialized state.

**Confirmed by:** RTK source (buildSlice.ts, middleware handlers) + TanStack source (queryClient.ts `resetQueries`).

**Confidence:** High

### Observer/Subscription as "Active" Indicator

Both libraries use the presence of a subscriber/observer as the canonical definition of "active":

- **RTK Query**: `subscriptionCount > 0` in middleware internal state
- **TanStack Query**: `query.observers.length > 0` with `enabled !== false`

This is the established way to determine which queries to refetch — queries with mounted UI components consuming their data.

**Confidence:** High

### Batch Notification

TanStack Query wraps reset + refetch inside `notifyManager.batch()` to coalesce multiple state changes into a single notification cycle. This prevents intermediate renders where data is cleared but refetch hasn't started yet.

RTK Query relies on Redux batching (via `batch` from React-Redux) for similar effect, though `resetApiState` doesn't batch with refetch since refetch is not part of the reset action.

**Confidence:** High — source code verified.

---

## Opinions and Speculation

### "resetQueries is the logout pattern"

TanStack Query's documentation explicitly positions `resetQueries` as the method for logout/auth scenarios:

> "This will notify subscribers — unlike clear, which removes all subscribers — and reset the query to its pre-loaded state — unlike invalidateQueries. If a query has initialData, the query's data will be reset to that. If a query is active, it will be refetched."

The RTK Query community commonly uses `dispatch(api.util.resetApiState())` for logout, but this has the documented caveat about hooks potentially not being fully reset.

**Confidence:** Medium — official TanStack doc language; RTK community patterns from docs examples.

### RTK Query "Providing Errors to the Cache" Pattern for Auth

RTK Query docs describe an alternative auth pattern where failed queries provide an `UNAUTHORIZED` tag, and the `login` mutation invalidates that tag, causing previously-failed queries to retry if still subscribed:

```ts
// On 401 error, provide UNAUTHORIZED tag
providesTags: (result, error) =>
  error?.status === 401 ? ['UNAUTHORIZED'] : [/* normal tags */]

// Login mutation invalidates UNAUTHORIZED
invalidatesTags: ['UNAUTHORIZED']
```

This is an alternative to resetApiState that uses the tag invalidation system for auth flows.

Source: [RTK Query Automated Refetching](https://redux-toolkit.js.org/rtk-query/usage/automated-refetching)

**Confidence:** Medium — documented example, but categorized as a "recipe" rather than a first-class recommendation.

---

## Pitfalls

### RTK Query: Hooks Stuck in Loading State After Reset

Official docs warn: "hooks also track state in local component state and might not fully be reset by resetApiState." The test case name confirms this concern: "hook should not be stuck loading post resetApiState **after re-render**" — the "after re-render" qualifier is key. Without re-render, hooks can remain in a stale loading state.

**Implication for rx-toolkit**: If the agent/hook doesn't re-render after `api.resetAll()`, it may never detect the reset and re-initiate the fetch. This is exactly the bug described in TASK.md.

Source: [RTK Query API Slice Utilities](https://redux-toolkit.js.org/rtk-query/api/created-api/api-slice-utils#resetapistate), RTK source `buildHooks.test.tsx` ~line 905

**Confidence:** High

### RTK Query: Subscriptions Cleared on Reset

`resetApiState` clears the subscription map entirely (`batchActions.ts`). This means the middleware loses track of which queries had active consumers. After reset, hooks must re-subscribe, which only happens when they re-render with `useEffect` firing again.

**Implication**: There is a window between reset (subscriptions cleared) and hook re-render (subscriptions re-established) where the system has no record of active queries.

**Confidence:** High — source code verified.

### TanStack Query: Data Disappears During Reset Refetch

Unlike `invalidateQueries` (which keeps stale data visible during background refetch), `resetQueries` clears data immediately. Components will show a loading state until the refetch completes. For sensitive UX scenarios, `invalidateQueries` may be preferred over `resetQueries` when data continuity matters.

**Confidence:** High — documented behavior difference.

### TanStack Query: `clear()` vs `resetQueries()` Confusion

`clear()` removes ALL subscribers and clears all caches — it does NOT notify observers and does NOT trigger refetches. Using `clear()` for logout will leave React components in an orphaned state with no data and no refetch. `resetQueries()` is the correct method for "clear data + maintain subscriptions + refetch."

**Confidence:** High — documented in QueryClient reference.

---

## Performance

### TanStack Query `resetQueries` Batching

The `notifyManager.batch()` wrapper ensures all query resets and refetch initiations happen in a single microtask batch. Subscribers receive one combined notification rather than N individual notifications for N queries.

Source: [`packages/query-core/src/queryClient.ts`](https://github.com/TanStack/query/blob/main/packages/query-core/src/queryClient.ts)

**Confidence:** High

### RTK Query: All In-Flight Aborted

`resetApiState` aborts ALL running queries and mutations unconditionally via `abortAllPromises()`. This includes queries that might be in the process of successfully completing. After reset, each query must start a fresh network request from scratch — there is no way to preserve or reuse pending responses.

Source: RTK source `cacheCollection.ts`

**Confidence:** High

### TanStack Query: `cancelRefetch` Option

`resetQueries` accepts `cancelRefetch` (default `true`). When `true`, currently running requests are cancelled before new ones start. When `false`, existing in-flight requests are kept and no duplicate request is made. This gives fine-grained control over network behavior during reset.

Source: [QueryClient Reference](https://tanstack.com/query/latest/docs/reference/QueryClient#queryclientresetqueries)

**Confidence:** High

---

## Sources

- [RTK Query: API Slice Utilities (resetApiState)](https://redux-toolkit.js.org/rtk-query/api/created-api/api-slice-utils#resetapistate) — official docs on resetApiState behavior and caveats
- [RTK Query: Cache Behavior](https://redux-toolkit.js.org/rtk-query/usage/cache-behavior) — subscription model, keepUnusedDataFor, cache lifecycle
- [RTK Query: Automated Refetching](https://redux-toolkit.js.org/rtk-query/usage/automated-refetching) — tag invalidation system, providing errors to cache auth pattern
- [RTK Query: Hooks](https://redux-toolkit.js.org/rtk-query/api/created-api/hooks) — useQuery, useQuerySubscription, hook behavior on state changes
- [RTK Source: buildSlice.ts](https://github.com/reduxjs/redux-toolkit/blob/master/packages/toolkit/src/query/core/buildSlice.ts) — resetApiState action creator, combined reducer reset logic
- [RTK Source: buildMiddleware/](https://github.com/reduxjs/redux-toolkit/tree/master/packages/toolkit/src/query/core/buildMiddleware) — batchActions.ts, cacheCollection.ts, devMiddleware.ts, invalidationByTags.ts, windowEventHandling.ts
- [RTK Source: buildHooks.test.tsx](https://github.com/reduxjs/redux-toolkit/blob/master/packages/toolkit/src/query/tests/buildHooks.test.tsx) — "hook should not be stuck loading post resetApiState after re-render" test
- [TanStack Query: QueryClient Reference](https://tanstack.com/query/latest/docs/reference/QueryClient) — resetQueries, invalidateQueries, removeQueries, refetchQueries, clear
- [TanStack Query: Query Invalidation Guide](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation) — invalidation semantics, query matching, predicate filtering
- [TanStack Query: QueryObserver Reference](https://tanstack.com/query/latest/docs/reference/QueryObserver) — observer pattern, subscribe/unsubscribe
- [TanStack Source: queryClient.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/queryClient.ts) — resetQueries and invalidateQueries implementation
- [TanStack Source: query.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/query.ts) — query.reset(), query.isActive(), query.destroy(), observer tracking
- [TanStack Source: queryObserver.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/queryObserver.ts) — observer lifecycle, onQueryUpdate, updateResult
- [TanStack Source: queryClient.test.tsx](https://github.com/TanStack/query/blob/main/packages/query-core/src/__tests__/queryClient.test.tsx) — resetQueries test cases
- [TanStack Source: useQuery.test.tsx](https://github.com/TanStack/query/blob/main/packages/react-query/src/__tests__/useQuery.test.tsx) — "should update query state and refetch when reset with resetQueries" React integration test
