---
title: "Problem Analysis: query-v2 Bugs #1–#3"
date: 2026-03-29
stage: 01-research
role: rdpi-problem-analyst
---

## Bug #1: `createApi({ initialSnapshot })` calls `queryFn` despite valid snapshot

### Reported Problem

When `createApi` receives an `initialSnapshot` with entries that are within `maxSnapshotDataAge`, the `queryFn` is still invoked for those entries. Expected: no fetch for fresh hydrated entries.

### Expected vs Actual

- **Expected**: Hydrated entries whose `updatedAt` is within `maxSnapshotDataAge` should be set into the cache without triggering `queryFn`. The entry should start in `MachineSuccess` state from the snapshot data.
- **Actual**: `queryFn` is called once per hydrated entry regardless of snapshot age. The hydrated `MachineSuccess` state is set *after* the fetch is already in flight.

### Reproduction Status

- **Status**: Reproduced (via code analysis + existing test acknowledgment)
- **Environment / Inputs**: Any `createApi` call with `initialSnapshot` containing valid entries.
- **Commands / Checks Run**: Static code trace; confirmed by test E07 at [edge-cases.test.ts](src/query-v2/__tests__/edge-cases.test.ts#L192) which explicitly comments `"Entry auto-fetches on construction, so queryFn is called once"`.

### Failure Path

1. `createApi(options)` stores `_savedSnapshot` — [createApi.ts](src/query-v2/api/createApi.ts#L37-L56).
2. `apiCreateResourceV2(resourceOptions)` is called — creates `new ResourceV2(mergedOptions)` at [createApi.ts](src/query-v2/api/createApi.ts#L90).
3. Snapshot hydration begins at [createApi.ts](src/query-v2/api/createApi.ts#L95): calls `hydrateSnapshot(snapshotResources, sliceSnapshot)`.
4. `hydrateSnapshot` iterates entries and calls `resource.hydrateEntry(args, machine)` — [Snapshot.ts](src/query-v2/core/Snapshot.ts#L77-L86).
5. `ResourceV2.hydrateEntry` calls `this._cache.getOrCreate(args)` then `entry.set(machine)` — [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L119-L121).
6. `getOrCreate(args)` triggers `_entryFactory(args)` — [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L139-L163).
7. `_entryFactory` creates `new ResourceV2CacheEntry(...)`. The constructor at [ResourceV2CacheEntry.ts](src/query-v2/core/resource/ResourceV2CacheEntry.ts#L47-L57) initializes state as `MachinePending` then **unconditionally** calls `this._doFetch().catch(() => {})`.
8. Control returns to `hydrateEntry`, which calls `entry.set(machine)` — setting `MachineSuccess`. But `_doFetch()` is already in flight (the `queryFn` promise is pending).
9. Back in `createApi`, the `maxSnapshotDataAge` check runs at [createApi.ts](src/query-v2/api/createApi.ts#L99-L107). For fresh entries (within age), no `invalidate()` is called — but the fetch was already triggered in step 7.
10. When the `_doFetch` promise resolves, the stale-check (`this._abortController !== controller`) passes, and the entry is overwritten with server data — discarding the snapshot optimization.

**Root location**: [ResourceV2CacheEntry.ts](src/query-v2/core/resource/ResourceV2CacheEntry.ts#L57) — unconditional `this._doFetch().catch(() => {})` in constructor. There is no mechanism to construct a `ResourceV2CacheEntry` without immediately fetching.

### Test Evidence

- **Relevant tests found**: [edge-cases.test.ts](src/query-v2/__tests__/edge-cases.test.ts#L151) (E07), [createApi.test.ts](src/query-v2/api/__tests__/createApi.test.ts#L134) (AP08), [plugins-and-snapshot.test.ts](src/query-v2/__tests__/integration/plugins-and-snapshot.test.ts#L76)
- **Failing test cases**: None — test E07 (line 192) explicitly **accepts** the spurious fetch: `expect(queryFn).toHaveBeenCalledTimes(1)` with comment `"Entry auto-fetches on construction, so queryFn is called once"`.
- **Gap**: No test asserts `queryFn` is NOT called when hydrating a fresh snapshot. The existing test documents the bug as expected behavior.

### Scope Boundaries

- Analyzed: `createApi` → `hydrateSnapshot` → `ResourceV2.hydrateEntry` → `ResourceV2CacheEntry` constructor → `_doFetch` call chain.
- Not analyzed: Whether `_doFetch` result actually overwrites the hydrated state in all timing scenarios (race condition details).

---

## Bug #2: `onQueryStarted` lifecycle hook never called (alleged dead code)

### Reported Problem

A junior developer reported that the `onQueryStarted` lifecycle hook is never called and appears to be dead code.

### Expected vs Actual

- **Expected**: `onQueryStarted` should be invoked each time a query fetch begins (analogous to RTK Query's `onQueryStarted`, providing `$queryFulfilled` promise for optimistic update patterns).
- **Actual**: `LifecycleHooks.fireQueryStarted()` is defined at [LifecycleHooks.ts](src/query-v2/core/LifecycleHooks.ts#L56-L72) and properly wired (callback stored at construction, line 32). However, **no production code ever calls `fireQueryStarted`**. `ResourceV2CacheEntry._doFetch()` does not invoke it. `ResourceV2._entryFactory()` does not invoke it. The method exists but is genuinely dead code in the production path.

### Reproduction Status

- **Status**: Reproduced (via exhaustive code search)
- **Environment / Inputs**: Any resource with `onQueryStarted` configured.
- **Commands / Checks Run**: `grep_search` for `fireQueryStarted` across all `*.ts` files in `src/query-v2/` — zero matches in production code. Only found in: `LifecycleHooks.ts` (definition), `LifecycleHooks.test.ts` (unit test), `plugins-and-snapshot.test.ts` (integration test INT13).

### Failure Path

1. User configures `onQueryStarted` callback in `TResourceV2Options`.
2. `ResourceV2` constructor creates `new LifecycleHooks(options.onCacheEntryAdded, options.onQueryStarted)` — [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L42).
3. The callback is stored as `this._onQueryStarted` in `LifecycleHooks` — [LifecycleHooks.ts](src/query-v2/core/LifecycleHooks.ts#L32).
4. `fireQueryStarted(args, entry)` exists at [LifecycleHooks.ts](src/query-v2/core/LifecycleHooks.ts#L56-L72) and would correctly create `$queryFulfilled` resolver and invoke the callback.
5. **Missing link**: Neither `ResourceV2CacheEntry._doFetch()` nor any other production code calls `this._lifecycleHooks.fireQueryStarted(...)`. The `_doFetch` method ([ResourceV2CacheEntry.ts](src/query-v2/core/resource/ResourceV2CacheEntry.ts#L138-L190)) proceeds directly from abort handling to `queryFn` invocation to result handling.
6. Similarly, `resolveQueryFulfilled` at [LifecycleHooks.ts](src/query-v2/core/LifecycleHooks.ts#L92-L103) is never called from production code.

**Root location**: Missing call sites — `fireQueryStarted` should be called from `ResourceV2CacheEntry._doFetch()` (or from `ResourceV2._entryFactory()` at query initiation), and `resolveQueryFulfilled` should be called from `_doFetch`'s success/error handlers.

### Test Evidence

- **Relevant tests found**: [LifecycleHooks.test.ts](src/query-v2/core/__tests__/LifecycleHooks.test.ts#L94) (LH05 — unit tests `fireQueryStarted` in isolation), [plugins-and-snapshot.test.ts](src/query-v2/__tests__/integration/plugins-and-snapshot.test.ts#L105) (INT13 — integration test registers `onQueryStarted` callback).
- **Failing test cases**: INT13 does NOT assert that `queryStarted` appears in `callLog`. The test only checks `callLog.includes("cacheEntryAdded:1")` and `callLog.includes("cacheDataLoaded:1")`. If it did assert `callLog.includes("queryStarted:1")`, the test would fail.
- **Gap**: No test verifies that `onQueryStarted` fires during an actual resource query lifecycle. The unit test (LH05) calls `fireQueryStarted` directly, not via `_doFetch`.

### Scope Boundaries

- Analyzed: All production call sites of `fireQueryStarted` and `resolveQueryFulfilled` in `src/query-v2/`. Confirmed zero production callers.
- Not analyzed: Whether this is intentionally deferred functionality or an oversight. The method is fully implemented and documented in [README.md](docs/query-v2/README.md) and [optimistic-updates.md](docs/query-v2/optimistic-updates.md).

---

## Bug #3: SWR masks `isError` when `error` object is present

### Reported Problem

Junior feedback: "SWR masks `isError` when an `error` object is present." When a refetch fails but stale data exists (SWR scenario), `error` is non-null but `isError` is `false`.

### Expected vs Actual

- **Expected**: When a query fails and the error object is set, `isError` should be `true` (consistent with RTK Query, TanStack Query, and SWR library conventions where error flags always reflect the error state).
- **Actual**: In the cross-args SWR path of `ResourceV2Agent._deriveState$`, when the current entry is in `"error"` status but a `previous$` entry exists with `"success"` data, `status` is overridden to `"refreshing"`. Since `isError` is derived as `status === "error"` (never checked), `isError` becomes `false`. Meanwhile, `error` is read from `currentMachine.error` which is non-null for `MachineError`. Result: `{ error: <Error>, isError: false, status: "refreshing" }`.

### Reproduction Status

- **Status**: Reproduced (via code analysis)
- **Environment / Inputs**: Agent with two sequential arg changes where first succeeds and second fails.
- **Commands / Checks Run**: Static trace of `_deriveState$` — [ResourceV2Agent.ts](src/query-v2/core/resource/ResourceV2Agent.ts#L104-L147).

### Failure Path

1. Agent `start({ id: 1 })` → entry for id=1 created → `queryFn` resolves → `MachineSuccess` state. `previous$` is null.
2. Agent `start({ id: 2 })` → id=1's entry saved as `previous$`. New entry for id=2 created → `MachinePending` state.
3. `_deriveState$` runs: `status = "pending"`, `previous$` exists with `success` → SWR override at [line 123-127](src/query-v2/core/resource/ResourceV2Agent.ts#L123-L127): `data = prevMachine.data` (Alice), `status = "refreshing"`. State returned: `{ status: "refreshing", data: Alice, error: null, isError: false }`. Correct so far.
4. id=2's `queryFn` **rejects** with an error → entry transitions to `MachineError({ error: <Error> })`.
5. `_deriveState$` runs again: `currentMachine.status = "error"`, `previous$` is still set (not yet cleared).
6. SWR override at [line 122](src/query-v2/core/resource/ResourceV2Agent.ts#L122): condition `status === "error" && previous$` is true → enters the override block. `prevMachine.status === "success"` → override applies:
   - `data = prevMachine.data` (Alice) ✓
   - `status = "refreshing"` ← overrides from `"error"` to `"refreshing"`
7. Derived flags at [lines 130-133](src/query-v2/core/resource/ResourceV2Agent.ts#L130-L133):
   - `isLoading = status === "pending" || status === "refreshing"` → `true`
   - `isRefreshing = status === "refreshing"` → `true`
   - `isError` is derived from `status === "error"` → `false` ← **BUG: should be `true`**
8. `error` field at [line 145](src/query-v2/core/resource/ResourceV2Agent.ts#L145): `currentMachine.error ?? null` → non-null `Error` object from `MachineError`.
9. Previous clearing at [line 136-138](src/query-v2/core/resource/ResourceV2Agent.ts#L136-L138): condition `status === "success" || status === "error"` — but `status` was overridden to `"refreshing"`, so **previous is NOT cleared** on this pass.
10. Final agent state: `{ status: "refreshing", data: Alice, error: <Error>, isError: false, isRefreshing: true }`.

**Root location**: [ResourceV2Agent.ts](src/query-v2/core/resource/ResourceV2Agent.ts#L127) — the SWR override unconditionally sets `status = "refreshing"` for error states with previous data, which then cascades to `isError` being `false`. Additionally, because `status` is overridden before the previous-clearing check, `previous$` is never cleared in this code path, causing the stale override to persist on subsequent reads.

### Two separate issues in this code path

1. **`isError` masked**: `status` override to `"refreshing"` causes `isError = false` while `error` is non-null.
2. **`previous$` never cleared**: The clearing condition checks the (already overridden) `status` instead of `currentMachine.status`, so `previous$` persists indefinitely when the current entry errors with previous data present.

### Test Evidence

- **Relevant tests found**: [ResourceV2Agent.test.ts](src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts#L251) (AG16 — tests basic error state).
- **Failing test cases**: None — AG16 tests error without previous data (no SWR override). No test covers the scenario of error + existing previous data.
- **Gap**: No test verifies the agent state when `start(newArgs)` fails while previous args had succeeded. AG03/AG04 test SWR with `pending`, not `error`. AG16 tests error without previous entry.

### Scope Boundaries

- Analyzed: `ResourceV2Agent._deriveState$` SWR override logic and flag derivation. Both the machine-level error handling (in `MachineRefreshing.errorHappened()` returning `MachineSuccess`) and the agent-level cross-args SWR path.
- Not analyzed: Same-args refetch failure (within a single entry). That path is handled by `MachineRefreshing.errorHappened()` → `MachineSuccess` at the machine level, which preserves stale data and discards the error entirely. That may be a separate concern (intentional SWR design at machine level vs unintentional masking at agent level).
