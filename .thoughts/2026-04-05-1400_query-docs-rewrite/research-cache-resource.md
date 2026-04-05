---
title: "Query Cache & Resource System — Codebase Analysis"
date: 2026-04-05
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

The query module implements a reactive caching layer built on RxJS + Signals. `CacheEntry` is the base reactive container; `CacheMap` provides key-based storage with two strategies (serialize / compare); `Resource` orchestrates cache entries with fetch lifecycle; `ResourceAgent` adds SWR (stale-while-revalidate) cross-entry observation; `Snapshot` handles serialization/hydration of success states.

## Findings

### 1. CacheEntry

- **Location**: `@/query/core/CacheEntry.ts:11-74`
- **Fields**:
  - `_state$: SignalFn<TState>` — underlying Signal.state
  - `_isCompleted: boolean` — prevents writes after completion
  - `_cacheLifetime: number | false` — controls `resetOnRefCountZero` timer (default 60s)
  - `onClean$: Subject<void>` — fires once on `complete()`
  - `obs: Observable<TState>` — RxJS bridge via `share({ connector: ReplaySubject(1), resetOnRefCountZero })` 
  - `state$` — Signal wrapper over `obs` via `signalize()`
- **Lifecycle**:
  1. Constructor creates Signal.state, pipes through `finalize → share(ReplaySubject)`
  2. `set(state)` updates signal (no-op when completed)
  3. `complete()` fires `onClean$`, marks `_isCompleted = true`
  4. `finalize()` in the `obs` pipe auto-calls `complete()` when all subscribers drop
- **Subscription / GC model**:
  - `share({ resetOnRefCountZero })` governs cache lifetime after last unsub
  - If `cacheLifetime = false` → never resets (permanent cache)
  - If `cacheLifetime <= 0` → immediate reset
  - If `cacheLifetime > 0` → `timer(lifetime)` delay before reset
  - On reset, `finalize` triggers → `complete()` → `onClean$` → entry removed from CacheMap

### 2. CacheMap

- **Location**: `@/query/core/CacheMap/`
- **Factory**: `createCacheMap()` at `@/query/core/CacheMap/createCacheMap.ts:11-13` — selects impl by `strategy`
- **Interface** (`ICacheMap<TArgs, TEntry>` at `@/query/types/cache.types.ts:30-39`):
  - `get`, `create`, `getOrCreate`, `delete`, `has`, `clear`, `size`, `values()`
- **SerializeCacheMap** (`@/query/core/CacheMap/SerializeCacheMap.ts:8-76`):
  - Backed by `Map<string, TEntry>`
  - Args → string key via `serializeArgs` (default: `stableStringify`)
  - Optional `doCacheArgs: boolean` enables `WeakMap<object, string>` to cache serialized keys
  - Default strategy for resources
- **CompareCacheMap** (`@/query/core/CacheMap/CompareCacheMap.ts:7-60`):
  - Backed by `Map<TArgs, TEntry>` — reference identity lookup
  - Uses `_counter` for argsKey generation (or custom `devtoolsKey`)
  - Used when `compareArg` is explicitly provided in resource options
- **Eviction / retention**:
  - CacheMap itself has **no eviction logic** — it is a passive container
  - Eviction is driven by `CacheEntry.onClean$` subscription: when entry completes, Resource's `_entryFactory` handler calls `this._cache.delete(args)` (`@/query/core/resource/Resource.ts:152-154`)
  - `clear()` exists for bulk removal (used by `resetCache()`)

### 3. Resource

- **Location**: `@/query/core/resource/Resource.ts:20-176`
- **Creation**: Constructor accepts `TResourceOptions` — `queryFn`, `compareArg`, `cacheLifetime`, `serializeArgs`, lifecycle hooks, devtools config
- **Strategy selection** (`@/query/core/resource/Resource.ts:52`): if `compareArg` provided → `"compare"`, else `"serialize"`
- **Key methods**:
  - `query(...args, doForce?)` → `_cache.getOrCreate(args)` → `entry.query(doForce)` → returns `Promise<TData>`
  - `getEntry(...args)` — non-reactive cache lookup, null if not found; `getEntry(...args, true)` forces creation
  - `getEntry$(...args)` — reactive variant, reads `status$` signal, returns null when `status$ === "idle"` and no `doInitiate`
  - `invalidate(...args)` — finds existing entry, calls `entry.invalidate()`
  - `subscribe(...args)` — creates entry and subscribes to `obs` (keeps entry alive)
  - `resetCache()` — clears all entries via `Batcher.run`, completes each, resets `status$` to `"idle"`
  - `hydrateEntry(args, machine)` — creates entry from pre-built machine (snapshot hydration)
  - `cacheValues()` — iterator over all current entries
