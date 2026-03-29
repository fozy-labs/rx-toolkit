---
title: "Phase 3: Agent & Patcher Fixes (#3, #4)"
date: 2026-03-29
stage: 03-plan
role: rdpi-planner
---

## Goal

Fix Bug #3 (SWR error masking in `ResourceV2Agent._deriveState$`) and Bug #4 (Patcher consistency violation lost in catch block). These are isolated in separate components with no cross-dependencies and no dependency on Phase 2.

## Dependencies

- **Requires**: Phase 1 (types: `lastError` field on `MachineSuccess` must exist for agent state derivation)
- **Blocks**: Phase 4 (Tests)

## Execution

Parallel with Phase 2

## Tasks

### Task 3.1: Bug #3 — Error-transparent SWR in `ResourceV2Agent._deriveState$`

- **Complexity**: High
- **File**: `src/query-v2/core/resource/ResourceV2Agent.ts`
- **Action**: Modify
- **Description**: In `_deriveState$`, before the SWR override block (where `status` is changed from `"error"` to `"refreshing"` when `previous$` has data), capture `const originalStatus = currentMachine.status`. Then:
  1. Derive `isError` from `originalStatus === "error"` (instead of the potentially-overridden `status` variable).
  2. Use `originalStatus` for the `previous$` clearing condition — if `originalStatus === "error"`, clear `previous$` (set to null/undefined). Currently this check uses the overridden `status` which is `"refreshing"`, preventing `previous$` from ever being cleared on error.
  3. The display-level `status` remains `"refreshing"` when SWR data is provided — this is intentional as a display hint.
- **Details**:
  - Sub-issue (a): `isError` was derived as `status === "error"` after the SWR override changed `status` to `"refreshing"` → `isError` was `false` even though the current machine is in error state. Fix: use `originalStatus`.
  - Sub-issue (b): `previous$` clearing condition checked `status !== "error"` (after override) → always true → `previous$` never cleared → stale SWR persists indefinitely. Fix: use `originalStatus`.
  - Also expose `lastError` from `currentMachine` in the derived state. If `currentMachine` is `MachineSuccess` and has `lastError`, include it in the derived state object.
  - [ref: ../02-design/01-architecture.md#7. Sequence Diagram — SWR State Derivation]
  - [ref: ../02-design/04-decisions.md#ADR-3]

### Task 3.2: Bug #4 — Fix Patcher catch-block return with `isConsistencyViolation`

- **Complexity**: Low
- **File**: `src/query-v2/core/machines/Patcher.ts`
- **Action**: Modify
- **Description**: In `resolvePatches` catch block (currently returns `{ data: currentData, patchState: null }`), change the return to include a proper `patchState` with `isConsistencyViolation: true`. Return: `{ data: currentData, patchState: { patches: [], originalData: currentData, isConsistencyViolation: true } }` (verify the exact `TPatchState` shape by reading the type definition — the key fields are `patches`, `originalData`, and `isConsistencyViolation`).
- **Details**:
  - `_finishPatch` existing detection via `patchState?.isConsistencyViolation === true` will now correctly detect the violation and call `invalidate()`.
  - No changes needed to `_finishPatch` — the existing check handles this once `patchState` is non-null.
  - `TPatchState` already contains the `isConsistencyViolation` field in its type definition — no type changes needed.
  - Empty `patches` array and `currentData` as `originalData` are semantically correct — "all patches cleared due to violation."
  - [ref: ../02-design/01-architecture.md#Fix Area 3]
  - [ref: ../02-design/04-decisions.md#ADR-4]

## Verification

- [ ] `npm run ts-check` passes
- [ ] All existing tests pass (`npx vitest run src/query-v2/`)
- [ ] `_deriveState$` exposes `isError: true` when current machine is in error state, even with SWR data from `previous$`
- [ ] `previous$` is cleared after cross-args error (not stuck in stale SWR)
- [ ] `resolvePatches` catch path returns `patchState` with `isConsistencyViolation: true`
- [ ] `lastError` exposed in agent derived state when present on current machine
