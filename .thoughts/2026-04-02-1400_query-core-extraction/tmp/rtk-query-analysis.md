---
title: "External Research: RTK Query Core/Operation Separation"
date: 2026-04-02
stage: 01-research
role: rdpi-external-researcher
---

## 1. Endpoint Type Separation (Query vs Mutation)

### Definition Layer (`endpointDefinitions.ts`)
- `build.query()` → `QueryDefinition`, `build.mutation()` → `MutationDefinition`
- Both extend `CommonEndpointDefinition<QueryArg, BaseQuery, ResultType>` for shared fields: `query`/`queryFn`, `transformResponse`, `transformErrorResponse`, `extraOptions`, `onQueryStarted`, `onCacheEntryAdded`
- **Query-only fields**: `providesTags`, `keepUnusedDataFor`, `merge`, `forceRefetch`, `serializeQueryArgs`, `structuralSharing`
- **Mutation-only fields**: `invalidatesTags`, `fixedCacheKey`
- Endpoint type distinguished by a `type` field: `ENDPOINT_QUERY` vs `ENDPOINT_MUTATION` (+ `ENDPOINT_INFINITEQUERY`)
- Runtime helpers: `isQueryDefinition()`, `isMutationDefinition()`, `isInfiniteQueryDefinition()`

**Source**: `packages/toolkit/src/query/endpointDefinitions.ts` — **Confidence: High**

### Endpoint Injection (`core/module.ts`)
- `injectEndpoint()` checks definition type and assigns different capabilities:
  - Query: `{ name, select: buildQuerySelector(), initiate: buildInitiateQuery(), ...buildMatchThunkActions(queryThunk) }`
  - Mutation: `{ name, select: buildMutationSelector(), initiate: buildInitiateMutation(), ...buildMatchThunkActions(mutationThunk) }`
- Pattern: same injection point, different builder functions per type

**Source**: `packages/toolkit/src/query/core/module.ts:701-720` — **Confidence: High**

---

## 2. Shared Architecture

### Module System (`createApi.ts`)
- `buildCreateApi(...modules)` — composable module architecture
- `coreModule()` provides: reducer, middleware, thunks, selectors
- `reactHooksModule()` provides: React hooks (separate optional module)
- `createApi` from `@reduxjs/toolkit/query/react` = `buildCreateApi(coreModule(), reactHooksModule())`
- `createApi` from `@reduxjs/toolkit/query` = `buildCreateApi(coreModule())`

**Source**: `packages/toolkit/src/query/createApi.ts`, `packages/toolkit/src/query/react/index.ts` — **Confidence: High**