- **Entry factory** (`@/query/core/resource/Resource.ts:137-160`):
  - Creates `ResourceCacheEntry` with args, queryFn, lifecycle hooks, devtools config
  - Subscribes to `entry.onClean$` → deletes entry from cache on completion
  - Sets `status$` to `"ready"` on first entry creation
  - Tracks `_lastEntry$` signal

### 4. ResourceAgent

- **Location**: `@/query/core/resource/ResourceAgent.ts:13-147`
- **Purpose**: SWR observer that tracks a single active args and derives combined state. Created per-consumer via `resource.createAgent()`.
- **State tracking**:
  - `_tracking$: Signal.state<{ args, current$ } | null>` — current observation
  - `_previous$: ReadableSignalFnLike | null` — previous entry for SWR data fallback
  - `state$: ComputeFn<TResourceAgentState>` — derived reactive state signal
- **`start(...args)`** (`@/query/core/resource/ResourceAgent.ts:49-83`):
  - `SKIP` token → clears tracking entirely (idle state)
  - Same args (via `compareArgs`) → no-op
  - New args → moves current to `_previous$` (only if current has success/refreshing data), creates new `current$` via `Signal.compute(() => getEntry$(newArgs))`
- **SWR logic** in `_deriveState$()` (`@/query/core/resource/ResourceAgent.ts:100-147`):
  - If current is `pending` or `error` AND `_previous$` has success/refreshing data → uses previous data, status becomes `"refreshing"`
  - Clears `_previous$` once current resolves to success or error (using `originalStatus`, not SWR-overridden)
  - Derives boolean flags: `isLoading`, `isInitialLoading`, `isRefreshing`, `isRefreshError`, `isSuccess`, `isError`
  - Exposes `entry` (current ResourceCacheEntry) on state for consumer access

### 5. ResourceCacheEntry

- **Location**: `@/query/core/resource/ResourceCacheEntry.ts:33-262`
- **Extends**: `CacheEntry<TMachineInstance<TArgs, TData>>` — inherits `obs`, `state$`, `onClean$`, `peek()`, `set()`, `complete()`
- **Aliases**: `machine$` = `this.state$` (semantic alias for reactive machine read)
- **Additional fields**:
  - `_args`, `_queryFn`, `_compareArgs` — per-entry query config
  - `_abortController` / `_inflightPromise` — tracks active fetch
  - `_patchState: TPatchState<TData> | null` — optimistic patches state
  - `_entryDataLoaded`, `_entryRemoved`, `_queryFulfilled` — `PromiseResolver` instances for lifecycle hooks
- **Constructor** (`@/query/core/resource/ResourceCacheEntry.ts:58-73`):
  - Starts with `initialMachine ?? MachinePending`
  - Fires `_fireCacheEntryAdded()` immediately
  - Auto-fetches (`_doFetch()`) unless `initialMachine` is provided (hydration case)
- **`query(doForce?)`** (`@/query/core/resource/ResourceCacheEntry.ts:107-131`):
  - Dedup: returns `_inflightPromise` if exists and not forced
  - Cached data: returns `Promise.resolve(data)` for success when not forced
  - Transitions: success→refreshing, error→pending; then calls `_doFetch()`
- **`invalidate()`** (`@/query/core/resource/ResourceCacheEntry.ts:100-106`):
  - Only works in `"success"` state → transitions to `MachineRefreshing` → fetches
- **`_doFetch()`** (`@/query/core/resource/ResourceCacheEntry.ts:155-234`):
  - Aborts previous controller, creates new `AbortController`
  - Fires `onQueryStarted` lifecycle with `$queryFulfilled` promise
  - Calls `_queryFn(args, { abortSignal })`
  - On success: stale check → resolves patches if refreshing with patchState → sets `MachineSuccess` → resolves lifecycle promises
  - On error: stale check → if refreshing, sets `MachineSuccess` with `lastError` (preserves stale data) → else sets `MachineError`
- **Optimistic patches** (`createPatch`, `_finishPatch`):
  - `createPatch(patchFn)` (`@/query/core/resource/ResourceCacheEntry.ts:81-99`): only on success/refreshing, uses `Patcher.createPatch`, stacks patches in `_patchState`, returns `{ commit, abort }` handle
  - `_finishPatch()` (`@/query/core/resource/ResourceCacheEntry.ts:242-262`): resolves via `Patcher.finishPatch`, detects consistency violations → auto-`invalidate()` on violation
- **`complete()` override** (`@/query/core/resource/ResourceCacheEntry.ts:133-153`):
  - Aborts inflight fetch, clears promise/patchState
  - Rejects `_entryDataLoaded`, resolves `_entryRemoved`, rejects `_queryFulfilled`
  - Calls `super.complete()`

### 6. Snapshot

