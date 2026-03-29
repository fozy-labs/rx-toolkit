---
title: "query-v2 Module — Codebase Analysis"
date: 2026-03-28
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

The `query-v2` module implements an async data-fetching and caching system built around immutable machine states, signal-based reactivity, and a plugin architecture. The module consists of ~25 source files organized across `api/`, `core/`, `lib/`, `react/`, `plugins/`, and `types/` directories. Analysis reveals that `fireQueryStarted` and `resolveQueryFulfilled` are never called from production code, the `ResourceV2CacheEntry` constructor unconditionally fires `_doFetch()` even when hydrated from a snapshot, and the SWR logic in `ResourceV2Agent._deriveState$` overrides `status` to `"refreshing"` when previous data exists on error — masking `isError`.

## Findings

### 1. Entry Point: `createApi`

- **Location**: `@/query-v2/api/createApi.ts:23-149`
- **What it does**: Factory function that creates an API instance. Accepts `initialSnapshot`, `maxSnapshotDataAge`, `plugins`, `keyPrefix`, `keyStrategy`, `serializeArgs`, `compareArg`, `cacheLifetime`, `doCacheArgs`. Returns `{ createResourceV2, resetAll, getSnapshot, [API_INTERNALS] }`.
- **Snapshot handling** (lines 37-56): Validates snapshot `version` and `keyPrefix` at creation time. Deep-clones the `resources` record.
- **Resource creation** (lines 64-130): `apiCreateResourceV2` merges API-level defaults with resource-level options, creates `new ResourceV2(mergedOptions)`, then hydrates from `_savedSnapshot` if the resource key matches.
- **Hydration + age checking** (lines 92-109): After `hydrateSnapshot(...)` is called, it checks `effectiveMaxAge = resourceOptions.maxSnapshotDataAge ?? maxSnapshotDataAge`. If set, iterates entries and calls `entry.invalidate()` on entries where `now - machine.updatedAt > effectiveMaxAge`. This only invalidates entries that are **already in "success"** state and older than the max age.
- **Key dependencies**: `ResourceV2`, `getSnapshot`, `hydrateSnapshot` from `@/query-v2/core/Snapshot`.

### 2. Resource Creation: `_createResourceV2`

- **Location**: `@/query-v2/api/_createResourceV2.ts:1-9`
- **What it does**: Thin wrapper around `new ResourceV2(options)`. Not used by `createApi` — `createApi` constructs `ResourceV2` directly.
- **Key dependencies**: `ResourceV2`.

### 3. Core Resource: `ResourceV2`

- **Location**: `@/query-v2/core/resource/ResourceV2.ts:21-180`
- **What it does**: Manages a cache map of `ResourceV2CacheEntry` instances. Provides `createAgent()`, `query()`, `getEntry()`, `getEntry$()`, `invalidate()`, `subscribe()`, `resetCache()`, `hydrateEntry()`, `cacheEntries()`.
- **Entry factory** (lines 139-163): `_entryFactory(args)` creates a new `ResourceV2CacheEntry`, subscribes to `onClean$` for cache removal, fires `fireCacheEntryAdded`, updates `status$` and `_lastEntry$`.
- **`hydrateEntry`** (line 119-121): Calls `_cache.getOrCreate(args)` then `entry.set(machine)`. Since `getOrCreate` triggers `_entryFactory` which constructs a `ResourceV2CacheEntry`, the constructor fires `_doFetch()` **before** `entry.set(machine)` is called. The `set()` call updates the signal state but the fetch is already in flight.
- **`resetCache`** (lines 101-112): Clears cache, calls `entry.complete()` on all entries (which aborts inflight fetches via `ResourceV2CacheEntry.complete()`), calls `_lifecycleHooks.clearAll()`, resets `_lastEntry$` and `status$`.
- **Key dependencies**: `createCacheMap`, `LifecycleHooks`, `ResourceV2Agent`, `ResourceV2CacheEntry`, `Signal`, `Batcher`.
- **Patterns**: Constructor stores options, uses `_entryFactory` as lazy factory for cache entries. `onDataLoaded` callback passed to entry delegates to `_lifecycleHooks.resolveDataLoaded`.

### 4. ResourceV2Agent

