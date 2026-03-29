---
title: "Phase 4: Tests"
date: 2026-03-29
stage: 03-plan
role: rdpi-planner
---

## Goal

Add mandatory regression tests for all 5 bug fixes, the `lastError` enhancement, and update existing test E07. Tests validate corrected behavior per design `06-testcases.md`.

## Dependencies

- **Requires**: Phase 2 (Core Bug Fixes), Phase 3 (Agent & Patcher Fixes)
- **Blocks**: Phase 5 (Docs & Examples)

## Execution

Sequential

## Tasks

### Task 4.1: Bug #1 + E07 update — Snapshot hydration tests

- **Complexity**: Medium
- **File**: `src/query-v2/__tests__/integration/plugins-and-snapshot.test.ts`
- **Action**: Modify
- **Description**: Update existing test E07 (which currently asserts `queryFn` is called once on hydration — documenting the bug as expected). Change assertion to `expect(queryFn).not.toHaveBeenCalled()` for fresh snapshot entries within `maxSnapshotDataAge`. Add new test T05: stale snapshot entry (where `updatedAt` exceeds `maxSnapshotDataAge`) triggers refetch — `queryFn` called once via `invalidate()`.
- **Details**:
  - Test IDs from design: T01–T06. T04 (E07 update) and T05 are integration-level. T01–T03 are unit-level.
  - Unit tests for `ResourceV2CacheEntry` with `initialMachine`: add to `src/query-v2/core/resource/__tests__/ResourceV2CacheEntry.test.ts`. Test that `new ResourceV2CacheEntry({..., initialMachine})` does NOT call `queryFn` and starts in provided machine state. Test that without `initialMachine`, `queryFn` IS called (existing behavior).
  - [ref: ../02-design/06-testcases.md#Bug #1]

### Task 4.2: Bug #2 — onQueryStarted lifecycle tests

- **Complexity**: Medium
- **File**: `src/query-v2/core/resource/__tests__/ResourceV2CacheEntry.test.ts`
- **Action**: Modify
- **File**: `src/query-v2/__tests__/integration/query-flow.test.ts`
- **Action**: Modify
- **Description**: Add unit tests verifying `_doFetch` calls `fireQueryStarted` before `queryFn` and `resolveQueryFulfilled` after success/error (T07–T10). Add integration test verifying `onQueryStarted` fires during real resource query lifecycle and `$queryFulfilled` settles (T11). Optionally add T12: optimistic patch via `onQueryStarted` → commit on success, abort on failure.
- **Details**:
  - Unit tests may need to spy on `_lifecycleHooks.fireQueryStarted` and `resolveQueryFulfilled`.
  - Integration test uses `createApi` with `onQueryStarted` configured and verifies callback invocation and `$queryFulfilled` settlement.
  - [ref: ../02-design/06-testcases.md#Bug #2]

### Task 4.3: Bug #3 — SWR error masking tests + Bug #3 `lastError` agent state test

- **Complexity**: High
- **File**: `src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts`
- **Action**: Modify
- **File**: `src/query-v2/__tests__/integration/query-flow.test.ts`
- **Action**: Modify
- **Description**: Add unit tests T13–T16 for `ResourceV2Agent._deriveState$`: (T13) cross-args error shows `isError: true` with stale data, (T14) `previous$` cleared after error, (T15) same-args refetch error maintains machine-level SWR with `lastError`, (T16) pending + previous shows `isError: false`. Add integration test T17: full SWR cycle success → arg change → error → `isError: true` → retry → success → `isError: false`. Add T31: `lastError` exposed in agent `state$` when present on current machine.
- **Details**:
  - [ref: ../02-design/06-testcases.md#Bug #3]
  - [ref: ../02-design/06-testcases.md#lastError Enhancement]

### Task 4.4: Bug #4 — Patcher consistency violation tests + Bug #5 — `$cacheDataLoaded` rejection tests + `lastError` unit tests

- **Complexity**: Medium
- **File**: `src/query-v2/core/machines/__tests__/Patcher.test.ts`
- **Action**: Modify
- **File**: `src/query-v2/core/__tests__/LifecycleHooks.test.ts`
- **Action**: Modify
- **File**: `src/query-v2/core/machines/__tests__/Machine.test.ts`
- **Action**: Modify
- **Description**: Grouped because these are small, independent test additions:
  - **Patcher** (T18–T20): `resolvePatches` catch returns `patchState` with `isConsistencyViolation: true`; normal path returns `isConsistencyViolation: false`; `_finishPatch` detects violation → calls `invalidate()`.
  - **LifecycleHooks** (T22–T23): `fireCacheEntryRemoved` rejects pending `$cacheDataLoaded`; already-resolved `$cacheDataLoaded` → no error on removal.
  - **Machine** (T26–T29): `errorHappened()` → `MachineSuccess` with `lastError`; `successHappened()` → no `lastError`; `cloneWith()` propagates `lastError`; initial `MachineSuccess` has no `lastError`.
- **Details**:
  - [ref: ../02-design/06-testcases.md#Bug #4]
  - [ref: ../02-design/06-testcases.md#Bug #5]
  - [ref: ../02-design/06-testcases.md#lastError Enhancement]

### Task 4.5: Integration tests — Patcher violation + cache reset + `lastError` lifecycle

- **Complexity**: Medium
- **File**: `src/query-v2/__tests__/integration/optimistic-updates.test.ts`
- **Action**: Modify
- **File**: `src/query-v2/__tests__/integration/reset-and-multi-agent.test.ts`
- **Action**: Modify
- **File**: `src/query-v2/__tests__/integration/gc-lifecycle.test.ts`
- **Action**: Modify
- **Description**:
  - **Optimistic updates** (T21): Commit-path violation → auto-invalidation → refetch → server truth. Also add T30: same-args refetch failure sets `lastError` → next success clears it.
  - **Reset** (T24): `resetCache()` with pending query → `$cacheDataLoaded` rejects.
  - **GC** (T25): GC-triggered entry removal → `$cacheDataLoaded` rejects.
- **Details**:
  - [ref: ../02-design/06-testcases.md#Bug #4, Bug #5, lastError Enhancement]

### Task 4.6: Type-level test for `lastError`

- **Complexity**: Low
- **File**: `src/query-v2/types/__tests__/type-level.test.ts`
- **Action**: Modify
- **Description**: Add type-level assertion verifying `lastError?: unknown` is present on `TSuccessState` and absent on other machine state types (`TPendingState`, `TErrorState`). Use TypeScript type-only assertions (e.g., `Expect<Equal<...>>` or similar pattern already used in the file).
- **Details**:
  - [ref: ../02-design/06-testcases.md#Correctness Verification, point 6]

## Verification

- [ ] `npm run ts-check` passes
- [ ] All tests pass: `npx vitest run src/query-v2/`
- [ ] Test E07 updated to assert zero `queryFn` calls on fresh hydration
- [ ] Each bug has at least one unit test and one integration test
- [ ] `lastError` has unit, integration, and type-level tests
- [ ] No regressions in existing test suites
