---
title: "Resource Entity Internals — Codebase Analysis"
date: 2026-04-02
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

Resource is the primary data-fetching unit of the query module. It manages a keyed cache of `ResourceCacheEntry` instances (one per unique args), each wrapping a finite-state machine (`MachinePending → MachineSuccess | MachineError ↔ MachineRefreshing`). Reactivity is provided by the signals layer; garbage collection is driven by RxJS `share` + `timer` ref-count reset inside `CacheEntry`.

## 1. Files & Exports

| File | Key exports | LOC (approx) |
|---|---|---|
| `@/query/core/Resource/Resource.ts` | `Resource` class | ~210 |
| `@/query/core/Resource/ResourceAgent.ts` | `ResourceAgent` class | ~160 |
| `@/query/core/Resource/ResourceCacheEntry.ts` | `ResourceCacheEntry` class | ~360 |
| `@/query/core/Resource/index.ts` | barrel re-exports | 3 |

## 2. Resource class (`Resource.ts`)

- **Location**: `@/query/core/Resource/Resource.ts:20-210`
- **Implements**: `IResource<TArgs, TData>` (`@/query/types/resource.types.ts:36`)
- **Generic params**: `TArgs` (query arguments type), `TData` (response data type)

### Private fields

| Field | Type | Source line | Purpose |
|---|---|---|---|
| `_cache` | `ICacheMap<TArgs, ResourceCacheEntry>` | :21 | Args→entry cache (serialize or compare strategy) |
| `_queryFn` | `TQueryFn<TArgs, TData>` | :22 | User-supplied fetch function |
| `_compareArgsFn` | `TCompareArgsFn<TArgs>` | :23 | Args equality (default: `shallowEqual`) |
| `_onCacheEntryAdded` | `TOnCacheEntryAdded<TArgs, TData>?` | :24 | Lifecycle callback |
| `_onQueryStarted` | `TOnQueryStarted<TArgs, TData>?` | :25 | Lifecycle callback |
| `_beforeDevtoolsPush` | `TBeforeDevtoolsPushFn?` | :26 | Devtools hook |
| `_cacheLifetime` | `number` | :27 | GC timeout in ms (default `60_000`) |
| `_key` | `string?` | :28 | Optional devtools/snapshot key |
| `_keyStrategy` | `"serialize" \| "compare"` | :29 | Key resolution strategy |
| `_lastEntry$` | `Signal.state<ResourceCacheEntry \| null>` | :31-33 | Tracks last created entry (disabled signal) |
| `status$` | `Signal.state<"idle" \| "ready">` | :35-37 | Tracks whether resource has any entries |

### Public methods

| Method | Line | Description |
|---|---|---|
| `constructor(options)` | :39-60 | Stores options, creates `CacheMap` via `createCacheMap()` |
| `createAgent()` | :62-66 | Returns new `ResourceAgent` wired to `_getEntry$` and `_compareArgsFn` |
| `query(...args, doForce?)` | :68-72 | Gets-or-creates entry, calls `entry.query(doForce)` |
| `getEntry(...args)` | :74-82 | Non-reactive entry lookup; returns existing or creates (if `doInitiate`) |
| `getEntry$(...args)` | :84-91 | Reactive variant — delegates to `_getEntry$` |
| `invalidate(...args)` | :93-99 | Looks up entry, calls `entry.invalidate()` |
| `subscribe(...args)` | :101-105 | Gets-or-creates entry, subscribes to `entry.obs` (keeps it alive) |
| `resetCache()` | :109-118 | Clears cache, completes all entries, resets status to "idle" (batched) |
| `cacheValues()` | :120-122 | Iterator over all cache entries |
| `hydrateEntry(args, machine)` | :128-130 | Creates entry pre-loaded with a machine state (SSR/snapshot) |
| `hasEntry(args)` | :132-134 | `_cache.has(args)` |

### Private methods