- **Location**: `@/query-v2/core/resource/ResourceV2Agent.ts:1-147`
- **What it does**: SWR observer over a resource. Tracks current and previous entries. Provides computed `state$` signal.
- **SWR logic in `_deriveState$`** (lines 103-136):
  - Reads `currentMachine` from the current entry.
  - If `status === "pending"` or `status === "error"`, and `previous$` exists with `success`/`refreshing` status, it overrides: `data = prevMachine.data` and `status = "refreshing"`.
  - `isError` is computed as `status === "error"` (line 129).
  - **Bug #3 observation**: When current entry is in `error` state but `previous$` has `success` data, `status` is overridden to `"refreshing"`, so `isError` becomes `false`. Meanwhile, `error` is read from `currentMachine.error` (line 120), which is non-null for `MachineError`. Result: `error` is non-null but `isError` is `false`.
  - Previous is cleared (line 126) when current reaches `success` or `error`. But the SWR override on lines 111-116 happens **before** this clearing, so on the first read with error+previous, the override applies.
- **Key dependencies**: `SKIP`, `Signal`, `ResourceV2CacheEntry`.

### 5. ResourceV2CacheEntry

- **Location**: `@/query-v2/core/resource/ResourceV2CacheEntry.ts:1-211`
- **What it does**: Extends `CacheEntry<TMachineInstance>`. Manages query lifecycle, abort, patches, consistency violation.
- **Constructor** (lines 47-57): Calls `super(new MachinePending(args), options)` then unconditionally calls `this._doFetch().catch(() => {})`. This means **every new entry always fires a fetch immediately**.
- **`_doFetch`** (lines 138-190): Aborts previous inflight, creates `AbortController`, calls `this._queryFn(args, { abortSignal })`. On success: sets `MachineSuccess`, calls `_onDataLoaded`. On error in refreshing state: reverts to `MachineSuccess` with stale data. On error in non-refreshing state: sets `MachineError`.
- **`_doFetch` does NOT call `fireQueryStarted` or `resolveQueryFulfilled`** — these lifecycle methods exist in `LifecycleHooks` but are never invoked from `ResourceV2CacheEntry`.
- **`complete()`** (lines 127-135): Aborts inflight fetch, clears `_inflightPromise` and `_patchState`, calls `super.complete()` which fires `onClean$`.
- **`createPatch`** (lines 60-84): Creates optimistic patch via `Patcher.createPatch`. Stores into `_patchState`.
- **`_finishPatch`** (lines 230-252): Calls `Patcher.finishPatch`, detects consistency violation. Violation detection (lines 243-248): checks `resolution.patchState?.isConsistencyViolation === true` OR when `resolution.patchState === null && type === "aborted" && prevPatches.some(p => p !== patch)`. On violation, calls `this.invalidate()`.
- **Key dependencies**: `CacheEntry`, `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`, `Patcher`.

### 6. Machine States

- **Location**: `@/query-v2/core/machines/`
- **`Machine.ts`** (`@/query-v2/core/machines/Machine.ts:1-31`): Static factory with `pending()` and `fromSnapshot()` methods. `fromSnapshot` creates instances based on `status` field.
- **`MachinePending.ts`** (`@/query-v2/core/machines/MachinePending.ts:1-37`): `status="pending"`, `data=null`, `error=null`, `updatedAt=null`.
- **`MachineSuccess.ts`** (`@/query-v2/core/machines/MachineSuccess.ts:1-49`): Extends `MachineWithData`. `status="success"`, `error=null`, `updatedAt: number`.
- **`MachineError.ts`** (`@/query-v2/core/machines/MachineError.ts:1-35`): `status="error"`, `data=null`, `error: unknown`, `updatedAt=null`. Does NOT have `patchState`.
- **`MachineRefreshing.ts`** (`@/query-v2/core/machines/MachineRefreshing.ts:1-56`): Extends `MachineWithData`. `status="refreshing"`, `error=null`, `updatedAt: number`. `errorHappened()` returns `MachineSuccess` (preserves stale data).
- **`MachineWithData.ts`** (`@/query-v2/core/machines/MachineWithData.ts:1-89`): Abstract base for `MachineSuccess` and `MachineRefreshing`. Provides `createPatch()`, `finishPatch()`, `abortAllPendingPatches()`.
- **SWR representation**: When a refreshing fetch errors, `MachineRefreshing.errorHappened()` returns `MachineSuccess` with the stale data. This is the machine-level SWR. The agent-level SWR uses `_previous$` to carry data across arg changes.
- **`isError`/`error` propagation**: `MachineError` has `error: unknown` (non-null) and `data=null`. `MachineSuccess` has `error=null`. `MachineRefreshing` has `error=null`. There is no machine state that has both `data` and `error` simultaneously. However, `ResourceV2CacheEntry._doFetch` error handler (line 177-183) when in refreshing state, transitions to `MachineSuccess` — the error is **discarded** at the machine level.