- **Location**: `@/query/core/Snapshot.ts:1-93`
- **Version**: `CURRENT_SNAPSHOT_VERSION = 1` (`@/query/types/snapshot.types.ts:2`)
- **`getSnapshot(resources, keyPrefix?)`** (`@/query/core/Snapshot.ts:12-56`):
  - Iterates all resources, throws for `"compare"` strategy (non-serializable keys)
  - Collects only `MachineSuccess` entries: `{ status, args, data, updatedAt }`
  - Returns `TApiSnapshot { version, keyPrefix, timestamp, resources }`
- **`hydrateSnapshot(resources, snapshot)`** (`@/query/core/Snapshot.ts:63-93`):
  - Version mismatch → throws
  - Iterates snapshot resources, matches to existing Resource instances
  - Creates `Machine.fromSnapshot()` → calls `resource.hydrateEntry(args, machine)`
  - Skips malformed entries with `console.warn`
- **Types** (`@/query/types/snapshot.types.ts`):
  - `TResourceSnapshotSlice { status: "success", args, data, updatedAt }`
  - `TResourceSnapshot { entries: Record<string, TResourceSnapshotSlice> }`
  - `TApiSnapshot { version, keyPrefix, timestamp, resources }`

### 7. Lifecycle Hooks

- **Types**: `@/query/types/lifecycle.types.ts:1-28`
- **`onCacheEntryAdded(args, tools)`**:
  - Fired in `ResourceCacheEntry` constructor via `_fireCacheEntryAdded()` (`@/query/core/resource/ResourceCacheEntry.ts:155-175`)
  - Tools: `$cacheDataLoaded: Promise<TData>` — resolves on first `MachineSuccess`; `$cacheEntryRemoved: Promise<void>` — resolves when `complete()` is called
  - If entry starts with data (hydration), `$cacheDataLoaded` resolves immediately
  - Callback errors are silently caught
- **`onQueryStarted(args, tools)`**:
  - Fired at the start of every `_doFetch()` call (`@/query/core/resource/ResourceCacheEntry.ts:186-197`)
  - Tools: `$queryFulfilled: Promise<{ data }>` — resolves/rejects with fetch result; `getCacheEntry()` — returns current entry for optimistic updates
  - Previous `_queryFulfilled` is rejected with "Query superseded" before creating new one
  - Callback errors are silently caught

## Code References

- `@/query/core/CacheEntry.ts:11-74` — CacheEntry class (base reactive container)
- `@/query/core/CacheEntry.ts:33-43` — `obs` pipe with share/ReplaySubject/resetOnRefCountZero
- `@/query/core/CacheEntry.ts:63-71` — `_getResetOnRefCountZero()` (cache lifetime → timer)
- `@/query/core/CacheMap/createCacheMap.ts:11-13` — factory selecting serialize vs compare
- `@/query/core/CacheMap/SerializeCacheMap.ts:8-76` — string-keyed Map impl
- `@/query/core/CacheMap/CompareCacheMap.ts:7-60` — reference-keyed Map impl
- `@/query/core/resource/Resource.ts:20-176` — Resource class
- `@/query/core/resource/Resource.ts:55-62` — CacheMap creation in constructor
- `@/query/core/resource/Resource.ts:137-160` — `_entryFactory` with onClean$ subscription
- `@/query/core/resource/Resource.ts:105-116` — `resetCache()` with Batcher
- `@/query/core/resource/ResourceAgent.ts:13-147` — ResourceAgent (SWR observer)
- `@/query/core/resource/ResourceAgent.ts:49-83` — `start()` with previous$ tracking
- `@/query/core/resource/ResourceAgent.ts:100-147` — `_deriveState$()` SWR derivation
- `@/query/core/resource/ResourceCacheEntry.ts:33-262` — ResourceCacheEntry class
- `@/query/core/resource/ResourceCacheEntry.ts:58-73` — constructor (auto-fetch, lifecycle fire)
- `@/query/core/resource/ResourceCacheEntry.ts:81-99` — `createPatch()` optimistic updates
- `@/query/core/resource/ResourceCacheEntry.ts:155-234` — `_doFetch()` full fetch lifecycle
- `@/query/core/resource/ResourceCacheEntry.ts:242-262` — `_finishPatch()` consistency violation
- `@/query/core/Snapshot.ts:12-56` — `getSnapshot()` serialization
- `@/query/core/Snapshot.ts:63-93` — `hydrateSnapshot()` deserialization
- `@/query/types/cache.types.ts:4-17` — `ICacheEntry` interface
- `@/query/types/cache.types.ts:30-39` — `ICacheMap` interface
- `@/query/types/resource.types.ts:1-70` — resource types (options, IResource, IResourceCacheEntry)
- `@/query/types/agent.types.ts:1-46` — agent state type + IResourceAgent interface
- `@/query/types/snapshot.types.ts:1-21` — snapshot types (version, slice, full snapshot)
- `@/query/types/lifecycle.types.ts:1-28` — lifecycle hook types (onCacheEntryAdded, onQueryStarted)