### Shared Middleware (`core/buildMiddleware/`)
- **Single middleware** handles both query and mutation actions
- `InternalMiddlewareState` tracks: `currentSubscriptions`, `currentPolls`, `runningQueries` (Map), `runningMutations` (Map)
- Sub-handlers: `cacheLifecycle`, `queryLifecycle`, `invalidationByTags`, `polling`, `batchedActions`
- `queryLifecycle` handler: `isPendingThunk = isPending(queryThunk, mutationThunk)` — matches **both** thunk types in a single matcher, then inspects at runtime
- Cache collection applies `keepUnusedDataFor` only to queries (mutations don't auto-collect)

**Source**: `packages/toolkit/src/query/core/buildMiddleware/types.ts`, `queryLifecycle.ts` — **Confidence: High**

### Shared `executeEndpoint` (`core/buildThunks.ts`)
- **Single async payload creator** `executeEndpoint` used by both `queryThunk` and `mutationThunk`
- Internally checks `arg.type === ENDPOINT_QUERY` to differentiate behavior
- Both share: `query`/`queryFn` dispatch, `transformResponse`/`transformErrorResponse`, schema validation, `baseQueryApi` construction
- Queries get extra `forced` and `queryCacheKey` fields in `baseQueryApi`; mutations don't

**Source**: `packages/toolkit/src/query/core/buildThunks.ts:495-620` — **Confidence: High**

### Tag System
- `providesTags` (query-only) + `invalidatesTags` (mutation-only) use shared `calculateProvidedBy()` function
- `calculateProvidedByThunk()` inspects both query and mutation fulfilled/rejected actions
- `invalidationSlice` tracks tag→queryCacheKey mappings; queries register, mutations trigger invalidation

**Source**: `packages/toolkit/src/query/core/buildThunks.ts:1103-1124` — **Confidence: High**

---

## 3. API Slice Internal Structure

### Combined Reducer Shape (`CombinedState`)
```
state[reducerPath] = {
  queries:       QueryState<D>         // querySlice
  mutations:     MutationState<D>      // mutationSlice
  provided:      InvalidationState<E>  // invalidationSlice
  subscriptions: SubscriptionState     // internalSubscriptionsSlice
  config:        ConfigState<Path>     // configSlice
}
```
- Built via `combineReducers({ queries, mutations, provided, subscriptions, config })`
- `resetApiState` action resets all sub-slices at once

**Source**: `packages/toolkit/src/query/core/buildSlice.ts:686-734`, `core/apiState.ts:323-360` — **Confidence: High**

### 6 Internal Sub-Slices
1. **querySlice** — `${reducerPath}/queries`
2. **mutationSlice** — `${reducerPath}/mutations`
3. **invalidationSlice** — `${reducerPath}/provided` (tag tracking)
4. **subscriptionSlice** — dummy slice to generate action types
5. **internalSubscriptionsSlice** — real subscription state via patches
6. **configSlice** — `online`, `focused`, `middlewareRegistered`, refetch settings

**Source**: `docs/rtk-query/internal/buildSlice.mdx`, `core/buildSlice.ts` — **Confidence: High**

---

## 4. State Per Endpoint Type

### Query State (`QuerySubState`)
- Keyed by `queryCacheKey` (serialized `endpointName` + `args`)
- Fields: `status`, `originalArgs`, `requestId`, `data`, `error`, `endpointName`, `startedTimeStamp`, `fulfilledTimeStamp`
- Status union: `uninitialized | pending | fulfilled | rejected`
- Has subscription tracking (subscription count determines cache lifetime)
- `keepUnusedDataFor` TTL applies

### Mutation State (`MutationSubState`)
- Keyed by `requestId` or `fixedCacheKey`
- Fields: `status`, `requestId`, `data`, `error`, `endpointName`, `startedTimeStamp`, `fulfilledTimeStamp`
- Status union: same `uninitialized | pending | fulfilled | rejected`
- **No subscription tracking** — result stays until explicitly `reset()`
- **No automatic cleanup** — consumer calls `removeMutationResult`

### Shared vs Separate
| Aspect | Shared | Query-Only | Mutation-Only |
|--------|--------|------------|---------------|
| Status enum (`QueryStatus`) | ✅ | | |
| Base fields (data, error, requestId, timestamps) | ✅ | | |
| Cache key strategy | | serialized args | requestId/fixedCacheKey |
| Subscription tracking | | ✅ | |
| Auto-cleanup (TTL) | | ✅ | |
| Tag providing | | ✅ (`providesTags`) | |
| Tag invalidation | | | ✅ (`invalidatesTags`) |
| `condition()` dedup (skip if pending) | | ✅ | |

**Source**: `packages/toolkit/src/query/core/apiState.ts:217-377` — **Confidence: High**

---

## 5. Lifecycle Handling (pending/fulfilled/rejected)

### Thunk Creation — **SEPARATE thunks, SHARED executor**
- `queryThunk` = `createAsyncThunk('${reducerPath}/executeQuery', executeEndpoint, { getPendingMeta, condition })`
- `mutationThunk` = `createAsyncThunk('${reducerPath}/executeMutation', executeEndpoint, { getPendingMeta })`
- **Key difference**: `queryThunk` has a `condition()` function for dedup/caching logic; `mutationThunk` does NOT
- Both share `getPendingMeta` pattern (timestamps + autobatch)
- Both share `executeEndpoint` as payload creator

**Source**: `packages/toolkit/src/query/core/buildThunks.ts:907-990` — **Confidence: High**

### Reducer Handling — **SEPARATE slices, PARALLEL structure**
- `querySlice.extraReducers`: matches `queryThunk.pending/fulfilled/rejected`
  - pending: `writePendingCacheEntry()` — sets status, requestId, originalArgs, startedTimeStamp
  - fulfilled: `writeFulfilledCacheEntry()` — sets data, fulfilledTimeStamp, handles `merge()` callback
  - rejected: sets error, considers `condition()` rejection (no-op if condition-rejected)
- `mutationSlice.extraReducers`: matches `mutationThunk.pending/fulfilled/rejected`
  - pending: skips if `!arg.track`, sets requestId + status + startedTimeStamp
  - fulfilled: skips if `!arg.track`, sets data + fulfilledTimeStamp
  - rejected: skips if `!arg.track`, sets error + status rejected
- `invalidationSlice.extraReducers`: matches `queryThunk.fulfilled|rejected` to update tag→cacheKey mappings

**Source**: `packages/toolkit/src/query/core/buildSlice.ts:280-500`, `docs/rtk-query/internal/buildSlice.mdx` — **Confidence: High**

### Middleware Lifecycle — **SHARED matchers**
- `queryLifecycle` handler: creates combined pending/fulfilled/rejected matchers for both thunks
  - `isPendingThunk = isPending(queryThunk, mutationThunk)` — **single handler for both**
  - Manages `onQueryStarted` → `queryFulfilled` promise for both types
- `cacheLifecycle` handler: differentiates by thunk type for cache entry added/removed
- `invalidationByTags`: matches fulfilled/rejected for ALL thunk types, triggers selective query refetches

**Source**: `packages/toolkit/src/query/core/buildMiddleware/queryLifecycle.ts:407-438` — **Confidence: High**

### Action Matchers — **Per-endpoint, per-thunk-type**
- `buildMatchThunkActions(thunk, endpointName)` generates:
  - `matchPending`, `matchFulfilled`, `matchRejected`
- Queries get matchers bound to `queryThunk`, mutations to `mutationThunk`
- Exposed on each endpoint: `api.endpoints.foo.matchPending/matchFulfilled/matchRejected`

**Source**: `packages/toolkit/src/query/core/buildThunks.ts:1025-1073` — **Confidence: High**

---

## 6. Selector Separation

- `buildQuerySelector(endpointName)`: reads from `state[reducerPath].queries[serializedArgs]`, keyed by query args
- `buildMutationSelector()`: reads from `state[reducerPath].mutations[requestId|fixedCacheKey]`, keyed by identity
- Both use shared `withRequestFlags()` to derive `isLoading`, `isSuccess`, `isError`, `isUninitialized` booleans
- Query selector is **per-endpoint** (args → cacheKey is endpoint-specific); mutation selector is **generic** (any mutation)

**Source**: `packages/toolkit/src/query/core/buildSelectors.ts:180-350` — **Confidence: High**

---

## 7. React Hook Separation

- `buildQueryHooks(endpointName)` → `useQuery`, `useQueryState`, `useQuerySubscription`, `useLazyQuery`, `useLazyQuerySubscription`
- `buildMutationHook(endpointName)` → `useMutation`
- Completely separate implementations, no shared hook logic between query/mutation hooks
- Hooks are generated per-endpoint in the react module's `injectEndpoint`

**Source**: `packages/toolkit/src/query/react/buildHooks.ts:1921-2298` — **Confidence: High**

---

## Architectural Summary

```
┌─ createApi ──────────────────────────────────────────────────┐
│  endpoints(build) → build.query() / build.mutation()         │
│                                                              │
│  ┌─ coreModule() ─────────────────────────────────────────┐  │
│  │  buildThunks    → queryThunk, mutationThunk            │  │
│  │                   (shared executeEndpoint)              │  │
│  │  buildSlice     → querySlice | mutationSlice           │  │
│  │                   + invalidationSlice (shared)          │  │
│  │                   + subscriptionSlice (query-only)      │  │
│  │                   + configSlice (shared)                │  │
│  │  buildSelectors → buildQuerySelector | buildMutSel     │  │
│  │  buildInitiate  → buildInitiateQuery | buildInitMut    │  │
│  │  buildMiddleware→ single middleware, shared handlers    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ reactHooksModule() (optional) ────────────────────────┐  │
│  │  buildHooks → buildQueryHooks | buildMutationHook      │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Key pattern**: Core infrastructure (middleware, thunk executor, status flags, tags) is shared. State storage, selectors, initiation, and hooks are split per endpoint type. The split point is primarily in `buildSlice` (separate Redux slices) and `injectEndpoint` (type-based dispatch to separate builders).

---

## Sources
- [RTK Query source: core/buildSlice.ts](https://github.com/reduxjs/redux-toolkit/tree/main/packages/toolkit/src/query/core/buildSlice.ts) — slice separation, reducer logic
- [RTK Query source: core/buildThunks.ts](https://github.com/reduxjs/redux-toolkit/tree/main/packages/toolkit/src/query/core/buildThunks.ts) — shared executeEndpoint, thunk creation
- [RTK Query source: core/apiState.ts](https://github.com/reduxjs/redux-toolkit/tree/main/packages/toolkit/src/query/core/apiState.ts) — state shape types
- [RTK Query source: core/module.ts](https://github.com/reduxjs/redux-toolkit/tree/main/packages/toolkit/src/query/core/module.ts) — core module init, endpoint injection
- [RTK Query source: core/buildSelectors.ts](https://github.com/reduxjs/redux-toolkit/tree/main/packages/toolkit/src/query/core/buildSelectors.ts) — selector builders
- [RTK Query source: core/buildInitiate.ts](https://github.com/reduxjs/redux-toolkit/tree/main/packages/toolkit/src/query/core/buildInitiate.ts) — initiation logic
- [RTK Query source: core/buildMiddleware/](https://github.com/reduxjs/redux-toolkit/tree/main/packages/toolkit/src/query/core/buildMiddleware/) — middleware handlers
- [RTK Query source: endpointDefinitions.ts](https://github.com/reduxjs/redux-toolkit/tree/main/packages/toolkit/src/query/endpointDefinitions.ts) — definition types
- [RTK Query source: createApi.ts](https://github.com/reduxjs/redux-toolkit/tree/main/packages/toolkit/src/query/createApi.ts) — module composition
- [RTK Query internal docs: buildSlice.mdx](https://github.com/reduxjs/redux-toolkit/tree/main/docs/rtk-query/internal/buildSlice.mdx) — internal architecture overview
- [RTK Query internal docs: queryThunk.mdx](https://github.com/reduxjs/redux-toolkit/tree/main/docs/rtk-query/internal/queryThunk.mdx) — thunk lifecycle
- [RTK Query internal docs: overview.mdx](https://github.com/reduxjs/redux-toolkit/tree/main/docs/rtk-query/internal/overview.mdx) — core module overview