### 7. Patcher

- **Location**: `@/query-v2/core/machines/Patcher.ts:1-139`
- **What it does**: Static utility class for Immer-based optimistic patching. Uses `produceWithPatches` and `applyPatches`.
- **`createPatch`** (lines 21-34): Takes a `patchFn` and current data, produces forward+inverse patches via Immer.
- **`resolvePatches`** (lines 42-105): Re-applies patches on top of original data. Committed patches before first pending are baked into base. Aborted patches after pending get inverse applied. On `catch` at any step: sets `isConsistencyViolation = true` locally but then returns `{ data: currentData, patchState: null }` — **the `isConsistencyViolation` local variable is never included in the return value when the catch path is taken** (line 95-99 returns `patchState: null`, not `patchState: { isConsistencyViolation: true, ... }`).
- **`finishPatch`** (lines 111-121): Updates target patch status, delegates to `resolvePatches`.
- **`abortAllPending`** (lines 126-130): Marks all pending as aborted, delegates to `resolvePatches`.
- **Consistency violation path**: In `resolvePatches`, when `applyPatches` throws (line 94), the function returns `{ data: currentData, patchState: null }`. The `isConsistencyViolation` flag at line 57 is set to `true` but never reaches the return. In `ResourceV2CacheEntry._finishPatch` (lines 243-248), the detection checks `resolution.patchState?.isConsistencyViolation === true` (never true when patchState is null from catch) OR `resolution.patchState === null && type === "aborted" && prevPatches.some(p => p !== patch)`. So the catch-path violation is only detected by the second condition, and only when aborting with other patches present. If `type === "committed"` and `applyPatches` throws, the violation is **not detected** by `_finishPatch`.

### 8. Snapshot