| Method | Line | Description |
|---|---|---|
| `_getEntry$(args, doInitiate?)` | :138-149 | Reactive get: returns null when status is "idle" and not forcing |
| `_entryFactory(args, argsKey, initialMachine?)` | :151-179 | Creates `ResourceCacheEntry`, subscribes `onClean$` → `_cache.delete`, updates `_lastEntry$` and `status$` |
| `_parseQueryArgs(allArgs)` | :181-191 | Extracts `{ args, doForce }` from overloaded call |
| `_parseGetEntryArgs(allArgs)` | :193-203 | Extracts `{ args, doInitiate }` from overloaded call |

## 3. ResourceCacheEntry class (`ResourceCacheEntry.ts`)

- **Location**: `@/query/core/Resource/ResourceCacheEntry.ts:40-360`
- **Extends**: `CacheEntry<TMachineInstance<TArgs, TData>>` (`@/query/core/CacheEntry.ts`)
- **Implements**: `IResourceCacheEntry<TArgs, TData>` (`@/query/types/resource.types.ts:62`)

### Inheritance from CacheEntry (`CacheEntry.ts`)

- **Location**: `@/query/core/CacheEntry.ts:1-76`
- Wraps a `Signal.state<TState>` as `_state$`
- Exposes `obs` (RxJS Observable with `share`/`ReplaySubject(1)` and timer-based resetOnRefCountZero)
- Exposes `state$` = `signalize(obs)` (Signal derived from the Observable)
- `onClean$`: `Subject<void>` — fires on `complete()`
- GC mechanism: when all subscribers drop, RxJS `share` resets after `_cacheLifetime` ms via `timer()`, which triggers `finalize` → `complete()` → `onClean$`

### ResourceCacheEntry private fields

| Field | Type | Line | Purpose |
|---|---|---|---|
| `_args` | `TArgs` | :48 | The args for this entry |
| `_queryFn` | `TQueryFn` | :49 | Fetch function |
| `_compareArgs` | `TCompareArgsFn` | :50 | Args comparator |
| `_abortController` | `AbortController \| null` | :51 | Current inflight abort handle |
| `_inflightPromise` | `Promise<TData> \| null` | :52 | Current inflight promise (dedup) |
| `_patchState` | `TPatchState<TData> \| null` | :53 | Optimistic update tracking |
| `_onCacheEntryAdded` | callback? | :54 | Lifecycle |
| `_onQueryStarted` | callback? | :55 | Lifecycle |
| `_entryDataLoaded` | `PromiseResolver<TData> \| null` | :56 | Resolves when first data arrives |
| `_entryRemoved` | `PromiseResolver<void> \| null` | :57 | Resolves when entry is removed |
| `_queryFulfilled` | `PromiseResolver<{ data }> \| null` | :58 | Resolves/rejects per fetch |

### ResourceCacheEntry public fields

| Field | Line | Description |
|---|---|---|
| `machine$` | :42 | Alias for inherited `state$` — reactive machine read |
| `argsKey` | :43 | Serialized args key string |

### ResourceCacheEntry public methods

| Method | Line | Description |
|---|---|---|
| `constructor(options)` | :60-73 | Calls `super(initialMachine ?? MachinePending)`, sets fields, fires `_fireCacheEntryAdded`, starts `_doFetch` unless hydrated |
| `isMyArgs(args)` | :75-77 | Delegates to `_compareArgs` |
| `createPatch(patchFn)` | :79-103 | Creates optimistic patch via `Patcher.createPatch`, returns `IPatchHandle {commit, abort}` |
| `invalidate()` | :105-112 | Transitions success→refreshing, triggers `_doFetch` |
| `query(doForce?)` | :114-134 | Dedup inflight, returns cached on success, transitions state, calls `_doFetch` |
| `complete()` (override) | :136-167 | Aborts inflight, clears patch state, resolves/rejects lifecycle resolvers, calls `super.complete()` |

### ResourceCacheEntry private methods

