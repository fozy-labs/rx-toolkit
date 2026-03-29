---
title: "Phase 1: Types & Machine Enhancement"
date: 2026-03-29
stage: 03-plan
role: rdpi-planner
---

## Goal

Add the `lastError` field to `MachineSuccess`, propagate it through `MachineRefreshing.errorHappened()` and `cloneWith()`, update the `TSuccessState` type, and add `initialMachine` to `IResourceV2CacheEntryOptions`. This phase establishes all type-level changes that downstream code phases depend on.

## Dependencies

- **Requires**: None
- **Blocks**: Phase 2 (Core Bug Fixes), Phase 3 (Agent & Patcher Fixes)

## Execution

Sequential

## Tasks

### Task 1.1: Add `lastError` to `MachineSuccess`

- **Complexity**: Low
- **File**: `src/query-v2/core/machines/MachineSuccess.ts`
- **Action**: Modify
- **Description**: Add `readonly lastError?: unknown` field to `MachineSuccess`. Add `lastError?: unknown` as the last optional constructor parameter. Set `this.lastError = lastError` in the constructor. Update `cloneWith()` to propagate `lastError` — if `"lastError" in updates` use the update value, otherwise carry `this.lastError`.
- **Details**:
  - Constructor signature becomes: `(args, data, patchState, updatedAt, lastError?)`
  - `cloneWith()` adds: `"lastError" in updates ? updates.lastError : this.lastError` as the 5th argument to the new `MachineSuccess(...)` call.
  - `lastError` defaults to `undefined` when not provided — all existing callers remain valid.
  - [ref: ../02-design/03-model.md#1. MachineSuccess Type Extension]

### Task 1.2: Update `MachineRefreshing.errorHappened()` to pass error as `lastError`

- **Complexity**: Low
- **File**: `src/query-v2/core/machines/MachineRefreshing.ts`
- **Action**: Modify
- **Description**: Change `errorHappened(_error: unknown)` to `errorHappened(error: unknown)` (remove underscore prefix). Pass `error` as the `lastError` parameter to `new MachineSuccess(this.args, this.data, this.patchState, this.updatedAt, error)`. Note: `successHappened()` already constructs `MachineSuccess` without `lastError` — no change needed there (it clears `lastError` by omission).
- **Details**:
  - [ref: ../02-design/03-model.md#MachineRefreshing.errorHappened() — Modification]
  - [ref: ../02-design/04-decisions.md#ADR-6]

### Task 1.3: Update `TSuccessState` type

- **Complexity**: Low
- **File**: `src/query-v2/types/machine.types.ts`
- **Action**: Modify
- **Description**: Add `readonly lastError?: unknown` to the `TSuccessState` interface. This makes the type system aware of the new field for consumers reading agent state.
- **Details**:
  - [ref: ../02-design/03-model.md#TSuccessState Type Extension]

### Task 1.4: Add `initialMachine` to `IResourceV2CacheEntryOptions`

- **Complexity**: Low
- **File**: `src/query-v2/core/resource/ResourceV2CacheEntry.ts`
- **Action**: Modify
- **Description**: Add `initialMachine?: TMachineInstance<TArgs, TData>` as an optional field to the `IResourceV2CacheEntryOptions` interface. This is a type-only change in this phase — the constructor logic using it is in Phase 2. Verify the correct machine type import is available.
- **Details**:
  - The type to use is whatever the existing `TMachineInstance` union type is (check imports in the file).
  - [ref: ../02-design/03-model.md#2. ResourceV2CacheEntry Constructor Changes]
  - [ref: ../02-design/04-decisions.md#ADR-1]

## Verification

- [ ] `npm run ts-check` passes — no type errors introduced
- [ ] All existing tests pass (`npx vitest run src/query-v2/`)
- [ ] `MachineSuccess` constructor accepts optional 5th `lastError` parameter
- [ ] `MachineRefreshing.errorHappened(error)` compiles without `_` prefix
- [ ] `TSuccessState` includes `lastError?: unknown`
- [ ] `IResourceV2CacheEntryOptions` includes `initialMachine?` field
