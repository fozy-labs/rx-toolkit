---
title: "Test Strategy: Query-v2 Bugfixes and Docs"
date: 2026-03-29
stage: 02-design
role: rdpi-qa-designer
---

## Approach

Testing pyramid:

- **Unit tests** — one per modified component, verifying the specific fix in isolation. Targets: `ResourceV2CacheEntry` (Bugs #1, #2), `ResourceV2Agent` (Bug #3), `Patcher` (Bug #4), `LifecycleHooks` (Bug #5), `MachineSuccess`/`MachineRefreshing` (`lastError`).
- **Integration tests** — cross-component scenarios exercising real `createApi` → `ResourceV2` → agent → state pipelines. Targets: snapshot hydration + lifecycle hooks interaction, full SWR cycle with error recovery, cache reset during optimistic update, `onQueryStarted` end-to-end lifecycle.
- **E2E (visual)** — interactive demo examples in `apps/demos/` that double as manual regression checks for Bugs #1 and #3. Not automated; validated visually.

Existing test files per [ref: ../01-research/01-codebase-analysis.md#Tests] are extended in place. New integration tests added to `@/query-v2/__tests__/integration/`.

---

## Test Cases

### Bug #1 — Snapshot Fetch Bypass

[ref: ./01-architecture.md#Fix Area 1]

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| T01 | Unit | Hydrated entry with `initialMachine` does NOT call `queryFn` | `new ResourceV2CacheEntry({ ..., initialMachine: MachineSuccess(...) })` | `queryFn` not called; `entry.peek().status === "success"` | High |
| T02 | Unit | Entry without `initialMachine` calls `queryFn` (existing behavior preserved) | `new ResourceV2CacheEntry({ ... })` (no `initialMachine`) | `queryFn` called once; initial state is `MachinePending` | High |
| T03 | Unit | `_entryFactory(args, initialMachine)` forwards to constructor correctly | `resource.hydrateEntry(args, machineSuccess)` | Entry created with `initialMachine`; `queryFn` call count = 0 | High |
| T04 | Integration | **Regression E07 update**: `createApi({ initialSnapshot })` with fresh entries → zero `queryFn` calls | `createApi` with snapshot where `updatedAt` is within `maxSnapshotDataAge` | `queryFn` NOT called; agent reads snapshot data immediately | High |
| T05 | Integration | Stale snapshot entry triggers refetch after hydration | `createApi` with snapshot where `updatedAt` exceeds `maxSnapshotDataAge` | `queryFn` called once (via `invalidate()`); entry transitions `MachineSuccess → MachineRefreshing → MachineSuccess` | High |
| T06 | Integration | Invalid snapshot version → no hydration, normal fetch | `createApi({ initialSnapshot: { version: 999, ... } })` | Snapshot ignored; entries created normally with `_doFetch()` | Medium |

### Bug #2 — `onQueryStarted` Wiring

[ref: ./01-architecture.md#Fix Area 1]

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| T07 | Unit | `_doFetch` calls `fireQueryStarted` before `queryFn` | Entry with `onQueryStarted` configured; trigger `_doFetch` | `onQueryStarted` callback invoked with `(args, { $queryFulfilled, getCacheEntry })` | High |
| T08 | Unit | `$queryFulfilled` resolves with `{ data }` on success | `_doFetch` → `queryFn` resolves with data | `await $queryFulfilled` returns `{ data }` | High |
| T09 | Unit | `$queryFulfilled` rejects on `queryFn` error | `_doFetch` → `queryFn` rejects with `Error("fail")` | `await $queryFulfilled` rejects with the error | High |
| T10 | Unit | Aborted (stale) fetch does NOT settle `$queryFulfilled` | Two rapid `_doFetch` calls; first becomes stale | First `$queryFulfilled` remains pending (not settled); second creates its own lifecycle | Medium |
| T11 | Integration | `onQueryStarted` fires during real resource query lifecycle | `resource.query(args)` with `onQueryStarted` configured | Callback invoked; `$queryFulfilled` settles on fetch completion | High |
| T12 | Integration | Optimistic patch via `onQueryStarted` → commit on success, abort on failure | `patchHandle = entry.createPatch(...)` in `onQueryStarted`; await `$queryFulfilled` | Success: `commit()` applied. Error: `abort()` reverts data | Medium |

### Bug #3 — SWR Error Masking

[ref: ./01-architecture.md#Fix Area 2]

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| T13 | Unit | Cross-args refetch error: `isError: true` with stale `data` | Agent `start({id:1})` succeeds → `start({id:2})` fails → read `state$` | `{ isError: true, error: Error, data: id1Data, status: "refreshing" }` | High |
| T14 | Unit | `previous$` cleared after cross-args error | Same as T13; read `state$` again after clear | `previous$` is null; next read without previous shows raw error state | High |
| T15 | Unit | Same-args refetch error maintains `isError: false` (machine-level SWR) | Entry in `MachineRefreshing` → `queryFn` rejects | `MachineSuccess` with `data` preserved, `lastError` set, `status: "success"` (no agent SWR override) | High |
| T16 | Unit | `isError: false` when pending + previous (normal SWR loading) | Agent `start({id:1})` succeeds → `start({id:2})` pending | `{ isError: false, status: "refreshing", data: id1Data }` | Medium |
| T17 | Integration | Full SWR cycle: success → arg change → error → `isError: true` → retry → success → `isError: false` | Sequence of agent `start()` calls with controlled `queryFn` | State transitions match expected sequence; `previous$` cleaned up | High |

### Bug #4 — Patcher Consistency Violation

[ref: ./01-architecture.md#Fix Area 3]

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| T18 | Unit | `resolvePatches` catch returns `patchState` with `isConsistencyViolation: true` | `resolvePatches(data, patches)` where `applyPatches` throws | `{ data: currentData, patchState: { patches: [], isConsistencyViolation: true } }` | High |
| T19 | Unit | `resolvePatches` normal path returns `isConsistencyViolation: false` | `resolvePatches(data, patches)` where all patches apply cleanly | `{ data: resolvedData, patchState: { ..., isConsistencyViolation: false } }` | Medium |
| T20 | Unit | `_finishPatch` detects violation from catch path → calls `invalidate()` | `_finishPatch("committed", patch)` with mocked `resolvePatches` returning violation | `entry.invalidate()` called; entry transitions to `MachineRefreshing` | High |
| T21 | Integration | Commit-path violation → auto-invalidation → refetch → server truth | Create patch → server returns structurally different data → commit | Entry auto-invalidates; `queryFn` called again; final state = fresh server data | High |

### Bug #5 — `$cacheDataLoaded` Hang on `resetCache`

[ref: ./01-architecture.md#Fix Area 4]

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| T22 | Unit | `fireCacheEntryRemoved` rejects pending `$cacheDataLoaded` | `fireCacheEntryAdded` → (no `resolveDataLoaded`) → `fireCacheEntryRemoved` | `$cacheDataLoaded` rejects with `Error("Promise never resolved before cacheEntryRemoved.")` | High |
| T23 | Unit | `fireCacheEntryRemoved` on already-resolved `$cacheDataLoaded` → no error | `fireCacheEntryAdded` → `resolveDataLoaded` → `fireCacheEntryRemoved` | `$cacheDataLoaded` already resolved; reject is a no-op; `$cacheEntryRemoved` resolves | Medium |
| T24 | Integration | `resetCache()` with pending query → `$cacheDataLoaded` rejects | `resource.query(args)` with `onCacheEntryAdded`; `resetCache()` before fetch completes | `$cacheDataLoaded` rejects; `onCacheEntryAdded` catch block fires; no hanging promise | High |
| T25 | Integration | GC-triggered entry removal → `$cacheDataLoaded` rejects | Entry with short `cacheLifetime`; all subscribers unsubscribe; GC timer fires | `$cacheDataLoaded` rejects with same error message; no hanging promise | High |

### `lastError` Enhancement

[ref: ./01-architecture.md#Fix Area 5]

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| T26 | Unit | `MachineRefreshing.errorHappened(error)` → `MachineSuccess` with `lastError` | `machineRefreshing.errorHappened(new Error("fail"))` | `result.status === "success"`, `result.lastError === error`, `result.data === staleData` | High |
| T27 | Unit | `MachineRefreshing.successHappened(data)` → `MachineSuccess` without `lastError` | `machineRefreshing.successHappened(freshData)` | `result.lastError === undefined` | High |
| T28 | Unit | `MachineSuccess.cloneWith()` propagates `lastError` | `machineSuccess.cloneWith({ data: newData })` where original has `lastError` | `clone.lastError === originalLastError` | Medium |
| T29 | Unit | Initial `MachineSuccess` (from fetch) has no `lastError` | `MachinePending → queryFn resolves → MachineSuccess` | `machine.lastError === undefined` | Medium |
| T30 | Integration | Same-args refetch failure sets `lastError` → next success clears it | `entry` succeeds → `invalidate()` → refetch error → `invalidate()` → refetch success | After error: `lastError` set. After success: `lastError === undefined` | High |
| T31 | Unit | `lastError` exposed in agent `state$` | Agent reads entry with `MachineSuccess({ lastError: error })` | `agentState.lastError === error` | Medium |

### Docs & Examples

[ref: ./01-architecture.md#Fix Area 6]

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| T32 | E2E | `README.md` no longer references `MachineIdle` | Grep for `MachineIdle` in `docs/query-v2/README.md` | Zero matches | High |
| T33 | E2E | `devtools.md` no longer references `devtoolsDebug` option | Grep for `devtoolsDebug` in `docs/query-v2/devtools.md` | Zero matches (or explicit "deprecated/removed" note) | High |
| T34 | E2E | `optimistic-updates.md` `onQueryStarted` section is consistent with wired implementation | Manual review of code examples | Examples match post-fix API (`$queryFulfilled` works) | Medium |
| T35 | E2E | Basic query example renders loading → success | Run `apps/demos/` → navigate to basic query example | Loading spinner → data rendered | Medium |
| T36 | E2E | Error/SWR example shows `isError: true` with stale data | Run `apps/demos/` → navigate to error example → trigger failure | Error banner + stale data visible simultaneously | Medium |
| T37 | E2E | Snapshot hydration example shows zero fetch count for fresh data | Run `apps/demos/` → navigate to snapshot example | Fetch counter = 0; data rendered immediately from snapshot | Medium |
| T38 | E2E | SKIP token example shows conditional fetching | Run `apps/demos/` → navigate to SKIP example → toggle condition | Agent skips/activates based on SKIP token | Low |

---

## Edge Cases

### Snapshot Hydration Edge Cases
- **Snapshot with `maxSnapshotDataAge: 0`** — all entries should be invalidated immediately after hydration. Verify `queryFn` called for all entries. (Covered by T05 with age=0.)
- **Snapshot with entries for resources not yet created** — `hydrateSnapshot` only hydrates matching resource keys; unmatched entries are silently skipped. Verify no crash.
- **Mixed fresh/stale entries in single snapshot** — fresh entries: no fetch; stale entries: fetch. Verify per-entry granularity.

### onQueryStarted Edge Cases
- **`onQueryStarted` not configured** — `_doFetch` should not crash when `_lifecycleHooks` has no `onQueryStarted` callback. `fireQueryStarted` is a no-op when callback is null. (Covered by existing tests.)
- **Multiple rapid invalidations** — each `_doFetch` creates its own `fireQueryStarted` lifecycle. Previous resolver is overwritten in `_queryResolvers` map. `clearAll()` handles orphaned resolvers.
- **`onQueryStarted` callback throws** — should not prevent `queryFn` execution or state transition. Verify error is caught/logged, not propagated.

### SWR Error Edge Cases
- **Error → error (second arg change also fails)** — after `previous$` cleared on first error, second error with no previous results in raw `MachineError` state without SWR data. `isError: true`, `data: null`.
- **Rapid arg switching: success → pending → error** — timing of SWR override depends on when `_deriveState$` evaluates. Signal reactivity ensures derived state is consistent.
- **`previous$` with `MachineRefreshing` status** — SWR override applies when previous has `success` or `refreshing` status. Verify `refreshing` previous data is carried through.

### Patcher Edge Cases
- **Multiple concurrent patches — first commits with violation, second still pending** — catch returns `patchState` with empty `patches` and `isConsistencyViolation: true`. Second patch is effectively discarded. Verify `invalidate()` is called once.
- **Abort-path with `applyPatches` throw** — secondary heuristic (`patchState === null && type === "aborted" && prevPatches.some(...)`) still works. Verify both detection paths.
- **No active patches when `resolvePatches` is called from `_doFetch` success handler** — `resolvePatches` with empty patches array should return cleanly, no violation.

### Cache Reset Edge Cases
- **`resetCache()` when all entries already have data loaded** — `$cacheDataLoaded` already resolved; reject in `fireCacheEntryRemoved` is a no-op. `$cacheEntryRemoved` resolves. No errors.
- **`resetCache()` during optimistic update** — entry with `_patchState` is `complete()`-d; abort triggers `onClean$`; `$cacheDataLoaded` is rejected if pending. Patch handle becomes stale.
- **Concurrent `resetCache()` calls** — second call on empty cache is a no-op. Verify idempotency.

### lastError Edge Cases
- **`lastError` survives `cloneWith` from patch operations** — `createPatch` → `cloneWith({data: patched})` preserves `lastError` on the cloned `MachineSuccess`.
- **`lastError` on snapshot-hydrated entry** — hydrated `MachineSuccess` from snapshot has no `lastError` (constructed without it). Verify `lastError === undefined`.

---

## Performance Criteria

No explicit performance thresholds are set for this bugfix scope. However:

- `_doFetch` with `fireQueryStarted` wiring should add < 1ms overhead (one promise creation + one callback invocation per fetch). Not a measurable regression.
- Snapshot hydration skipping `_doFetch` is a net performance **improvement** — eliminates N wasted network requests for N hydrated entries.
- `fireCacheEntryRemoved` adding a `reject()` call is O(1) per entry — negligible.

---

## Correctness Verification

End-to-end validation approach:

1. **Run full existing test suite** (`vitest run`) after each fix to catch regressions. All existing tests must pass (except E07 which is updated).
2. **Run new regression tests** for each bug — each test should fail on `main` branch (pre-fix) and pass on the fix branch.
3. **Integration test coverage** — the 4 integration tests (T04/T05 snapshot, T11/T12 onQueryStarted, T17 SWR cycle, T24/T25 cache reset) verify cross-component correctness.
4. **Doc validation** — grep-based checks (T32, T33) and manual review (T34) ensure documentation accuracy.
5. **Visual validation** — demo examples (T35–T38) provide manual regression checks for the most user-visible behaviors.
6. **Type-level validation** — existing `type-level.test.ts` extended to verify `lastError` field presence on `TSuccessState` and absence on other machine types.
