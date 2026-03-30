---
title: "Phase 2: Area B — LifecycleHooks Elimination + Lifecycle Tests"
date: 2026-03-30
stage: 03-plan
role: rdpi-planner
---

## Goal

Eliminate the shared `LifecycleHooks` class by moving lifecycle resolver state (`_entryDataLoaded`, `_entryRemoved`, `_queryFulfilled`) to per-entry ownership within `ResourceV2CacheEntry`. Update `ResourceV2` to pass callbacks directly instead of routing through closures to a shared instance. Delete `LifecycleHooks.ts` and its test file. Write new per-entry lifecycle tests. This phase delivers problem #5 (cross-entry interference, void-args collision, silent promise overwrite).

## Dependencies

- **Requires**: Phase 1 (ResourceV2.ts and ResourceV2CacheEntry.ts were modified — factory signature, argsKey field, cacheValues)
- **Blocks**: Phase 3 (Integration Tests)

## Execution

Sequential — must follow Phase 1 (shared files). Must complete before Phase 3.

## Tasks

### Task 2.1: Add lifecycle resolver state to ResourceV2CacheEntry

- **File**: `src/query-v2/core/resource/ResourceV2CacheEntry.ts`
- **Action**: Modify
- **Description**: Transform `ResourceV2CacheEntry` from a class that delegates lifecycle to external closures into a class that owns its own lifecycle resolver state [ref: ../02-design/03-model.md §3.3, §4.1–§4.7; ADR-5]:

  **Interface changes** (`IResourceV2CacheEntryOptions`, ~lines 15–24):
  - Remove: `onDataLoaded?: (args: TArgs, data: TData) => void`
  - Remove: `onQueryStarted?: (args: TArgs, entry: IResourceV2CacheEntry<TArgs, TData>) => void`
  - Remove: `onQueryFulfilled?: (args: TArgs, result: { data: TData } | { error: unknown }) => void`
  - Add: `onCacheEntryAdded?: TOnCacheEntryAdded<TArgs, TData>`
  - Add: `onQueryStarted?: TOnQueryStarted<TArgs, TData>`
  - Add imports for `TOnCacheEntryAdded`, `TOnQueryStarted`, `ICacheEntryAddedTools`, `IQueryStartedTools` from `@/query-v2/types`
  - Add import for `PromiseResolver` from `@/common/utils/PromiseResolver`

  **Field changes** (class body):
  - Remove: `_onDataLoaded`, `_onQueryStarted` (old closure type), `_onQueryFulfilled` (~lines 48–50)
  - Add: `_onCacheEntryAdded: TOnCacheEntryAdded<TArgs, TData> | undefined`
  - Add: `_onQueryStarted: TOnQueryStarted<TArgs, TData> | undefined`
  - Add: `_entryDataLoaded: PromiseResolver<TData> | null = null`
  - Add: `_entryRemoved: PromiseResolver<void> | null = null`
  - Add: `_queryFulfilled: PromiseResolver<{ data: TData }> | null = null`

  **Constructor changes** (~lines 52–62):
  - Replace assignments: `this._onCacheEntryAdded = options.onCacheEntryAdded`, `this._onQueryStarted = options.onQueryStarted`
  - Add call to `this._fireCacheEntryAdded()` before the `if (!options.initialMachine)` check

  **New method** `_fireCacheEntryAdded()` [ref: ../02-design/03-model.md §4.3]:
  - Creates `_entryDataLoaded` and `_entryRemoved` PromiseResolvers
  - Builds `ICacheEntryAddedTools` with `$cacheDataLoaded` and `$cacheEntryRemoved` promises
  - Invokes `this._onCacheEntryAdded(this._args, tools)` in try/catch (callback errors caught)
  - **Hydration check** (R9 mitigation): After callback, checks `this.peek().status === "success"` — if true, immediately resolves `_entryDataLoaded` with `machine.data` and nulls it [ref: ../02-design/09-corrections.md]

  **Updated `_doFetch()`** [ref: ../02-design/03-model.md §4.4]:
  - Before creating new `_queryFulfilled`: reject any existing `_queryFulfilled` with `new Error("Query superseded")` and null it (INV-LH3 — prevents silent promise leak on refetch)
  - If `_onQueryStarted` defined: create `_queryFulfilled = new PromiseResolver`, build `IQueryStartedTools` with `$queryFulfilled` and `getCacheEntry: () => this`, invoke callback in try/catch
  - Remove calls to old closures: `this._onQueryStarted?.(this._args, this)` → replaced by above
  - Success handler: resolve `_entryDataLoaded` (first time only — null after resolve), resolve `_queryFulfilled` [ref: ../02-design/03-model.md §4.6]
  - Error handler: reject `_queryFulfilled` only, do NOT reject `_entryDataLoaded` (stays pending for retry) [ref: ../02-design/03-model.md §4.7]
  - Remove calls to old closures: `this._onDataLoaded?.(...)`, `this._onQueryFulfilled?.(...)` → replaced by resolver operations

  **Updated `complete()`** [ref: ../02-design/03-model.md §4.5]:
  - Add lifecycle cleanup before `super.complete()`:
    - `_entryDataLoaded`: reject with "Cache entry removed before data loaded", null
    - `_entryRemoved`: resolve, null
    - `_queryFulfilled`: reject with "Cache entry removed", null
  - This is the universal safety net per R3 (INV-LH4)

