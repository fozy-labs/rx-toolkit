---
title: "Phase 2: Core — State Machines & Patcher"
date: 2026-03-25
stage: 03-plan
role: rdpi-planner
---

## Goal

Implement the immutable class-based state machine hierarchy and the Patcher utility. These are the core business-logic primitives that model async query lifecycle and optimistic update state.

## Dependencies

- **Requires**: Phase 1 (types, lib)
- **Blocks**: Phase 4

## Execution

Sequential within phase: Patcher + MachineWithData first → 5 concrete machine classes parallel → Machine static factory → barrel → tests.

## Tasks

### Task 2.1: Create Patcher utility

- **File**: `src/query-v2/core/machines/Patcher.ts`
- **Action**: Create
- **Complexity**: High
- **Description**: Implement `Patcher` class with static methods for optimistic update patch management.
- **Details**:
  - `static createPatch<TData>(patchFn: (draft: TData) => void, data: TData): { patch: TPatch; data: TData }` — uses Immer `produceWithPatches` to generate forward/inverse patches, returns the produced patch and the new data
  - `static resolvePatches<TData>(originalData: TData, patches: TPatch[]): IPatchResolution<TData>` — re-applies patches on top of fresh server data, detects consistency violations
  - `static finishPatch<TData>(originalData: TData, patches: TPatch[], type: "committed" | "aborted", patch: TPatch): IPatchResolution<TData>` — commits or aborts a single patch, returns resolved data and updated patchState
  - `static abortAllPending<TData>(originalData: TData, patches: TPatch[]): IPatchResolution<TData>` — aborts all pending patches, returns resolved data with `patchState: null`
  - `IPatchResolution<TData>` has `data: TData`, `patchState: TPatchState<TData> | null` (contains `isConsistencyViolation` flag when non-null)
  - Consistency violation: when applying inverse→forward patches on server data produces different result
  - Uses `immer` (produceWithPatches, applyPatches, enablePatches)
  - [ref: ../02-design/03-model.md#§4, ../02-design/04-decisions.md#ADR-6]

### Task 2.2: Create MachineWithData abstract base class

- **File**: `src/query-v2/core/machines/MachineWithData.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Implement `MachineWithData<TArgs, TData>` abstract class — shared base for `MachineSuccess` and `MachineRefreshing`.
- **Details**:
  - Properties: `args: TArgs`, `data: TData`, `patchState: TPatchState<TData> | null`
  - Method: `createPatch(patchFn: (draft: TData) => void): CreatePatchResult<TArgs, TData> | null` — delegates to `Patcher.createPatch`, returns new machine instance with updated patchState + `IPatchHandle`, or `null` if patchFn produces no changes
  - Method: `finishPatch(type: "committed" | "aborted", patch: TPatch): TMachineInstance<TArgs, TData>` — finishes a patch (commit or abort), returns new machine with resolved state
  - Method: `abortAllPendingPatches(): TMachineInstance<TArgs, TData>` — aborts all pending patches, returns new machine with resolved state
  - Protected: `cloneWith(updates: Partial<this>): this` — clone with partial updates (used internally by transitions)
  - Immutable: all methods return new machine instances, do NOT mutate
  - [ref: ../02-design/03-model.md#§3.1]

### Task 2.3: Create MachineIdle class

- **File**: `src/query-v2/core/machines/MachineIdle.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Implement `MachineIdle<TArgs, TData>` — initial state with no data.
- **Details**:
  - `status: "idle"`
  - Properties: `args: null`
  - Transitions: `start(args: TArgs) → MachinePending`, `reset() → MachineIdle`
  - No data, no patchState
  - [ref: ../02-design/03-model.md#§3.1]

### Task 2.4: Create MachinePending class

- **File**: `src/query-v2/core/machines/MachinePending.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Implement `MachinePending<TArgs, TData>` — in-flight query with no previous data.
- **Details**:
  - `status: "pending"`
  - Properties: `args: TArgs`
  - Transitions: `successHappened(data: TData) → MachineSuccess`, `errorHappened(error: unknown) → MachineError`, `reset() → MachineIdle`
  - No data, no patchState
  - [ref: ../02-design/03-model.md#§3.1]

### Task 2.5: Create MachineSuccess class

- **File**: `src/query-v2/core/machines/MachineSuccess.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Implement `MachineSuccess<TArgs, TData> extends MachineWithData<TArgs, TData>` — successful query result.
- **Details**:
  - `status: "success"`
  - Properties: `updatedAt: number`
  - Inherits `data`, `patchState`, `createPatch`, `finishPatch`, `abortAllPendingPatches` from MachineWithData
  - Transitions: `invalidate() → MachineRefreshing`, `start(args: TArgs) → MachinePending`, `reset() → MachineIdle`
  - [ref: ../02-design/03-model.md#§3.1]

### Task 2.6: Create MachineError class

- **File**: `src/query-v2/core/machines/MachineError.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Implement `MachineError<TArgs, TData>` — failed query.
- **Details**:
  - `status: "error"`
  - Properties: `args: TArgs`, `error: unknown`
  - Transitions: `retry() → MachinePending`, `start(args: TArgs) → MachinePending`, `reset() → MachineIdle`
  - No data (TData is phantom), no patchState
  - `<TArgs, TData>` generic has only TArgs — not TError (ADR design: error is always `unknown`)
  - [ref: ../02-design/03-model.md#§3.1]

### Task 2.7: Create MachineRefreshing class

- **File**: `src/query-v2/core/machines/MachineRefreshing.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Implement `MachineRefreshing<TArgs, TData> extends MachineWithData<TArgs, TData>` — re-fetching while previous data is available.
- **Details**:
  - `status: "refreshing"`
  - Properties: `updatedAt: number`
  - Inherits `data`, `patchState`, `createPatch`, `finishPatch`, `abortAllPendingPatches` from MachineWithData
  - Transitions: `successHappened(data: TData) → MachineSuccess` (with patch resolution via `Patcher.resolvePatches`), `errorHappened(error: unknown) → MachineSuccess` (ADR-2: stale data preserved), `reset() → MachineIdle`
  - On `successHappened`: calls `Patcher.resolvePatches(serverData, patches)` to re-apply optimistic patches on fresh data; resulting `patchState` propagated to new MachineSuccess
  - On `errorHappened`: returns `MachineSuccess` with existing data/patchState preserved (stale data stays available per ADR-2)
  - [ref: ../02-design/03-model.md#§3.1, ../02-design/04-decisions.md#ADR-2, ADR-6]

### Task 2.8: Create Machine static factory

- **File**: `src/query-v2/core/machines/Machine.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Implement `Machine` namespace/static class with factory methods and snapshot hydration.
- **Details**:
  - `Machine.idle<TArgs, TData>(): MachineIdle<TArgs, TData>` — creates initial idle machine
  - `Machine.fromSnapshot<TArgs, TData>(state: TMachineState<TArgs, TData>): TMachineInstance<TArgs, TData>` — hydrates a machine from serialized state (for SSR snapshot support)
  - Switch on `state.status` to construct appropriate class
  - [ref: ../02-design/03-model.md#§2, §12.2]

### Task 2.9: Create machines barrel export

- **File**: `src/query-v2/core/machines/index.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Barrel re-export all machine classes, Patcher, Machine factory.
- **Details**: Export `Patcher`, `MachineIdle`, `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`, `MachineWithData`, `Machine`.
  - [ref: ../02-design/01-architecture.md#§2]

### Task 2.10: Create Patcher tests

- **File**: `src/query-v2/core/machines/__tests__/Patcher.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test all Patcher functionality per test matrix.
- **Details**:
  - PA01: `Patcher.createPatch(fn, data)` creates pending patch with patches/inversePatches
  - PA02: `resolvePatches` — single committed patch baked into base
  - PA03: `resolvePatches` — single pending patch applied, kept in queue
  - PA04: `resolvePatches` — aborted patch (no pending after) dropped silently
  - PA05: `resolvePatches` — committed before pending: committed consumed, pending kept
  - PA06: `resolvePatches` — aborted after pending: inverse applied, removed
  - PA07: `finishPatch` — commit transitions patch from pending→committed
  - PA08: `finishPatch` — abort transitions patch from pending→aborted
  - PA09: `abortAllPending` — marks all pending as aborted, resolves
  - PA10: Consistency violation: out-of-order abort on multi-patch
  - PA11: Consistency violation: `applyPatches` throws internally → caught
  - PA12: Empty patch queue → no-op
  - PA13: Patch on complex nested data (Immer deep draft)
  - [ref: ../02-design/06-testcases.md#PA01–PA13]

### Task 2.11: Create Machine state transition tests

- **File**: `src/query-v2/core/machines/__tests__/Machine.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test all machine state transitions and properties per test matrix.
- **Details**:
  MachineIdle:
  - SM01: `Machine.idle()` creates MachineIdle — status="idle", args=null, data=null, error=null
  - SM02: `idle.start(args)` → MachinePending — status="pending", args={id:1}, data=null
  - SM03: `idle.reset()` → MachineIdle
  - SM04: Idle is immutable — start returns new instance
  MachinePending:
  - SM05: `pending.successHappened(data)` → MachineSuccess — status="success", data={name:"test"}, updatedAt is number
  - SM06: `pending.errorHappened(error)` → MachineError — status="error", error is Error, data=null
  - SM07: `pending.reset()` → MachineIdle
  - SM08: Pending preserves args from start
  - SM09: Pending has no patchState
  MachineSuccess:
  - SM10: `success.invalidate()` → MachineRefreshing — status="refreshing", data preserved
  - SM11: `success.start(newArgs)` → MachinePending — args={id:2}
  - SM12: `success.reset()` → MachineIdle (aborts patches)
  - SM13: Success has updatedAt timestamp
  - SM14: Success carries data and patchState=null initially
  - SM15: Success .state serialization contains all fields
  MachineError:
  - SM16: `error.retry()` → MachinePending — same args as error
  - SM17: `error.start(args)` → MachinePending — args={id:3}
  - SM18: `error.reset()` → MachineIdle
  - SM19: Error preserves error value
  MachineRefreshing:
  - SM20: `refreshing.successHappened(freshData)` → MachineSuccess — data=newData
  - SM21: `refreshing.errorHappened(err)` → MachineSuccess (ADR-2: stale preserved)
  - SM22: `refreshing.reset()` → MachineIdle
  - SM23: Refreshing preserves stale data during background refetch
  - SM24: Refreshing preserves patches from success state
  Machine Static Factory:
  - SM25: `Machine.fromSnapshot(idleState)` → MachineIdle
  - SM26: `Machine.fromSnapshot(successState)` → MachineSuccess with data
  - SM27: `Machine.fromSnapshot(pendingState)` → MachinePending
  - SM28: `Machine.fromSnapshot(errorState)` → MachineError
  - SM29: `Machine.fromSnapshot(refreshingState)` → MachineRefreshing
  - SM30: Round-trip: instance → `.state` → `fromSnapshot()` → identical logic
  MachineWithData (Patcher integration):
  - SM31: `createPatch(patchFn)` returns `{ machine, patchHandle }`
  - SM32: `createPatch` returns null if no data (type-level guard)
  - SM33: `finishPatch("committed", patch)` applies patch permanently
  - SM34: `finishPatch("aborted", patch)` rolls back patch
  - SM35: `abortAllPendingPatches()` reverts all pending patches
  - SM36: Immutability: createPatch returns new instance
  - [ref: ../02-design/06-testcases.md#SM01–SM36]

## Verification

- [ ] `npm run ts-check` passes
- [ ] `npx vitest run src/query-v2/core/machines/` — all tests pass (PA01–PA13, SM01–SM36)
- [ ] All machine transitions match the state diagram in design
- [ ] All machine classes are immutable (no mutation methods)
- [ ] No imports from layers above core (no api/, react/, plugins/ imports)
