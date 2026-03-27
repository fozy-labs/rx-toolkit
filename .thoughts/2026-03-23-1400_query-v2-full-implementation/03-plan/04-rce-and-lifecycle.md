---
title: "Phase 4: Core — ResourceV2CacheEntry & LifecycleHooks"
date: 2026-03-25
stage: 03-plan
role: rdpi-planner
---

## Goal

Implement ResourceV2CacheEntry (extends CacheEntry with query lifecycle, abort, patches, consistency violations) and LifecycleHooks (onCacheEntryAdded, onQueryStarted callbacks). These form the per-entry behavioral layer that ResourceV2 orchestrates.

## Dependencies

- **Requires**: Phase 2 (machines, Patcher), Phase 3 (CacheEntry, CacheMap)
- **Blocks**: Phase 5

## Execution

Sequential. LifecycleHooks can be developed in parallel with ResourceV2CacheEntry after shared prerequisites are met, but RCE may need LifecycleHooks for `onQueryStarted` integration.

## Tasks

### Task 4.1: Create test helpers for query-v2

- **File**: `src/query-v2/__tests__/helpers/controllable-promise.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Create shared test utility for controlling async query resolution in tests.
- **Details**:
  - `createControllablePromise<T>()` → `{promise, resolve, reject}` — lets tests control when queries complete
  - `createControllableObservable<T>()` → `{observable$, next, complete, error}` — lets tests control RxJS streams
  - Used by all tests from this phase onward
  - Follow controllable-promise pattern documented in design
  - [ref: ../02-design/06-testcases.md#test-tools]

---

- **File**: `src/query-v2/__tests__/helpers/index.ts`
- **Action**: Create
- **Description**: Barrel export for test helpers.

### Task 4.2: Create ResourceV2CacheEntry

- **File**: `src/query-v2/core/Resource/ResourceV2CacheEntry.ts`
- **Action**: Create
- **Complexity**: High
- **Description**: Implement `ResourceV2CacheEntry<TArgs, TData>` — extends `CacheEntry` with full query-lifecycle management.
- **Details**:
  - **Extends** `CacheEntry<TMachineInstance<TArgs, TData>>` (class inheritance — ADR-4)
  - **Constructor** receives `args: TArgs`, `queryFn: TQueryFn`, `options` (lifecycle hooks, etc.)
  - **Private fields**: `_patchState: TPatchState<TData> | null`, `_args: TArgs`, `_queryFn: TQueryFn<TArgs, TData>`, `_abortController: AbortController | null`, `_inflightPromise: Promise<TData> | null`
  - **Public interface** (matching `IResourceV2CacheEntry<TArgs, TData>`):
    - **`machine$`** — `ReadableSignalFnLike<TMachineInstance<TArgs, TData>>` signal property; reactive alias for inherited `state$()`. Call as `machine$()` for reactive read.
    - **`isMyArgs(args: TArgs): boolean`** — checks if this entry matches the given args (used by ResourceV2 `getEntry$` binding optimization)
    - **`createPatch(patchFn: (draft: TData) => void): IPatchHandle | null`** — delegates to current machine's `createPatch` (only if Success/Refreshing); manages private `_patchState`, updates signal. Returns null if no data available.
    - **`invalidate(): void`** — transitions success → refreshing, then calls `query()` internally (forces refetch)
    - **`query(doForce?: boolean): Promise<TData>`** — triggers fetch via `queryFn(this._args, { abortSignal })` (RCE knows its own args):
      - If Idle → transition to Pending, call queryFn
      - If Success/Error → transition to Refreshing (SWR — ADR-3), call queryFn
      - On success → transition to Success (with Patcher.resolvePatches for Refreshing)
      - On error → transition to Error
      - Auto-dedup: if already Pending/Refreshing with same args, return existing `_inflightPromise`
  - **Internal abort management**: `_abortController` — new query aborts previous, entry disposal aborts current
  - **Signal updates**: all transitions write to inherited `set(newMachine)`
  - [ref: ../02-design/03-model.md#§7.3, ../02-design/02-dataflow.md#initial-fetch, SWR, abort, retry]

### Task 4.3: Create LifecycleHooks

- **File**: `src/query-v2/core/LifecycleHooks.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Implement `LifecycleHooks<TArgs, TData>` — manages `onCacheEntryAdded` and `onQueryStarted` callback lifecycles with promise-based tools.
- **Details**:
  - **Constructor** receives `onCacheEntryAdded?: TOnCacheEntryAdded<TArgs, TData>`, `onQueryStarted?: TOnQueryStarted<TArgs, TData>`
  - **Private field**: `_pendingResolvers: Map<TArgs, { dataLoaded: PromiseResolver<TData>; entryRemoved: PromiseResolver<void> }>`
  - **Six methods** matching design §9.1:
    - **`fireCacheEntryAdded(args: TArgs, entry: IResourceV2CacheEntry<TArgs, TData>): void`** — called when a new cache entry is created. Creates `$cacheDataLoaded` and `$cacheEntryRemoved` promise resolvers, invokes `onCacheEntryAdded` callback with `ICacheEntryAddedTools<TData>` (`{ $cacheDataLoaded, $cacheEntryRemoved }`)
    - **`fireQueryStarted(args: TArgs, entry: IResourceV2CacheEntry<TArgs, TData>): void`** — called when a query starts. Creates `$queryFulfilled` promise resolver, invokes `onQueryStarted` callback with `IQueryStartedTools<TArgs, TData>` (`{ $queryFulfilled, getCacheEntry: () => entry }`)
    - **`resolveDataLoaded(args: TArgs, data: TData): void`** — called when data is first loaded (MachineSuccess). Resolves `$cacheDataLoaded` for the entry's args
    - **`fireCacheEntryRemoved(args: TArgs): void`** — called by GC or `resetCache()`. Resolves `$cacheEntryRemoved` for the entry's args
    - **`resolveQueryFulfilled(args: TArgs, result: { data: TData } | { error: unknown }): void`** — called when a query completes. Resolves or rejects `$queryFulfilled`
    - **`clearAll(): void`** — cleans up all pending resolvers. Used by `resetCache()` to prevent stale promise leaks
  - Callbacks are registered via `IResourceV2Options.onCacheEntryAdded` and `onQueryStarted`
  - Error handling: callback errors are caught and logged, not propagated to query flow
  - [ref: ../02-design/03-model.md#§9, §9.1]

### Task 4.4: Create ResourceV2CacheEntry tests

- **File**: `src/query-v2/core/Resource/__tests__/ResourceV2CacheEntry.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test all ResourceV2CacheEntry lifecycle behaviors.
- **Details**:
  - RCE01: `entry.machine$` is a signal property aliasing CacheEntry.state$(); `entry.machine$()` reads current state
  - RCE02: `entry.peek()` delegates to underlying CacheEntry.peek()
  - RCE03: `entry.isMyArgs(args)` returns true for matching args
  - RCE04: `entry.isMyArgs(args)` returns false for different args
  - RCE05: `entry.createPatch(fn)` returns IPatchHandle when data exists
  - RCE06: `entry.createPatch(fn)` returns null when no data
  - RCE07: Patch commit/abort lifecycle through entry handle
  - RCE08: `entry.invalidate()` transitions success → refreshing and triggers refetch
  - RCE09: `entry.invalidate()` on non-success entry: no-op
  - RCE10: `entry.query()` initiates fetch for this entry's args
  - RCE11: `entry.query()` deduplicates with in-flight requests
  - RCE12: `entry.query(true)` forces re-fetch
  - RCE13: `entry.createPatch()` sets `_patchState` with originalData and isConsistencyViolation=false
  - RCE14: Consistency violation sets `_patchState.isConsistencyViolation = true` then auto-invalidates
  - RCE15: `entry.complete()` is terminal: aborts patches → idle → onClean$ → completed (ADR-14)
  - Use `createControllableObservable` from test helpers
  - Use `cacheLifetime: false` to prevent GC interference
  - [ref: ../02-design/06-testcases.md#RCE01–RCE15]

### Task 4.5: Create LifecycleHooks tests

- **File**: `src/query-v2/core/__tests__/LifecycleHooks.test.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Test lifecycle hook invocation and error handling.
- **Details**:
  - LH01: `fireCacheEntryAdded(args, getCacheEntry)` invokes callback
  - LH02: `$cacheDataLoaded` resolves on first success
  - LH03: `$cacheEntryRemoved` resolves on GC/complete
  - LH04: `$cacheDataLoaded` rejects if entry removed before any success
  - LH05: `fireQueryStarted(args, getCacheEntry)` invokes callback
  - LH06: `$queryFulfilled` resolves on query success
  - LH07: `$queryFulfilled` rejects on query error
  - LH08: `clearAll()` cleans up all pending resolvers
  - LH09: Multiple callbacks — all invoked in order
  - [ref: ../02-design/06-testcases.md#LH01–LH09]

## Verification

- [ ] `npm run ts-check` passes
- [ ] `npx vitest run src/query-v2/core/Resource/__tests__/ResourceV2CacheEntry.test.ts` — RCE01–RCE15 pass
- [ ] `npx vitest run src/query-v2/core/__tests__/LifecycleHooks.test.ts` — LH01–LH09 pass
- [ ] ResourceV2CacheEntry extends CacheEntry via class inheritance (not composition)
- [ ] Abort is always called on entry disposal / new query
- [ ] No imports from api/, react/, plugins/ layers