| Method | Line | Description |
|---|---|---|
| `_fireCacheEntryAdded()` | :169-191 | Sets up `$cacheDataLoaded` / `$cacheEntryRemoved` promises, calls `onCacheEntryAdded` callback |
| `_doFetch()` | :193-290 | Core fetch: aborts previous, creates AbortController, fires `onQueryStarted`, calls `queryFn`, handles success/error transitions, resolves lifecycle promises |
| `_updateMachineData(data, patchState)` | :292-300 | Sets new machine (Success or Refreshing) preserving status |
| `_finishPatch(type, patch)` | :302-320 | Commits/aborts patch via `Patcher.finishPatch`, detects consistency violations → calls `invalidate()` |

## 4. ResourceAgent class (`ResourceAgent.ts`)

- **Location**: `@/query/core/Resource/ResourceAgent.ts:14-160`
- **Implements**: `IResourceAgent<TArgs, TData>`
- Purpose: SWR (stale-while-revalidate) observer that tracks current + previous entry

### Key fields

| Field | Type | Line | Purpose |
|---|---|---|---|
| `_getEntry$` | `(args: TArgs) => ResourceCacheEntry` | :15 | Closure from `Resource.createAgent()` |
| `_compareArgsFn` | `(a,b) => boolean` | :16 | From Resource |
| `_previous$` | `ReadableSignalFnLike<ResourceCacheEntry> \| null` | :18 | Previous entry for SWR data |
| `_tracking$` | `Signal.state<Tracking \| null>` | :20-22 | Current tracked `{args, current$}` |
| `state$` | `ComputeFn<TResourceAgentState>` | :24 | Derived reactive state (computed signal) |

### Public methods

| Method | Line | Description |
|---|---|---|
| `start(...args)` | :44-78 | SKIP → clear, same args → noop, new args → move current to previous (if success/refreshing), set new tracking |
| `compareArgs(a, b)` | :80-82 | Delegates to comparator |

### State derivation (`_deriveState$`, line 96-150)

- Reads `_tracking$()` → current entry → `machine$()`
- SWR logic: if current is pending/error and previous has data, uses previous data and reports "refreshing"
- Clears `_previous$` when current reaches success/error (original status)
- Returns `TResourceAgentState`: `{ status, data, error, args, isLoading, isInitialLoading, isRefreshing, isRefreshError, isSuccess, isError, entry }`

## 5. State Machine

- **Location**: `@/query/core/machines/`
- **States**: `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`
- All are **immutable** — transitions return new instances
- `TMachineInstance<TArgs, TData>` = union of all four

### State transitions

```
[creation] ──→ MachinePending ──success──→ MachineSuccess
                              ──error────→ MachineError
MachineSuccess ──invalidate()──→ MachineRefreshing
MachineSuccess ──query(force)──→ MachineRefreshing
MachineError   ──query()───────→ MachinePending
MachineRefreshing ──success──→ MachineSuccess (with patch resolution)
MachineRefreshing ──error────→ MachineSuccess (preserves stale data, sets lastError)
```

### MachineWithData (`MachineWithData.ts`)

- **Location**: `@/query/core/machines/MachineWithData.ts:1-50`
- Abstract base for `MachineSuccess` and `MachineRefreshing`
- Carries `args`, `data`, `patchState`
- Provides `createPatch()`, `cloneWith()` (abstract)

### Patcher (`Patcher.ts`)

- **Location**: `@/query/core/machines/Patcher.ts:1-145`
- Uses **Immer** (`produceWithPatches`, `applyPatches`, `enablePatches()`)
- `createPatch(patchFn, data)` → `{ patch: TPatch, data: TData }`
- `resolvePatches(originalData, patches[])` → reapplies pending patches on fresh server data, detects consistency violations
- `finishPatch(originalData, patches, type, patch)` → marks one patch committed/aborted, re-resolves
- `abortAllPending(originalData, patches)` → aborts all pending patches

