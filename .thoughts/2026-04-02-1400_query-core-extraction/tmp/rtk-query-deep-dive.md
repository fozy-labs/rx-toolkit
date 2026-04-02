---
title: "External Research: RTK Query — Code Sharing Between Queries and Mutations"
date: 2026-04-02
stage: 01-research
role: rdpi-external-researcher
---

## 1. `executeEndpoint` — The Single Shared Payload Creator

RTK Query uses **one** `executeEndpoint` function as the `AsyncThunkPayloadCreator` for **all three** thunk types (query, mutation, infinite query). This is the core sharing mechanism.

**Source**: `packages/toolkit/src/query/core/buildThunks.ts` L~495–900

```ts
// Typed as a union — accepts any of the three arg types
const executeEndpoint: AsyncThunkPayloadCreator<
  ThunkResult,
  QueryThunkArg | MutationThunkArg | InfiniteQueryThunkArg<any>,
  ThunkApiMetaConfig & { state: RootState<any, string, ReducerPath> }
> = async (arg, { signal, abort, rejectWithValue, fulfillWithValue, dispatch, getState, extra }) => {
  const endpointDefinition = endpointDefinitions[arg.endpointName]
  const isQuery = arg.type === ENDPOINT_QUERY  // ← runtime branch

  const baseQueryApi = {
    signal, abort, dispatch, getState, extra,
    endpoint: arg.endpointName,
    type: arg.type,                           // 'query' | 'mutation'
    forced: isQuery ? isForcedQuery(arg, getState()) : undefined,
    queryCacheKey: isQuery ? arg.queryCacheKey : undefined,
  }

  const forceQueryFn = isQuery ? arg[forceQueryFnSymbol] : undefined
  // ... rest is shared: executeRequest, transformResponse, error handling
}
```

**Key branching points within `executeEndpoint`**:
- `baseQueryApi.forced` — only set for queries
- `baseQueryApi.queryCacheKey` — only set for queries
- `forceQueryFn` (for `upsertQueryData`) — only for queries
- Infinite query page-merging logic — checked via `isInfiniteQueryDefinition()`
- Everything else (baseQuery call, transformResponse, schema validation, error handling) is **100% shared**

**Confidence: High** — direct source code analysis.

**How thunks are created from the shared `executeEndpoint`**:

```ts
// Query thunk — reuses executeEndpoint, adds condition() and getPendingMeta()
const createQueryThunk = <ThunkArgType>() =>
  createAsyncThunk(`${reducerPath}/executeQuery`, executeEndpoint, {
    getPendingMeta({ arg }) { /* adds startedTimeStamp, direction for infinite */ },
    condition(queryThunkArg, { getState }) { /* cache dedup logic — query-only */ },
    dispatchConditionRejection: true,
  })

const queryThunk = createQueryThunk<QueryThunkArg>()
const infiniteQueryThunk = createQueryThunk<InfiniteQueryThunkArg<any>>()

// Mutation thunk — reuses the SAME executeEndpoint, simpler config
const mutationThunk = createAsyncThunk(
  `${reducerPath}/executeMutation`,
  executeEndpoint,        // ← same function!
  { getPendingMeta() { return { startedTimeStamp: Date.now() } } }
)
```

**Sharing ratio**: ~90% shared code. The only query-specific piece is `condition()` (cache dedup). Mutations don't deduplicate.

---

## 2. `onQueryStarted` — Shared Middleware Handler, Divergent Types

### Runtime: Fully Shared Handler

**Source**: `packages/toolkit/src/query/core/buildMiddleware/queryLifecycle.ts` L~424–493

```ts
export const buildQueryLifecycleHandler: InternalHandlerBuilder = ({
  api, context, queryThunk, mutationThunk,
}) => {
  // Creates matchers that match BOTH query AND mutation thunks
  const isPendingThunk = isPending(queryThunk, mutationThunk)
  const isRejectedThunk = isRejected(queryThunk, mutationThunk)
  const isFullfilledThunk = isFulfilled(queryThunk, mutationThunk)

  const handler = (action, mwApi) => {
    if (isPendingThunk(action)) {
      // Reads onQueryStarted from the SAME endpointDefinition field
      const onQueryStarted = endpointDefinition?.onQueryStarted
      if (onQueryStarted) {
        // Creates queryFulfilled Promise — identical for both
        const queryFulfilled = new Promise((resolve, reject) => { ... })

        // Only difference: how selector is constructed
        const selector = (api.endpoints[endpointName] as any).select(
          isAnyQueryDefinition(endpointDefinition)
            ? originalArgs   // queries: select by args
            : requestId      // mutations: select by requestId
        )

        const lifecycleApi = {
          ...mwApi,
          getCacheEntry: () => selector(mwApi.getState()),
          requestId, extra,
          // THIS is the only runtime difference:
          updateCachedData: isAnyQueryDefinition(endpointDefinition)
            ? (updateRecipe) => mwApi.dispatch(api.util.updateQueryData(...))
            : undefined,      // mutations don't get updateCachedData
          queryFulfilled,
        }

        onQueryStarted(originalArgs, lifecycleApi as any)
      }
    }
    // fulfilled/rejected handlers are identical for both
  }
}
```