- **Details**:
  - Total new fields: 5 (3 resolvers + 2 callbacks). Total removed fields: 3 (old closures). Net: +2 fields.
  - All resolver fields follow nullable pattern: non-null means pending, null means settled or unused. This makes state inspection trivial and prevents double-resolution.
  - `_fireCacheEntryAdded` runs in constructor (side effect) — matches current behavior where factory called `LifecycleHooks.fireCacheEntryAdded` immediately after entry creation.

### Task 2.2: Remove LifecycleHooks from ResourceV2

- **File**: `src/query-v2/core/resource/ResourceV2.ts`
- **Action**: Modify
- **Description**: Remove all `LifecycleHooks` integration from `ResourceV2` [ref: ../02-design/03-model.md §5.1, §5.5; ADR-5]:

  1. Remove import: `import { LifecycleHooks } from "@/query-v2/core/LifecycleHooks"` (~line 5)
  2. Remove field: `private _lifecycleHooks` (~line 26)
  3. Add fields: `private _onCacheEntryAdded: TOnCacheEntryAdded<TArgs, TData> | undefined` and `private _onQueryStarted: TOnQueryStarted<TArgs, TData> | undefined`
  4. Add imports for `TOnCacheEntryAdded`, `TOnQueryStarted` from `@/query-v2/types`
  5. Constructor: Remove `this._lifecycleHooks = new LifecycleHooks<TArgs, TData>(options.onCacheEntryAdded, options.onQueryStarted)` → Replace with `this._onCacheEntryAdded = options.onCacheEntryAdded` and `this._onQueryStarted = options.onQueryStarted`
  6. `_entryFactory` method (~line 152+): Replace lifecycle closure options with direct callback references:
     - Remove: `onDataLoaded: (a, data) => this._lifecycleHooks.resolveDataLoaded(a, data)`
     - Remove: `onQueryStarted: (a, entry) => this._lifecycleHooks.fireQueryStarted(a, entry)`
     - Remove: `onQueryFulfilled: (a, result) => this._lifecycleHooks.resolveQueryFulfilled(a, result)`
     - Add: `onCacheEntryAdded: this._onCacheEntryAdded`
     - Add: `onQueryStarted: this._onQueryStarted`
  7. `_entryFactory`: Remove `this._lifecycleHooks.fireCacheEntryAdded(args, entry)` call (~line 173) — entry constructor now handles this internally via `_fireCacheEntryAdded()`
  8. `onClean$` subscription in `_entryFactory` (~line 168): Remove `this._lifecycleHooks.fireCacheEntryRemoved(args)` — entry `complete()` now handles resolver cleanup internally
  9. `resetCache()` (~line 112): Remove `this._lifecycleHooks.clearAll()` — each `entry.complete()` in the iteration loop handles its own resolver cleanup [ref: ../02-design/02-dataflow.md §2.2]

- **Details**:
  - After this change, `ResourceV2` has no `_lifecycleHooks` field and no `LifecycleHooks` import. The class is simplified.
  - `onClean$` subscription still calls `this._cache.delete(args)` — only the lifecycle hook call is removed.
  - Plugin system is unaffected — confirmed orthogonal [ref: ../02-design/01-architecture.md §5.6].

### Task 2.3: Delete LifecycleHooks class

- **File**: `src/query-v2/core/LifecycleHooks.ts`
- **Action**: Delete
- **Description**: Delete the entire file (113 lines). Class is fully absorbed by `ResourceV2CacheEntry` [ref: ../02-design/03-model.md §3.1; ADR-5].

### Task 2.4: Remove LifecycleHooks export from core index

- **File**: `src/query-v2/core/index.ts`
- **Action**: Modify
- **Description**: Remove `export { LifecycleHooks } from "./LifecycleHooks"` (~line 23). The class no longer exists after Task 2.3.

### Task 2.5: Delete old LifecycleHooks tests

