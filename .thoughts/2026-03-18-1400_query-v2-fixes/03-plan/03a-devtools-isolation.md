---
title: "Phase 3A: DevTools Agent State Isolation"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Prevent `ResourceV2Agent` signals from registering with Redux DevTools by passing `{ isDisabled: true }` to all three signal constructors. Only `CacheEntry` signals (canonical cache state) should appear in devtools. [ref: ../02-design/04-decisions.md ADR-3]

## Dependencies

- **Requires**: Phase 2 (Standalone Hooks) — `ResourceV2Agent.ts` is at its final path `core/resource/ResourceV2Agent.ts` after Phase 1; Phase 2 must complete for dependency ordering but doesn't directly modify this file
- **Blocks**: Phase 4A (JSDoc — adds inline comments to the same signal locations)

## Execution

Parallel with Phase 3B (Snapshot Errors).

## Tasks

### Task 3A.1: Add `{ isDisabled: true }` to agent signal constructors

- **File**: `src/query-v2/core/resource/ResourceV2Agent.ts`
- **Action**: Modify
- **Description**: Update three signal constructor calls to pass `{ isDisabled: true }` as the options argument:
  1. `_tracking$` — `Signal.state<AgentTracking<TData, TError>>({ previous: null, current: null })` → add `{ isDisabled: true }` as second arg
  2. `_refreshError$` — `Signal.state<TError | null>(null)` → add `{ isDisabled: true }` as second arg
  3. `_state$` — `Signal.compute<IResourceV2AgentState<TArgs, TData, TError>>(...)` → add `{ isDisabled: true }` as second arg to the compute call
  - The exact locations are the signal initialization lines in the constructor (or class field initializers). Each line gains one additional parameter object.
  - `CacheEntry._signal` is NOT modified — it continues to push to devtools via `beforeDevtoolsPush`.
- **Design reference**: [ref: ../02-design/04-decisions.md ADR-3 §decision], [ref: ../02-design/01-architecture.md §fix-4], [ref: ../02-design/02-dataflow.md §4-devtools-flow]
- **Complexity**: Low

### Task 3A.2: Verify existing agent tests pass (reactivity unaffected)

- **File**: `src/query-v2/core/__tests__/ResourceV2Agent.test.ts`
- **Action**: No modification expected
- **Description**: Run `ResourceV2Agent.test.ts` to confirm that adding `isDisabled: true` does not affect signal reactivity. The `isDisabled` flag only prevents devtools registration; signal subscription and computed derivation continue to work identically. If any test fails, investigate — it would indicate `isDisabled` has unexpected side effects (unlikely per signal system documentation).
- **Design reference**: Addresses T28
- **Complexity**: Low

## Verification

- [ ] `npm run ts-check` passes — `{ isDisabled: true }` is a valid `SignalOptions` field
- [ ] `vitest run src/query-v2/core/__tests__/ResourceV2Agent.test.ts` — all existing agent tests pass, `state$` reactivity unaffected (T28)
- [ ] Agent signal constructors have `isDisabled: true`: `_tracking$` (T23), `_refreshError$` (T24), `_state$` (T25)
- [ ] `CacheEntry._signal` is unaffected — still has `beforeDevtoolsPush` callback, no `isDisabled` (T26) [mitigates R6]
- [ ] Custom `beforeDevtoolsPush` on resource config remains functional for CacheEntry pushes (T27)