**Confidence: High** — direct source code.

### Types: Separate but Parallel Hierarchies

**Source**: `queryLifecycle.ts` L~63–220

```
QueryLifecycleQueryExtraOptions       QueryLifecycleMutationExtraOptions
  └─ onQueryStarted(                    └─ onQueryStarted(
       arg,                                  arg,
       QueryLifecycleApi                     MutationLifecycleApi
     )                                     )

QueryLifecycleApi                      MutationLifecycleApi
  = QueryBaseLifecycleApi              = MutationBaseLifecycleApi
    + QueryLifecyclePromises             + QueryLifecyclePromises  ← SHARED!
    
QueryBaseLifecycleApi                  MutationBaseLifecycleApi
  extends LifecycleApi                   extends LifecycleApi     ← SHARED base!
  + getCacheEntry()                      + getCacheEntry()
  + updateCachedData()                   (no updateCachedData)
```

**Shared type pieces**:
- `LifecycleApi` (dispatch, getState, extra) — shared base
- `QueryLifecyclePromises` (queryFulfilled) — shared between query & mutation
- `QueryFulfilledRejectionReason` — shared

**Divergent type pieces**:
- `QueryBaseLifecycleApi` has `updateCachedData` + `getCacheEntry` returning `QueryResultSelectorResult`
- `MutationBaseLifecycleApi` has `getCacheEntry` returning `MutationResultSelectorResult`, no `updateCachedData`

**Typed helpers exported**:
```ts
export type TypedQueryOnQueryStarted<...> = QueryLifecycleQueryExtraOptions<...>['onQueryStarted']
export type TypedMutationOnQueryStarted<...> = QueryLifecycleMutationExtraOptions<...>['onQueryStarted']
```

**Confidence: High** — direct source code.

---

## 3. `onCacheEntryAdded` — Same Pattern, Same Sharing

### Runtime: Fully Shared Handler

**Source**: `packages/toolkit/src/query/core/buildMiddleware/cacheLifecycle.ts` L~184–379

```ts
export const buildCacheLifecycleHandler: InternalHandlerBuilder = ({
  api, reducerPath, context, queryThunk, mutationThunk, internalState, selectors,
}) => {
  const isQueryThunk = isAsyncThunkAction(queryThunk)
  const isMutationThunk = isAsyncThunkAction(mutationThunk)
  const isFulfilledThunk = isFulfilled(queryThunk, mutationThunk)

  const handler = (action, mwApi, stateBefore) => {
    // Query path: triggered on queryThunk.pending — checks for new cache key
    if (queryThunk.pending.match(action)) {
      checkForNewCacheKey(endpointName, cacheKey, requestId, originalArgs)
    }
    // Mutation path: triggered on mutationThunk.pending — checks mutation state
    else if (mutationThunk.pending.match(action)) {
      const state = mwApi.getState()[reducerPath].mutations[cacheKey]
      if (state) { handleNewKey(...) }
    }
    // Shared: fulfillment resolves lifecycle
    else if (isFulfilledThunk(action)) {
      resolveLifecycleEntry(cacheKey, action.payload, action.meta.baseQueryMeta)
    }
    // Shared: removal cleans up lifecycle
    else if (removeQueryResult.match(action) || removeMutationResult.match(action)) {
      removeLifecycleEntry(cacheKey)
    }
  }
}
```

The `handleNewKey` function — which creates the lifecycle promises and calls `onCacheEntryAdded` — is **100% shared**:

```ts
function handleNewKey(endpointName, originalArgs, queryCacheKey, mwApi, requestId) {
  const onCacheEntryAdded = endpointDefinition?.onCacheEntryAdded
  if (!onCacheEntryAdded) return

  // Same Promise pattern for both — cacheDataLoaded + cacheEntryRemoved
  const cacheEntryRemoved = new Promise<void>((resolve) => { ... })
  const cacheDataLoaded = Promise.race([
    new Promise((resolve) => { lifecycle.valueResolved = resolve }),
    cacheEntryRemoved.then(() => { throw neverResolvedError }),
  ])

  const lifecycleApi = {
    ...mwApi,
    getCacheEntry: () => selector(mwApi.getState()),
    requestId, extra,
    updateCachedData: isAnyQueryDefinition(endpointDefinition)
      ? (updateRecipe) => mwApi.dispatch(api.util.updateQueryData(...))
      : undefined,    // mutations: no updateCachedData
    cacheDataLoaded,
    cacheEntryRemoved,
  }

  onCacheEntryAdded(originalArgs, lifecycleApi as any)
}
```