## 6. Cache Layer

### CacheMap (`CacheMap/`)

- **Location**: `@/query/core/CacheMap/`
- Factory: `createCacheMap(options)` → selects `SerializeCacheMap` (default) or `CompareCacheMap`
- **SerializeCacheMap** (`SerializeCacheMap.ts`): `Map<string, TEntry>`, serializes args via `stableStringify` or custom `serializeArgs`, optional `WeakMap` args cache
- **CompareCacheMap** (`CompareCacheMap.ts`): `Map<TArgs, TEntry>`, uses reference identity, counter-based argsKey

### CacheEntry (`CacheEntry.ts`)

- **Location**: `@/query/core/CacheEntry.ts:1-76`
- Wraps `Signal.state<TState>` with RxJS Observable layer
- `obs`: `share({ connector: ReplaySubject(1), resetOnRefCountZero: timer(cacheLifetime) })`
- `state$`: `signalize(obs)` — converts Observable back to Signal
- GC: when refcount drops to 0, `timer(cacheLifetime)` fires → `finalize` → `complete()` → `onClean$` → parent `Resource._cache.delete(args)`

## 7. Lifecycle Hooks

### onCacheEntryAdded

- **Fired in**: `ResourceCacheEntry._fireCacheEntryAdded()` (:169-191)
- Provides `$cacheDataLoaded: Promise<TData>` and `$cacheEntryRemoved: Promise<void>`
- `$cacheDataLoaded` resolves on first successful fetch (or immediately if hydrated)
- `$cacheEntryRemoved` resolves when `complete()` is called

### onQueryStarted

- **Fired in**: `ResourceCacheEntry._doFetch()` (:218-230)
- Provides `$queryFulfilled: Promise<{ data }>` and `getCacheEntry: () => this`
- `$queryFulfilled` resolves/rejects per fetch cycle
- Rejected with "Query superseded" if a new fetch starts before previous settles

## 8. Subscriptions & Reactivity

- **Signal layer**: `Resource._lastEntry$`, `Resource.status$`, `ResourceAgent._tracking$`, `ResourceAgent.state$` are all `Signal.state` or `Signal.compute`
- **RxJS layer**: `CacheEntry.obs` is the subscription target for GC tracking
- **Consumer subscription**: `Resource.subscribe(args)` → `entry.obs.subscribe()` — keeps the entry alive (prevents GC)
- **Reactive reads**: `resource.getEntry$(args)` → calls `_getEntry$` which reads `status$()` (reactive dependency) before accessing cache
- **ResourceAgent.state$** is a `Signal.compute` that reads `_tracking$()`, then `current$()`, then `entry.machine$()` — full reactivity chain

## 9. Garbage Collection Flow

1. Consumer unsubscribes (or React component unmounts)
2. RxJS `share` refcount drops to 0
3. `resetOnRefCountZero: () => timer(cacheLifetime)` starts countdown (default 60s)
4. If no new subscriber within cacheLifetime → share resets → `finalize()` fires → `CacheEntry.complete()`
5. `complete()` fires `onClean$.next()` → subscriber in `Resource._entryFactory` calls `_cache.delete(args)`
6. Entry is removed from the CacheMap
7. If `cacheLifetime === false` → never GC'd; if `cacheLifetime <= 0` → immediate GC on unsubscribe

## 10. Creation Entry Points

- `_createResource(options)` — `@/query/api/_createResource.ts:4-8` — standalone factory
- `createApi().resource(options)` — `@/query/api/createApi.ts:94` — API-scoped factory, merges API defaults, handles snapshot hydration

## 11. Dependencies Summary

