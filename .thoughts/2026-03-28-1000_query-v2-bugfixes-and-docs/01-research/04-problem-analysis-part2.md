---
title: "Problem Analysis: Patcher Consistency Violation Lost & $cacheDataLoaded Hang on resetCache"
date: 2026-03-29
stage: 01-research
role: rdpi-problem-analyst
---

## Bug #4: Consistency Violation on Commit Is Lost in Patcher

### Reported Problem

When a patch is committed and `applyPatches` throws (structural incompatibility between patches), the consistency violation is silently swallowed — it is neither propagated through the return value nor detected by the caller.

### Expected vs Actual

- **Expected**: When `Patcher.resolvePatches` encounters an `applyPatches` failure during commit processing, it should signal a consistency violation so that `ResourceV2CacheEntry._finishPatch` can detect it and auto-invalidate.
- **Actual**: The `isConsistencyViolation` local variable in `resolvePatches` is set to `true` inside the catch block (line 87 of `Patcher.ts`), but the catch block immediately returns `{ data: currentData, patchState: null }` (lines 89–91). The `isConsistencyViolation` flag exists only as a local variable and is **never included** in this early return. It only appears in the normal return path at line 107 (`patchState: { ..., isConsistencyViolation }`), which is unreachable after the catch.

### Failure Path

1. User creates two patches (P1, P2) that modify overlapping or structurally dependent data.
2. Server returns fresh data (e.g., during a refetch while patches are pending).
3. `ResourceV2CacheEntry._doFetch` success handler (line 172) calls `Patcher.resolvePatches(freshData, this._patchState.patches)`.
4. Inside `resolvePatches`, iteration reaches a committed patch whose `applyPatches` call throws because the fresh server data has a different structure than when the patch was originally computed.
5. The catch block at line 86–91 sets `isConsistencyViolation = true` locally, then returns `{ data: currentData, patchState: null }`.
6. The returned `patchState` is `null`, and `isConsistencyViolation` is not part of the return value.
7. Back in `_finishPatch` (lines 243–248 of `ResourceV2CacheEntry.ts`), the violation detection has two conditions:
   - `resolution.patchState?.isConsistencyViolation === true` → **false** (patchState is null)
   - `resolution.patchState === null && type === "aborted" && prevPatches.some(p => p !== patch)` → **false when type is "committed"**
8. Neither condition triggers. `invalidate()` is never called. The entry remains with stale/incorrect data.

Additionally, there is a second scenario in `_doFetch` success handler (line 172): when `Patcher.resolvePatches` is called during a fetch resolution (not via `_finishPatch`), there is **no consistency violation check at all** — the result is used directly to set the machine state.

### Root Location

