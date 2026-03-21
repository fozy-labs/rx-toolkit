---
title: "Phase 2: State Machines + Patcher"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Implement all 5 machine classes, the `MachineWithData` abstract base, the `Machine` static factory namespace, and the `Patcher` static utility. This phase delivers the core state machine system with full transition safety and the optimistic update patch algorithm — the most complex pure-logic layer in the module. All machine and patcher unit tests are included.

## Dependencies

- **Requires**: Phase 1 (types, NO_VALUE)
- **Blocks**: Phase 3 (CacheEntry uses Machine instances), Phase 4 (ResourceV2 orchestrates machines)

## Execution

Sequential (depends on Phase 1).

## Tasks

### Task 2.1: Implement Machine classes

- **Files** (all Create):
  - `src/query-v2/core/machines/MachineIdle.ts`
  - `src/query-v2/core/machines/MachinePending.ts`
  - `src/query-v2/core/machines/MachineSuccess.ts`
  - `src/query-v2/core/machines/MachineError.ts`
  - `src/query-v2/core/machines/MachineRefreshing.ts`
  - `src/query-v2/core/machines/MachineWithData.ts`
- **Action**: Create
- **Description**: Implement all 6 machine class files as defined in the domain model. Each class encapsulates state and exposes only valid transition methods, enforcing compile-time transition safety.
- **Details**:
  - `MachineIdle`: `state: TResourceV2IdleState`, methods: `start(args)` → `MachinePending`, `reset()` → `MachineIdle` (identity). Static: `create()`. [ref: ../02-design/03-model.md#1.3]
  - `MachinePending<TData>`: `state: TResourceV2PendingState`, methods: `successHappened(data)` → `MachineSuccess`, `errorHappened(error)` → `MachineError`, `reset()` → `MachineIdle`. Static: `create(args)`. [ref: ../02-design/03-model.md#1.3]
  - `MachineWithData<TData>` (abstract): `abstract state` with `data`, `originalData`, `patches`. Methods: `addPatch()`, `finishPatch()`, `createPatch()`, `abortAllPendingPatches()`. All delegate to `Patcher` statics. Each method returns a new instance of the same concrete type (not mutating). [ref: ../02-design/03-model.md#1.4, ../02-design/04-decisions.md#ADR-4]
  - `MachineSuccess<TData>` extends `MachineWithData<TData>`: `state: TResourceV2SuccessState`, methods: `invalidate()` → `MachineRefreshing`, `reset()` → `MachineIdle` (calls `abortAllPendingPatches()` first). Static: `create(data, args)`, `deploy(snapshotSlice)`. [ref: ../02-design/03-model.md#1.3]
  - `MachineError<TError>`: `state: TResourceV2ErrorState`, methods: `retry()` → `MachinePending` (same args), `start(args)` → `MachinePending` (new args), `reset()` → `MachineIdle`. Static: `create(error, args)`. [ref: ../02-design/03-model.md#1.3]
  - `MachineRefreshing<TData>` extends `MachineWithData<TData>`: `state: TResourceV2RefreshingState`, methods: `successHappened(data)` → `MachineSuccess` (aborts pending patches), `errorHappened(error)` → `MachineSuccess` (preserves stale data per ADR-2), `reset()` → `MachineIdle`. Static: `create(data, args, updatedAt)`. [ref: ../02-design/03-model.md#1.3, ../02-design/04-decisions.md#ADR-2]
  - All machines have a readonly `state` property that returns a plain JSON-serializable object (no class instances, no functions).
  - Machine instances are immutable — all transition methods return NEW instances.
- **Complexity**: High

### Task 2.2: Resolve MachineSuccess.start() design inconsistency

- **File**: `src/query-v2/core/machines/MachineSuccess.ts` (part of Task 2.1)
- **Action**: Design decision during implementation
- **Description**: The design has a pre-existing inconsistency: `MachineSuccess.start(args)` appears in the model's transition rules table (§4.2, row 6) and test case M5 but is NOT in the `MachineSuccess` class definition (model §1.3) or the architecture state diagram (§5). The implementing agent must resolve this inconsistency.
- **Details**:
  - **Option A (Add `start`)**: Add a `start(args): MachinePending` method to `MachineSuccess`. This aligns the class definition with the transition table and test M5. The `start` would call `abortAllPendingPatches()` before transitioning, similar to `reset()`. This is the transition for "start a fresh query with different args while data exists."
  - **Option B (Remove `start`)**: Remove row 6 from the transition table and skip test M5. The user would use `reset()` + `idle.start(args)` instead, or the Resource orchestrator would handle this flow externally.
  - **Recommendation**: Option A is the simpler interpretation — the transition table and test case both expect it, and it's a natural operation (re-query with new args from success state). The model class definition and state diagram likely just omitted it.
  - Whichever option is chosen, ensure consistency across: class definition, transition table (mental note — the table is in design docs, not code), test case M5, and the state diagram (also design docs — no code change needed for the diagram).
  - [ref: ../02-design/README.md — Quality Review Issue #1]
- **Complexity**: Low

### Task 2.3: Implement Patcher static utility

- **File**: `src/query-v2/core/machines/Patcher.ts`
- **Action**: Create
- **Description**: Implement the `Patcher` class with static methods for optimistic update patch management. Uses Immer's `produceWithPatches` and `applyPatches`.
- **Details**:
  - `Patcher.createPatch<TData>(patchFn, data)`: Uses `enablePatches()` + `produceWithPatches(data, patchFn)` to produce `{ patches, inversePatches }`. Returns `TResourceV2Patch` with `status: 'pending'`. [ref: ../02-design/03-model.md#1.8]
  - `Patcher.resolvePatches<TData>(originalData, patches)`: Implements the RFC's patch resolution algorithm — iterate the queue: committed before first pending → apply and remove; pending → apply and keep; committed after pending → apply and keep; aborted after pending → revert and keep; aborted with no pending after → remove. Returns the resolved data. [ref: ../02-design/02-dataflow.md#4, RFC Patch'es section]
  - `Patcher.finishPatch<TData>(originalData, patches, type, patch)`: Marks the target patch as `committed` or `aborted`, runs `resolvePatches`, clears `originalData` → `NO_VALUE` when no pending patches remain. Returns `{ originalData, patches, data }`. [ref: ../02-design/03-model.md#1.8]
  - Must call `enablePatches()` from Immer at module load time.
  - **Critical**: `finishPatch` with `'abort'` must apply inverse patches. `finishPatch` with `'commit'` just marks the patch — committed patches' changes are already reflected in data.
- **Complexity**: High

### Task 2.4: Implement Machine namespace (static factory)

- **File**: `src/query-v2/core/machines/Machine.ts`
- **Action**: Create
- **Description**: Create the `Machine` namespace/object with `idle()` and `fromSnapshot()` static factory methods, plus re-export the `TMachine` union type.
- **Details**:
  - `Machine.idle()`: Returns `MachineIdle.create()`. [ref: ../02-design/03-model.md#1.3]
  - `Machine.fromSnapshot<TData>(state)`: `switch(state.status)` to reconstruct the correct class instance. For `'success'` → `MachineSuccess.deploy(state)`. For unknown status → throw error. Only `'success'` is expected in snapshot data (other states are transient). However, implement all 5 status cases for robustness. [ref: ../02-design/03-model.md#1.3, ../02-design/02-dataflow.md#5]
  - Re-export all machine classes for convenient import: `export { MachineIdle, MachinePending, MachineSuccess, MachineError, MachineRefreshing }`.
  - Tests M15, M16 verify `fromSnapshot`.
- **Complexity**: Low

### Task 2.5: Machine and Patcher unit tests

- **Files** (all Create):
  - `src/query-v2/core/machines/MachineIdle.test.ts`
  - `src/query-v2/core/machines/MachinePending.test.ts`
  - `src/query-v2/core/machines/MachineSuccess.test.ts`
  - `src/query-v2/core/machines/MachineError.test.ts`
  - `src/query-v2/core/machines/MachineRefreshing.test.ts`
  - `src/query-v2/core/machines/MachineWithData.test.ts`
  - `src/query-v2/core/machines/Patcher.test.ts`
- **Action**: Create
- **Description**: Comprehensive unit tests for all machine transitions and patcher operations.
- **Details**:
  - **Machine tests** — implement test cases from design: M1 (idle→pending), M2 (pending→success), M3 (pending→error), M4 (success→refreshing), M5 (success→pending via start — depends on Task 2.2 resolution), M6 (success→idle), M7 (refreshing→success), M8 (refreshing→success on error with stale data preserved), M9 (refreshing→idle), M10 (error→pending via retry), M11 (error→pending via start), M12 (error→idle), M13 (idle.reset identity), M14 (type test — invalid transitions don't compile), M15 (Machine.fromSnapshot → MachineSuccess), M16 (fromSnapshot unknown status → error), M17 (machine.state is JSON-serializable). [ref: ../02-design/06-testcases.md#1]
  - **MachineWithData tests**: Test `addPatch`, `finishPatch`, `createPatch`, `abortAllPendingPatches` on both `MachineSuccess` and `MachineRefreshing` instances. Verify immutability (methods return new instances). Test E11: `MachineRefreshing.successHappened()` aborts pending patches.
  - **Patcher tests** — implement: P1 (createPatch produces patches), P2-P7 (resolvePatches various queue states), P8-P10 (finishPatch commit/abort with pending tracking), P11 (multi-patch sequence), P12 (abortAllPendingPatches). [ref: ../02-design/06-testcases.md#3]
  - All tests are pure unit tests — no signals, no async, no timers. Use real Immer (not mocked).
  - M14 is a type-level test using `vitest` `expectTypeOf` or similar.
- **Complexity**: High

## Verification

- [ ] `npm run ts-check` passes
- [ ] All 17 machine test cases (M1–M17) pass
- [ ] All 12 patcher test cases (P1–P12) pass
- [ ] MachineSuccess.start() inconsistency is resolved (either method exists and M5 passes, or M5 is skipped with a code comment explaining the decision)
- [ ] Machine instances are immutable — transition methods return new instances, original is unchanged
- [ ] All machine `.state` properties produce JSON-serializable output (`JSON.stringify` succeeds)
- [ ] `MachineRefreshing.errorHappened()` returns `MachineSuccess` with stale data preserved (ADR-2)
- [ ] `abortAllPendingPatches()` clears all pending patches and reverts to original data
- [ ] No imports from `src/query/`