| Dependency | Used by | Purpose |
|---|---|---|
| `Signal.state`, `Signal.compute`, `signalize` | Resource, ResourceAgent, CacheEntry | Reactivity |
| `Batcher.run` | `Resource.resetCache()` | Batched signal updates |
| `rxjs` (Observable, share, ReplaySubject, finalize, timer, Subject) | CacheEntry | GC / subscription tracking |
| `createCacheMap` (SerializeCacheMap / CompareCacheMap) | Resource | Args→entry mapping |
| `stableStringify` | SerializeCacheMap | Default args serialization |
| `shallowEqual` | Resource (default compareArg) | Args equality |
| `Patcher` (Immer) | ResourceCacheEntry, MachineWithData | Optimistic updates |
| `MachinePending/Success/Error/Refreshing` | ResourceCacheEntry | State machine instances |
| `PromiseResolver` | ResourceCacheEntry | Lifecycle promise management |
| `SKIP_TOKEN` | ResourceAgent | Skip signal for agent start |

## Code References

- `@/query/core/Resource/Resource.ts:20` — Resource class declaration
- `@/query/core/Resource/Resource.ts:39-60` — constructor, stores options, creates CacheMap
- `@/query/core/Resource/Resource.ts:62-66` — `createAgent()` factory
- `@/query/core/Resource/Resource.ts:109-118` — `resetCache()`, batched cleanup
- `@/query/core/Resource/Resource.ts:151-179` — `_entryFactory()`, wires onClean$ → cache.delete
- `@/query/core/Resource/ResourceCacheEntry.ts:40` — ResourceCacheEntry class declaration
- `@/query/core/Resource/ResourceCacheEntry.ts:60-73` — constructor, auto-fetches on creation
- `@/query/core/Resource/ResourceCacheEntry.ts:79-103` — `createPatch()`, optimistic updates
- `@/query/core/Resource/ResourceCacheEntry.ts:105-112` — `invalidate()`, success→refreshing
- `@/query/core/Resource/ResourceCacheEntry.ts:114-134` — `query()`, dedup + state transitions
- `@/query/core/Resource/ResourceCacheEntry.ts:136-167` — `complete()`, abort + cleanup
- `@/query/core/Resource/ResourceCacheEntry.ts:193-290` — `_doFetch()`, core fetch flow
- `@/query/core/Resource/ResourceCacheEntry.ts:302-320` — `_finishPatch()`, consistency detection
- `@/query/core/Resource/ResourceAgent.ts:14` — ResourceAgent class declaration
- `@/query/core/Resource/ResourceAgent.ts:44-78` — `start()`, SWR args tracking
- `@/query/core/Resource/ResourceAgent.ts:96-150` — `_deriveState$()`, SWR state derivation
- `@/query/core/CacheEntry.ts:12` — CacheEntry class, Signal+RxJS wrapper
- `@/query/core/CacheEntry.ts:33-44` — `obs` with share/timer GC
- `@/query/core/CacheEntry.ts:63-70` — `complete()`, fires onClean$
- `@/query/core/CacheMap/createCacheMap.ts:10-13` — factory selecting serialize/compare strategy
- `@/query/core/CacheMap/SerializeCacheMap.ts:8` — string-keyed Map implementation
- `@/query/core/CacheMap/CompareCacheMap.ts:7` — reference-identity Map implementation
- `@/query/core/machines/MachinePending.ts:10` — pending state class
- `@/query/core/machines/MachineSuccess.ts:12` — success state class
- `@/query/core/machines/MachineError.ts:9` — error state class
- `@/query/core/machines/MachineRefreshing.ts:12` — refreshing state class
- `@/query/core/machines/MachineWithData.ts:10` — abstract base for data-carrying states
- `@/query/core/machines/Patcher.ts:18` — Immer-based optimistic update engine
- `@/query/types/resource.types.ts:20` — `TResourceOptions` type
- `@/query/types/resource.types.ts:36` — `IResource` interface
- `@/query/types/resource.types.ts:62` — `IResourceCacheEntry` interface
- `@/query/api/_createResource.ts:4-8` — standalone factory
- `@/query/api/createApi.ts:94` — API-scoped factory + snapshot hydration