- **Primary**: `Patcher.resolvePatches` catch block at [Patcher.ts](src/query-v2/core/machines/Patcher.ts#L86-L91) — `isConsistencyViolation` is set but never included in the return value.
- **Secondary**: `ResourceV2CacheEntry._finishPatch` detection heuristic at [ResourceV2CacheEntry.ts](src/query-v2/core/resource/ResourceV2CacheEntry.ts#L246-L248) — the second condition gates on `type === "aborted"`, missing the `type === "committed"` case.
- **Tertiary**: `ResourceV2CacheEntry._doFetch` success handler at [ResourceV2CacheEntry.ts](src/query-v2/core/resource/ResourceV2CacheEntry.ts#L170-L180) — calls `resolvePatches` but performs no violation check.

### Test Evidence

- **Relevant tests found**:
  - [Patcher.test.ts](src/query-v2/core/machines/__tests__/Patcher.test.ts) — PA10 and PA11 test consistency violation scenarios but only check that `patchState` is null or that no exception is thrown. Neither test asserts that `isConsistencyViolation` is correctly returned in the `patchState`.
  - [ResourceV2CacheEntry.test.ts](src/query-v2/core/resource/__tests__/ResourceV2CacheEntry.test.ts) — RCE14 tests consistency violation auto-invalidation but only for the abort path. The test comment acknowledges: "Either success (if no violation) or refreshing (if violation detected)".
  - [optimistic-updates.test.ts](src/query-v2/__tests__/integration/optimistic-updates.test.ts) — INT09 tests out-of-order abort triggering consistency violation, but does not test the commit+throw path.
- **Failing test cases**: None — the bug path (commit + applyPatches throws) is not tested.
- **Gap**: No test covers `finishPatch` with `type === "committed"` where `applyPatches` throws internally. No test asserts that `isConsistencyViolation` is propagated through the `patchState` return when the catch path is taken.

### Scope Boundaries

- Analyzed: `Patcher.resolvePatches`, `Patcher.finishPatch`, `ResourceV2CacheEntry._finishPatch`, `ResourceV2CacheEntry._doFetch`, and all related test files.
- Not analyzed: Whether upstream callers (e.g., `MachineWithData.finishPatch`) have their own violation handling — they delegate to `Patcher` and accept its return value at face value.

---

## Bug #5: `$cacheDataLoaded` Promise Hangs on `resetCache`

### Reported Problem

When `resetCache` is called on a resource that has cache entries where data was never loaded (still in pending/error state), the `$cacheDataLoaded` promise returned to the `onCacheEntryAdded` callback is never resolved or rejected — it hangs indefinitely.

### Expected vs Actual

- **Expected**: When `resetCache` is called, all pending `$cacheDataLoaded` promises should be rejected (following the RTK Query pattern: `Error("Promise never resolved before cacheEntryRemoved.")`), allowing consumer code in `onCacheEntryAdded` to clean up.
- **Actual**: The `$cacheDataLoaded` promise for entries where data never arrived is never settled. The `LifecycleHooks.clearAll()` method that would reject them runs on an already-empty `_entryResolvers` map.

### Failure Path

1. User configures `onCacheEntryAdded` on a resource, receiving `$cacheDataLoaded` and `$cacheEntryRemoved` promises.
2. A cache entry is created (e.g., via `resource.query(args)`). `LifecycleHooks.fireCacheEntryAdded` creates `PromiseResolver` instances for `dataLoaded` and `entryRemoved`, stores them in `_entryResolvers` keyed by `args`, and calls the user callback.
3. Data has **not yet loaded** (query is still in flight, or query errored) — `resolveDataLoaded` was never called, so `$cacheDataLoaded` is still pending.
4. `resource.resetCache()` is called ([ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L101-L112)):
   - Step A: Collects all entries, calls `_cache.clear()`.
   - Step B: For each entry, calls `entry.complete()`.
   - Step C: `entry.complete()` calls `super.complete()` which fires `onClean$`.
   - Step D: The `onClean$` subscriber (set up in `_entryFactory` at [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L152-L155)) calls `_lifecycleHooks.fireCacheEntryRemoved(args)`.
   - Step E: `fireCacheEntryRemoved` ([LifecycleHooks.ts](src/query-v2/core/LifecycleHooks.ts#L83-L89)) resolves `$cacheEntryRemoved`, then **deletes** the entry from `_entryResolvers` map.
   - Step F: After all entries are completed, `_lifecycleHooks.clearAll()` is called ([ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L108)).
   - Step G: `clearAll()` ([LifecycleHooks.ts](src/query-v2/core/LifecycleHooks.ts#L105-L113)) iterates `_entryResolvers` to reject `dataLoaded` — but the map is **already empty** (cleared in step E).
5. Result: `$cacheDataLoaded` was never resolved (no data arrived) and was never rejected (resolver was deleted before `clearAll` could reject it). The promise hangs forever.

### Ordering Problem Detail

The root cause is the ordering in `resetCache`: `entry.complete()` synchronously triggers `fireCacheEntryRemoved` which deletes resolvers from the map **before** `clearAll()` has a chance to reject them. The `fireCacheEntryRemoved` method only resolves `$cacheEntryRemoved` and deletes the map entry — it does **not** reject `$cacheDataLoaded`.

For entries where data **was** already loaded (resolved), the hanging is not observable since the promise is already settled. The bug only manifests when `resetCache` is called while entries are still in `pending` or `error` state (data never arrived).

### Root Location

- **Primary**: `LifecycleHooks.fireCacheEntryRemoved` at [LifecycleHooks.ts](src/query-v2/core/LifecycleHooks.ts#L83-L89) — deletes resolver from `_entryResolvers` without rejecting `dataLoaded`.
- **Secondary**: `ResourceV2.resetCache` at [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L101-L112) — calls `entry.complete()` (which triggers removal) before `clearAll()` (which would reject).

### Test Evidence

- **Relevant tests found**:
  - [edge-cases.test.ts](src/query-v2/__tests__/edge-cases.test.ts) — E06 tests `resetCache` during inflight query but does **not** check `$cacheDataLoaded` promise settlement.
  - [plugins-and-snapshot.test.ts](src/query-v2/__tests__/integration/plugins-and-snapshot.test.ts) — INT13 tests `$cacheDataLoaded` resolving on successful query but does **not** test the reset scenario.
  - [LifecycleHooks.test.ts](src/query-v2/core/__tests__/LifecycleHooks.test.ts) — tests `clearAll()` in isolation (where resolvers are still in the map), which passes correctly — but does not test `fireCacheEntryRemoved` followed by `clearAll()`.
- **Failing test cases**: None — the specific sequence (entry removal then clearAll) is not tested.
- **Gap**: No test verifies that `$cacheDataLoaded` is rejected when `resetCache` is called before data loads. No test exercises the interaction between `fireCacheEntryRemoved` (which deletes resolvers) and `clearAll` (which expects to reject them).

### Scope Boundaries

- Analyzed: `ResourceV2.resetCache`, `ResourceV2._entryFactory` (onClean$ subscriber), `LifecycleHooks.fireCacheEntryRemoved`, `LifecycleHooks.clearAll`, `PromiseResolver`, `CacheEntry.complete`.
- Not analyzed: GC-triggered entry removal (via `cacheLifetime` expiry) — it follows the same `onClean$` → `fireCacheEntryRemoved` path and likely has the same issue, but GC is a separate trigger from `resetCache`.