**Confidence: High** — direct source code.

### Types: Same Parallel Pattern as onQueryStarted

```
CacheLifecycleQueryExtraOptions       CacheLifecycleMutationExtraOptions
  └─ onCacheEntryAdded(                └─ onCacheEntryAdded(
       arg,                                 arg,
       QueryCacheLifecycleApi               MutationCacheLifecycleApi
     )                                    )

QueryCacheLifecycleApi                MutationCacheLifecycleApi
  = QueryBaseLifecycleApi             = MutationBaseLifecycleApi
    + CacheLifecyclePromises            + CacheLifecyclePromises    ← SHARED!
```

Where `CacheLifecyclePromises` (cacheDataLoaded, cacheEntryRemoved) is shared. `QueryBaseLifecycleApi` adds `updateCachedData`, `MutationBaseLifecycleApi` does not.

**`CacheLifecycleInfiniteQueryExtraOptions` is literally an alias**: 
```ts
export type CacheLifecycleInfiniteQueryExtraOptions<...> = 
  CacheLifecycleQueryExtraOptions<...>
```

**Confidence: High** — direct source code.

### Key cache key difference

Queries use `queryCacheKey` (serialized from args). Mutations use `fixedCacheKey ?? requestId`. The `getCacheKey` helper handles this:

```ts
function getCacheKey(action) {
  if (isQueryThunk(action)) return action.meta.arg.queryCacheKey
  if (isMutationThunk(action)) return action.meta.arg.fixedCacheKey ?? action.meta.requestId
}
```

---

## 4. Endpoint Definition Types — How Lifecycle Hooks Are Composed

### The merging pattern

**Source**: `packages/toolkit/src/query/endpointDefinitions.ts`

```ts
// Query endpoints get lifecycle hooks via QueryExtraOptions
interface QueryExtraOptions<...>
  extends CacheLifecycleQueryExtraOptions<...>,     // onCacheEntryAdded
          QueryLifecycleQueryExtraOptions<...>,      // onQueryStarted
          CacheCollectionQueryExtraOptions { ... }   // keepUnusedDataFor

type QueryDefinition<...> = BaseEndpointDefinition<...> & QueryExtraOptions<...>

// Mutation endpoints get lifecycle hooks via MutationExtraOptions
interface MutationExtraOptions<...>
  extends CacheLifecycleMutationExtraOptions<...>,   // onCacheEntryAdded
          QueryLifecycleMutationExtraOptions<...> {   // onQueryStarted
  // mutation-specific: invalidatesTags
}

type MutationDefinition<...> = BaseEndpointDefinition<...> & MutationExtraOptions<...>
```

Both `QueryExtraOptions` and `MutationExtraOptions` extend the lifecycle types. The lifecycle types themselves reference different API interfaces (Query vs Mutation variants), giving different `getCacheEntry` return types and presence/absence of `updateCachedData`.

**Property name is the same** for both: `onQueryStarted` and `onCacheEntryAdded`. The runtime code reads them via `endpointDefinition?.onQueryStarted` without caring about the endpoint type.

**Confidence: High** — direct source code.

---

## 5. Thunk Arg Types — Divergent Shapes

```ts
// Query args — have queryCacheKey, subscribe, forceRefetch
type QueryThunkArg = QuerySubstateIdentifier & StartQueryActionCreatorOptions & {
  type: 'query'
  originalArgs: unknown
  endpointName: string
}

// Mutation args — have track, fixedCacheKey
type MutationThunkArg = {
  type: 'mutation'
  originalArgs: unknown
  endpointName: string
  track?: boolean
  fixedCacheKey?: string
}
```

At runtime, `executeEndpoint` branches on `arg.type === ENDPOINT_QUERY` to distinguish them.

---

## 6. `buildMatchThunkActions` — Fully Shared

**Source**: `buildThunks.ts` L~1042–1073

```ts
function buildMatchThunkActions<Thunk extends AsyncThunk<...>>(thunk: Thunk, endpointName: string) {
  return {
    matchPending: isAllOf(isPending(thunk), matchesEndpoint(endpointName)),
    matchFulfilled: isAllOf(isFulfilled(thunk), matchesEndpoint(endpointName)),
    matchRejected: isAllOf(isRejected(thunk), matchesEndpoint(endpointName)),
  }
}
```

Called with `queryThunk` or `mutationThunk` — the logic is identical, just different thunk instances. Both queries and mutations get `matchPending`/`matchFulfilled`/`matchRejected` matchers.

**Confidence: High**

---

## 7. `buildInitiate` — Separate Functions

**Source**: `packages/toolkit/src/query/core/buildInitiate.ts`

Unlike the middleware handlers, the initiation logic is **not shared** between queries and mutations:

- `buildInitiateAnyQuery()` — shared between query and infiniteQuery (wraps queryThunk/infiniteQueryThunk)
- `buildInitiateQuery()` — thin wrapper calling `buildInitiateAnyQuery()`
- `buildInitiateInfiniteQuery()` — thin wrapper calling `buildInitiateAnyQuery()`
- `buildInitiateMutation()` — **completely separate function** dispatching `mutationThunk`

The initiation paths differ significantly because queries have subscription management, cache dedup, and query arg serialization, while mutations have `track`/`fixedCacheKey` and no subscriptions.

**Confidence: High**

---

## 8. `buildSlice` — Separate Slices, Shared Structure

**Source**: `packages/toolkit/src/query/core/buildSlice.ts`

The Redux state is split into separate slices:
- `querySlice` — handles `queryThunk.pending/fulfilled/rejected`
- `mutationSlice` — handles `mutationThunk.pending/fulfilled/rejected`

These are **completely separate** `createSlice` calls with different state shapes, but both follow the same pattern of `extraReducers` matching their respective thunk actions.

**Confidence: High**

---

## Summary: What's Truly Shared vs Type-Branching

| Component | Shared Runtime Code | Shared Types | Branching Method |
|-----------|-------------------|--------------|------------------|
| `executeEndpoint` | ~90% shared | Union arg type | `arg.type === ENDPOINT_QUERY` |
| `onQueryStarted` handler | ~95% shared (1 handler) | Shared base + separate leaf types | `isAnyQueryDefinition()` for `updateCachedData` |
| `onCacheEntryAdded` handler | ~85% shared (`handleNewKey` is shared) | Shared base + separate leaf types | `isAnyQueryDefinition()` for `updateCachedData`; separate action matching for entry detection |
| `buildMatchThunkActions` | 100% shared | Generic over `Thunk` | Parameterized by thunk instance |
| `buildInitiate` | ~0% shared (query ≠ mutation) | Separate types | Completely separate functions |
| `buildSlice` | ~0% shared | Separate state shapes | Separate `createSlice` calls |
| Middleware infrastructure | 100% shared `InternalHandlerBuilder` pattern | Shared `BuildSubMiddlewareInput` | All handlers are registered uniformly |

**The key insight**: RTK Query shares code primarily through:
1. **A single `executeEndpoint` payload creator** used by all thunks
2. **Unified middleware handlers** that match both `queryThunk` and `mutationThunk` actions using `isPending(queryThunk, mutationThunk)` combiners
3. **Runtime `isAnyQueryDefinition()` checks** to conditionally provide `updateCachedData`
4. **Type-level parallel hierarchies** where Query/Mutation variants share base interfaces but diverge at the leaf level for `getCacheEntry` return types and `updateCachedData` presence

The _endpoint definition itself_ stores `onQueryStarted` and `onCacheEntryAdded` as **plain properties** with no runtime type discrimination — the same property name is read regardless of endpoint type. Type safety is enforced only at the TypeScript level through `QueryExtraOptions` vs `MutationExtraOptions`.

---

## Sources
- [buildThunks.ts](https://github.com/reduxjs/redux-toolkit/blob/main/packages/toolkit/src/query/core/buildThunks.ts) — `executeEndpoint`, thunk creation, `buildMatchThunkActions`
- [queryLifecycle.ts](https://github.com/reduxjs/redux-toolkit/blob/main/packages/toolkit/src/query/core/buildMiddleware/queryLifecycle.ts) — `onQueryStarted` handler + types
- [cacheLifecycle.ts](https://github.com/reduxjs/redux-toolkit/blob/main/packages/toolkit/src/query/core/buildMiddleware/cacheLifecycle.ts) — `onCacheEntryAdded` handler + types
- [buildInitiate.ts](https://github.com/reduxjs/redux-toolkit/blob/main/packages/toolkit/src/query/core/buildInitiate.ts) — initiation logic (separate for query vs mutation)
- [buildSlice.ts](https://github.com/reduxjs/redux-toolkit/blob/main/packages/toolkit/src/query/core/buildSlice.ts) — state slices
- [endpointDefinitions.ts](https://github.com/reduxjs/redux-toolkit/blob/main/packages/toolkit/src/query/endpointDefinitions.ts) — `QueryExtraOptions`, `MutationExtraOptions`, definition composition
- [module.ts](https://github.com/reduxjs/redux-toolkit/blob/main/packages/toolkit/src/query/core/module.ts) — `injectEndpoint` wiring
- [RTK Query internal docs](https://github.com/reduxjs/redux-toolkit/blob/main/docs/rtk-query/internal/overview.mdx) — architecture overview
- [createApi docs](https://github.com/reduxjs/redux-toolkit/blob/main/docs/rtk-query/api/createApi.mdx) — `onQueryStarted` / `onCacheEntryAdded` API docs