- **Location**: `@/query-v2/core/Snapshot.ts:1-90`
- **`getSnapshot`** (lines 12-47): Iterates all resources, captures only `MachineSuccess` entries with serializable keys. Returns `TApiSnapshot`.
- **`hydrateSnapshot`** (lines 55-90): Iterates snapshot resources/entries, calls `Machine.fromSnapshot()` then `resource.hydrateEntry(args, machine)`.
- **Age checking**: Not in `Snapshot.ts`. Age checking is only in `createApi.ts` lines 99-107, applied **after** hydration.
- **Snapshot + queryFn issue (Bug #1)**: `hydrateSnapshot` → `resource.hydrateEntry(args, machine)` → `this._cache.getOrCreate(args)` → triggers `_entryFactory(args)` → creates `ResourceV2CacheEntry` → constructor calls `_doFetch()`. Then `entry.set(machine)` is called, but `_doFetch` is already in flight. Even if the age check later determines the entry is valid (not stale), the fetch was already initiated. For entries within `maxSnapshotDataAge`, the fetch should not have been triggered at all.

### 9. LifecycleHooks

- **Location**: `@/query-v2/core/LifecycleHooks.ts:1-113`
- **What it does**: Manages `onCacheEntryAdded` and `onQueryStarted` callback lifecycles. Creates `PromiseResolver` instances for `$cacheDataLoaded`, `$cacheEntryRemoved`, `$queryFulfilled`.
- **`fireCacheEntryAdded`** (lines 42-55): Called from `ResourceV2._entryFactory`. Creates `dataLoaded` and `entryRemoved` resolvers, invokes user callback with `{ $cacheDataLoaded, $cacheEntryRemoved }`.
- **`fireQueryStarted`** (lines 57-72): Creates `$queryFulfilled` resolver, invokes user callback. **Never called from any production code**. Only called in unit tests (`LifecycleHooks.test.ts`).
- **`resolveDataLoaded`** (lines 75-80): Called from `ResourceV2CacheEntry` via `onDataLoaded` callback. Resolves `$cacheDataLoaded` promise.
- **`fireCacheEntryRemoved`** (lines 83-89): Called from `ResourceV2._entryFactory` via `entry.onClean$.subscribe(...)`.
- **`resolveQueryFulfilled`** (lines 92-103): Resolves or rejects `$queryFulfilled`. **Never called from any production code**. Only in tests.
- **`clearAll`** (lines 106-113): Rejects all `dataLoaded` with `Error("Cache cleared")`, resolves all `entryRemoved`. Rejects all `queryFulfilled` with `Error("Cache cleared")`.
- **Bug #5 observation**: The interaction between `resetCache` and `$cacheDataLoaded` has a subtle ordering issue. `resetCache` in `ResourceV2` (line 101-112) first calls `entry.complete()` for each entry, then calls `_lifecycleHooks.clearAll()`. `entry.complete()` fires `onClean$`, which triggers `fireCacheEntryRemoved`, and that deletes the entry's resolvers from `_entryResolvers` (line 87). By the time `clearAll()` runs, the resolvers are already gone from the map — so `clearAll`'s `dataLoaded.reject(new Error("Cache cleared"))` calls apply only to entries that were **not** cleaned up via `onClean$`. In practice, if all entries were properly cleaned via `complete()` → `onClean$` → `fireCacheEntryRemoved`, then `clearAll` operates on an empty map and does nothing. This means: for entries where data was never loaded (so `$cacheDataLoaded` was never resolved), the promise is **never rejected** either, and **will hang indefinitely**. For entries where data was already loaded, `$cacheDataLoaded` was already resolved — no hang, but also no cleanup notification.

### 10. CacheEntry (Base)

- **Location**: `@/query-v2/core/CacheEntry.ts:1-67`
- **What it does**: RxJS-backed reactive container wrapping `Signal.state<TState>`. Provides `peek()`, `set()`, `complete()`. `onClean$` is a `Subject<void>` that fires on `complete()`. The `obs` is a shared `Observable` with `ReplaySubject(1)` connector and `cacheLifetime`-based reset-on-refcount-zero.
- **Key dependencies**: `rxjs` (Observable, ReplaySubject, Subject, share, timer, finalize), `Signal`, `signalize`.

### 11. CacheMap

- **Location**: `@/query-v2/core/CacheMap/`
- **`createCacheMap.ts`**: Factory selecting `CompareCacheMap` or `SerializeCacheMap` based on `keyStrategy`.
- **`SerializeCacheMap.ts`**: Uses string keys (via `serializeArgs`). Standard `Map<string, TEntry>` backing.
- **`CompareCacheMap.ts`**: Uses comparison function. Backs entries in an array, linear scans for lookup.

### 12. Plugins: ReactHooksPlugin

- **Location**: `@/query-v2/plugins/ReactHooksPlugin.ts:1-22`
- **What it does**: Implements `IPlugin`. `install()` is empty. `augmentResource()` returns `{ useResourceV2Agent }` that delegates to `@/query-v2/react/useResourceV2Agent`.
- **Key dependencies**: `useResourceV2Agent`.

### 13. React Hook: useResourceV2Agent

- **Location**: `@/query-v2/react/useResourceV2Agent.ts:1-15`
- **What it does**: Creates an agent via `useConstant(() => resource.createAgent())`, calls `agent.start(...args)` in `React.useEffect`, returns `useSignal(agent.state$)`.
- **Key dependencies**: `useConstant` from `@/common/react`, `useSignal` from `@/signals`.

---

## Documentation Structure

### Existing docs (`@/docs/query-v2/`)
- **`README.md`** (~370 lines): Comprehensive. Covers quick start, architecture, createApi, ResourceV2, machine states, cache entries, agents, SKIP, cache strategies, GC, lifecycle hooks (onCacheEntryAdded, onQueryStarted), plugins, typing, API reference. Written in Russian.
- **`optimistic-updates.md`** (~150 lines): Guide covering createPatch, IPatchHandle, rollback logic, consistency violations, onQueryStarted usage for patches. Russian.
- **`ssr.md`** (~135 lines): Server-side rendering guide. getSnapshot, hydrateSnapshot, initialSnapshot, maxSnapshotDataAge, Next.js and Vite SSR examples, limitations. Russian.
- **`devtools.md`** (~100 lines): Devtools integration. English. References `devtools` option on resource, debug mode with `devtoolsDebug: true`.

### Documented API surface vs. actual exports
- **Documented in README**: `createApi`, `createResourceV2`, `Machine`, `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`, `MachineWithData`, `SKIP`, `useResourceV2Agent`, `ReactHooksPlugin`, `CURRENT_SNAPSHOT_VERSION`, `Patcher`.
- **Exported but not in README's API reference**: `stableStringify` (from `@/query-v2/lib`).
- **README references `MachineIdle`** in the API reference section, but `MachineIdle` is **not exported** from `@/query-v2/index.ts` and does not exist as a class. The machine states are `pending`, `success`, `error`, `refreshing` — there is no `idle` machine class.
- **`devtools.md` references `devtools` and `devtoolsDebug` options** but these are not present in `TResourceV2Options` in the types directory, nor in `ResourceV2` constructor. The devtools doc appears outdated or describes planned functionality.

### Demo app

- **Location**: `@/apps/demos/src/examples/query-v2/`
- **Files**: `index.ts`, `simple-resource.tsx`, `optimistic-patches.tsx`, `ssr-snapshot.tsx`
- No dedicated examples for: lifecycle hooks (onCacheEntryAdded, onQueryStarted), SKIP token, cache strategies (compare), GC behavior, error states, multi-agent scenarios.

---

## Tests

### Test files inventory

| Test File | Location |
|-----------|----------|
| `createApi.test.ts` | `@/query-v2/api/__tests__/createApi.test.ts` |
| `ResourceV2.test.ts` | `@/query-v2/core/resource/__tests__/ResourceV2.test.ts` |
| `ResourceV2Agent.test.ts` | `@/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts` |
| `ResourceV2CacheEntry.test.ts` | `@/query-v2/core/resource/__tests__/ResourceV2CacheEntry.test.ts` |
| `Machine.test.ts` | `@/query-v2/core/machines/__tests__/Machine.test.ts` |
| `Patcher.test.ts` | `@/query-v2/core/machines/__tests__/Patcher.test.ts` |
| `LifecycleHooks.test.ts` | `@/query-v2/core/__tests__/LifecycleHooks.test.ts` |
| `Snapshot.test.ts` | `@/query-v2/core/__tests__/Snapshot.test.ts` |
| `CacheEntry.test.ts` | `@/query-v2/core/__tests__/CacheEntry.test.ts` |
| `CacheMap.test.ts` | `@/query-v2/core/CacheMap/__tests__/CacheMap.test.ts` |
| `useResourceV2Agent.test.ts` | `@/query-v2/react/__tests__/useResourceV2Agent.test.ts` |
| `ReactHooksPlugin.test.ts` | `@/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts` |
| `ReactHooksPlugin.type.test.ts` | `@/query-v2/plugins/__tests__/ReactHooksPlugin.type.test.ts` |
| `stableStringify.test.ts` | `@/query-v2/lib/__tests__/stableStringify.test.ts` |
| `SKIP_TOKEN.test.ts` | `@/query-v2/lib/__tests__/SKIP_TOKEN.test.ts` |
| `type-level.test.ts` | `@/query-v2/types/__tests__/type-level.test.ts` |
| `query-flow.test.ts` | `@/query-v2/__tests__/integration/query-flow.test.ts` |
| `plugins-and-snapshot.test.ts` | `@/query-v2/__tests__/integration/plugins-and-snapshot.test.ts` |
| `optimistic-updates.test.ts` | `@/query-v2/__tests__/integration/optimistic-updates.test.ts` |
| `reset-and-multi-agent.test.ts` | `@/query-v2/__tests__/integration/reset-and-multi-agent.test.ts` |
| `gc-lifecycle.test.ts` | `@/query-v2/__tests__/integration/gc-lifecycle.test.ts` |
| `memory-leaks.test.ts` | `@/query-v2/__tests__/integration/memory-leaks.test.ts` |
| `edge-cases.test.ts` | `@/query-v2/__tests__/edge-cases.test.ts` |

### Coverage gaps relevant to reported bugs

- **Bug #1 (snapshot + queryFn)**: `plugins-and-snapshot.test.ts` and `Snapshot.test.ts` exist but the specific scenario — hydrating a valid snapshot and checking whether `queryFn` is called — needs verification. The code path shows the bug is structural (constructor always fetches).
- **Bug #2 (onQueryStarted never called)**: `LifecycleHooks.test.ts` tests `fireQueryStarted` in isolation. No integration test verifies that `fireQueryStarted` is called during an actual query lifecycle via `ResourceV2CacheEntry._doFetch`.
- **Bug #3 (SWR masks isError)**: `ResourceV2Agent.test.ts` exists. Whether it covers the scenario of error + previous data with SWR override needs verification.
- **Bug #4 (consistency violation lost)**: `Patcher.test.ts` and `optimistic-updates.test.ts` exist. The `catch` path in `Patcher.resolvePatches` returning `patchState: null` without `isConsistencyViolation` needs test coverage.
- **Bug #5 ($cacheDataLoaded hangs on resetCache)**: `LifecycleHooks.test.ts` tests `clearAll`. `reset-and-multi-agent.test.ts` exists. The specific race condition — `fireCacheEntryRemoved` deleting resolvers before `clearAll` can reject them — needs verification.

---

## Code References

- `@/query-v2/api/createApi.ts:23` — `createApi` function definition
- `@/query-v2/api/createApi.ts:37-56` — `initialSnapshot` validation and deep clone
- `@/query-v2/api/createApi.ts:92-109` — snapshot hydration and `maxSnapshotDataAge` check
- `@/query-v2/api/createApi.ts:99` — `effectiveMaxAge` resolution (resource-level ?? api-level)
- `@/query-v2/api/createApi.ts:103` — age comparison: `now - machine.updatedAt > effectiveMaxAge`
- `@/query-v2/api/createApi.ts:104` — stale entries invalidated via `entry.invalidate()`
- `@/query-v2/core/resource/ResourceV2.ts:119-121` — `hydrateEntry`: `getOrCreate` then `set`
- `@/query-v2/core/resource/ResourceV2.ts:139-163` — `_entryFactory`: creates entry, fires lifecycle hooks
- `@/query-v2/core/resource/ResourceV2.ts:101-112` — `resetCache`: complete entries, clearAll hooks
- `@/query-v2/core/resource/ResourceV2CacheEntry.ts:47-57` — constructor: `super(MachinePending)` then `_doFetch()`
- `@/query-v2/core/resource/ResourceV2CacheEntry.ts:138-190` — `_doFetch`: full fetch lifecycle, no `fireQueryStarted`/`resolveQueryFulfilled` calls
- `@/query-v2/core/resource/ResourceV2CacheEntry.ts:177-183` — error in refreshing: transitions to `MachineSuccess` (error discarded)
- `@/query-v2/core/resource/ResourceV2CacheEntry.ts:127-135` — `complete()`: aborts inflight, fires `onClean$`
- `@/query-v2/core/resource/ResourceV2CacheEntry.ts:230-252` — `_finishPatch`: consistency violation detection
- `@/query-v2/core/resource/ResourceV2Agent.ts:103-136` — `_deriveState$`: SWR logic, status override on error+previous
- `@/query-v2/core/resource/ResourceV2Agent.ts:111-116` — error with previous data → status overridden to `"refreshing"`
- `@/query-v2/core/resource/ResourceV2Agent.ts:120` — `error: currentMachine.error ?? null` (preserves error object)
- `@/query-v2/core/resource/ResourceV2Agent.ts:129` — `isError: status === "error"` (false when status was overridden)
- `@/query-v2/core/machines/Patcher.ts:42-105` — `resolvePatches`: patch resolution with consistency violation
- `@/query-v2/core/machines/Patcher.ts:57` — `isConsistencyViolation = false` local variable
- `@/query-v2/core/machines/Patcher.ts:94-99` — catch path: returns `{ data: currentData, patchState: null }` — `isConsistencyViolation` lost
- `@/query-v2/core/LifecycleHooks.ts:42-55` — `fireCacheEntryAdded`: creates resolvers, calls user callback
- `@/query-v2/core/LifecycleHooks.ts:56-72` — `fireQueryStarted`: defined but never called from production code
- `@/query-v2/core/LifecycleHooks.ts:75-80` — `resolveDataLoaded`: resolves `$cacheDataLoaded`
- `@/query-v2/core/LifecycleHooks.ts:83-89` — `fireCacheEntryRemoved`: resolves `$cacheEntryRemoved`, **deletes from `_entryResolvers`**
- `@/query-v2/core/LifecycleHooks.ts:106-113` — `clearAll`: rejects remaining dataLoaded, resolves entryRemoved
- `@/query-v2/core/Snapshot.ts:55-90` — `hydrateSnapshot`: calls `resource.hydrateEntry`
- `@/query-v2/core/machines/MachineError.ts:1-35` — error state: `data=null`, `error: unknown`
- `@/query-v2/core/machines/MachineRefreshing.ts:46-48` — `errorHappened` returns `MachineSuccess` (error discarded at machine level)
- `@/query-v2/react/useResourceV2Agent.ts:1-15` — React hook: `useConstant`, `useEffect` for start, `useSignal`
- `@/query-v2/plugins/ReactHooksPlugin.ts:1-22` — plugin: augments with `useResourceV2Agent`
- `@/common/utils/PromiseResolver.ts:1-17` — simple deferred promise wrapper
- `@/docs/query-v2/README.md:348` — API reference lists `MachineIdle` which does not exist
- `@/apps/demos/src/examples/query-v2/` — 3 demos: simple-resource, optimistic-patches, ssr-snapshot
