---
title: "Phase 8: Integration Tests & Package Exports"
date: 2026-03-25
stage: 03-plan
role: rdpi-planner
---

## Goal

Create cross-layer integration tests and edge case tests that exercise full end-to-end flows, finalize the module barrel with all public exports, and update `src/index.ts` to expose query-v2.

## Dependencies

- **Requires**: Phase 7 (all runtime layers complete)
- **Blocks**: Phase 9

## Execution

Integration test files can be created in parallel. Barrel finalization and `src/index.ts` update are sequential after tests pass.

## Tasks

### Task 8.1: Create integration tests — query flow

- **File**: `src/query-v2/__tests__/integration/query-flow.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test full query lifecycle end-to-end through all layers.
- **Details**:
  - INT01: Full pipeline: createResourceV2 → query → cache → agent.state$ → data
  - INT02: Full pipeline: React hook → fetch → render → rerender with new args
  - INT12: Args change: old entry's request is not aborted
  - Uses `createControllableObservable` for query control
  - Exercises: createApi → ResourceV2 → RCE → Machine transitions → Agent signal → assertion
  - [ref: ../02-design/06-testcases.md#INT01, INT02, INT12]

### Task 8.2: Create integration tests — GC lifecycle

- **File**: `src/query-v2/__tests__/integration/gc-lifecycle.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test garbage collection of cache entries end-to-end.
- **Details**:
  - INT05: GC under component lifecycle: mount→data→unmount→timer→remount (data still cached)
  - INT06: GC under component lifecycle: mount→data→unmount→timer expires (entry GC'd; remount triggers new fetch)
  - Uses fake timers for deterministic timer control
  - Exercises: createApi → useResourceV2Agent → unmount → timer → CacheMap state
  - [ref: ../02-design/06-testcases.md#INT05, INT06]

### Task 8.3: Create integration tests — optimistic updates

- **File**: `src/query-v2/__tests__/integration/optimistic-updates.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test optimistic patch lifecycle end-to-end.
- **Details**:
  - INT07: Optimistic update + rollback via entry.createPatch
  - INT08: Optimistic update + commit
  - INT09: Consistency violation → auto-invalidation → fresh data
  - Exercises: createApi → query success → createPatch → Patcher → resolve → MachineSuccess with/without violation
  - [ref: ../02-design/06-testcases.md#INT07–INT09]

### Task 8.4: Create integration tests — reset and multi-agent

- **File**: `src/query-v2/__tests__/integration/reset-and-multi-agent.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test resetAll coordination and multi-agent scenarios.
- **Details**:
  - INT10: resetAll → all agents see idle, all entries cleared
  - INT11: Multiple agents on same resource — shared cache, independent SWR
  - Exercises: createApi → multiple agents → resetAll → state verification
  - [ref: ../02-design/06-testcases.md#INT10, INT11]

### Task 8.5: Create integration tests — plugins and snapshot

- **File**: `src/query-v2/__tests__/integration/plugins-and-snapshot.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test plugin integration and SSR snapshot round-trip end-to-end.
- **Details**:
  - INT03: Plugin + cache + hook: ReactHooksPlugin contributes working hooks
  - INT04: Snapshot SSR round-trip: server capture → client save → per-resource consume → React render
  - INT13: Lifecycle hooks fired in correct order during full lifecycle
  - INT14: Plugin augmentResource called with all api-level defaults merged
  - Uses @testing-library/react for React component tests
  - [ref: ../02-design/06-testcases.md#INT03, INT04, INT13, INT14]

### Task 8.6: Create edge case tests

- **File**: `src/query-v2/__tests__/edge-cases.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test unusual and boundary scenarios.
- **Details**:
  - E01: queryFn throws synchronously (not async rejection)
  - E02: queryFn returns rejected promise immediately
  - E03: `null` / `undefined` as valid TData
  - E04: Very large args object — serialization performance
  - E05: ResourceV2 created but never queried — no leaks
  - E06: resetCache() during inflight query
  - E07: Hydrate entry then query same args — uses hydrated data
  - E08: AbortError from queryFn — no state transition (entry stays in current state)
  - E09: Double-commit or double-abort on patch handle — idempotent (second call is no-op)
  - E10: `entry.createPatch` during refreshing state — patch applies to stale data
  - [ref: ../02-design/06-testcases.md#E01–E10]

### Task 8.7: Finalize module barrel

- **File**: `src/query-v2/index.ts`
- **Action**: Modify
- **Complexity**: Low
- **Description**: Finalize the module barrel with the complete public API surface.
- **Details**:
  Review and ensure all public exports are present:
  - From types/: all public type exports (re-export types only)
  - From lib/: `SKIP` (the token), `stableStringify`
  - From core/machines/: `Machine`, `MachineIdle`, `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`, `MachineWithData`, `Patcher`
  - From core/: `CacheEntry`, `ResourceV2`, `ResourceV2CacheEntry`, `ResourceV2Agent`, `LifecycleHooks`
  - From core/Snapshot: `getSnapshot`, `CURRENT_SNAPSHOT_VERSION` (core-layer `hydrateSnapshot` is internal-only — not re-exported)
  - From api/: `createApi`, `createResourceV2`, `hydrateSnapshot` (API-layer version — the only public `hydrateSnapshot`)
  - From react/: `useResourceV2Agent`
  - From plugins/: `ReactHooksPlugin`
  - Cross-reference with legacy barrel (`src/query-v2-legacy/index.ts`) to ensure feature parity where applicable
  - [ref: ../02-design/01-architecture.md#§5]

### Task 8.8: Update package entry point

- **File**: `src/index.ts`
- **Action**: Modify
- **Complexity**: Low
- **Description**: Update the `unstable_queryV2` export to point to the new module.
- **Details**:
  - Current: `export * as unstable_queryV2 from "./query-v2";`
  - This should already resolve to the new `src/query-v2/index.ts` (since `src/query-v2-legacy/` has a different path)
  - Verify the import path resolves correctly — the existing line exports from `"./query-v2"` which will now point to the new `src/query-v2/index.ts`.
  - If path aliases or tsconfig paths need adjustment, update accordingly
  - **Note**: The old `src/query-v2-legacy/` remains untouched for backward compat during migration period
  - [ref: ../02-design/01-architecture.md#§5]

## Verification

- [ ] `npm run ts-check` passes
- [ ] `npx vitest run src/query-v2/__tests__/integration/` — INT01–INT14 pass
- [ ] `npx vitest run src/query-v2/__tests__/edge-cases.test.ts` — E01–E10 pass
- [ ] `npx vitest run src/query-v2/` — ALL query-v2 tests pass (full suite)
- [ ] `src/query-v2/index.ts` exports match the expected public API surface
- [ ] `src/index.ts` correctly re-exports `unstable_queryV2` from the new module
- [ ] No circular imports in the barrel chain
- [ ] `npm run check:all` passes (all packages compile, all tests green)