- **File**: `src/query-v2/core/__tests__/LifecycleHooks.test.ts`
- **Action**: Delete
- **Description**: Delete the entire test file. Tests LH01–LH09b test the `LifecycleHooks` class which is deleted. They are replaced by per-entry lifecycle tests in Task 2.6 [ref: ../02-design/06-testcases.md; R10].

### Task 2.6: Write per-entry lifecycle tests (LH10–LH33)

- **File**: `src/query-v2/core/resource/__tests__/ResourceV2CacheEntry.test.ts`
- **Action**: Modify (add new describe/it blocks)
- **Description**: Implement all lifecycle test cases from the test strategy [ref: ../02-design/06-testcases.md §LifecycleHooks-unit, §LifecycleHooks-hydration]:

  **Per-entry lifecycle** (LH10–LH26):
  - LH10: `onCacheEntryAdded` fires in constructor with `$cacheDataLoaded` + `$cacheEntryRemoved` tools
  - LH11: `$cacheDataLoaded` resolves on first successful fetch
  - LH12: `$cacheDataLoaded` resolves only once (one-shot)
  - LH13: `$cacheEntryRemoved` resolves on `complete()`
  - LH14: `$cacheDataLoaded` rejects on `complete()` if still unresolved
  - LH15: `onQueryStarted` fires in `_doFetch` with `$queryFulfilled` + `getCacheEntry` tools
  - LH16: `$queryFulfilled` resolves with `{data}` on success
  - LH17: `$queryFulfilled` rejects on error
  - LH18: Refetch rejects old `$queryFulfilled` before creating new one (INV-LH3)
  - LH19: `getCacheEntry()` returns the entry itself
  - LH20: Two concurrent entries have independent `$queryFulfilled` (critical for problem #5)
  - LH21: `void`-args resource lifecycle works without Map key collision
  - LH22: Callback error in `onCacheEntryAdded` is caught, entry still created
  - LH23: Callback error in `onQueryStarted` is caught, fetch proceeds
  - LH24: `complete()` settles ALL pending resolvers (INV-LH4, R3 safety net)
  - LH25: No `onCacheEntryAdded` → no resolvers, no error
  - LH26: No `onQueryStarted` → no `$queryFulfilled`, fetch proceeds

  **Hydration** (LH30–LH33):
  - LH30: Hydrated entry (`initialMachine: MachineSuccess`) → `$cacheDataLoaded` resolves immediately (R9)
  - LH31: Hydrated entry → `_doFetch` NOT called
  - LH32: Hydrated entry → `$cacheEntryRemoved` works on `complete()`
  - LH33: Hydrated entry invalidated → lifecycle hooks fire on subsequent fetch

  **Edge cases** [ref: ../02-design/06-testcases.md §Edge Cases]:
  - `complete()` called twice — idempotent (extends LH24)
  - Refetch 3 times rapidly — each old `$queryFulfilled` rejected (extends LH18)
  - `complete()` during inflight fetch — abort + resolver cleanup (extends LH24)

- **Details**:
  - Tests create `ResourceV2CacheEntry` directly with mock `queryFn` and lifecycle callbacks.
  - LH20 is the **critical** test validating problem #5 fix: two entries, both fetching, resolving one does not affect the other.
  - LH30 validates the hydration fix from 09-corrections.md (R9 mitigation).

### Task 2.7: Update ResourceV2 tests for lifecycle changes

- **File**: `src/query-v2/core/resource/__tests__/ResourceV2.test.ts`
- **Action**: Modify
- **Description**: Update existing ResourceV2 tests that reference lifecycle behavior:
  - Tests that mock/spy on `LifecycleHooks` methods need to be rewritten to verify lifecycle through entry behavior
  - `resetCache` test should verify all entry resolvers are settled (no `clearAll()`)
  - Entry creation tests may need updated options shape (no `onDataLoaded`/`onQueryFulfilled`)

## Verification

- [ ] `npm run ts-check` passes (no compilation errors after LifecycleHooks deletion)
- [ ] No remaining imports of `LifecycleHooks` in `src/query-v2/` (grep verification)
- [ ] No remaining `_lifecycleHooks` references in `ResourceV2.ts`
- [ ] All new lifecycle tests (LH10–LH33) pass
- [ ] LH20 confirms concurrent entries have independent `$queryFulfilled` (problem #5 fix)
- [ ] LH30 confirms hydrated entry `$cacheDataLoaded` resolves immediately (R9)
- [ ] LH18 confirms refetch rejects old `$queryFulfilled` (no promise leak)
- [ ] LH24 confirms `complete()` settles all resolvers (R3 safety net)
- [ ] All existing ResourceV2 tests pass (updated for new lifecycle model)
- [ ] `vitest` full suite passes
