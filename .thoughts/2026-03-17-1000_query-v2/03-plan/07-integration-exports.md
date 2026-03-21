---
title: "Phase 7: Integration Tests + Barrel Export + Config"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Add end-to-end integration tests that exercise full data flows (query lifecycle, SSR hydration, plugin augmentation), finalize the barrel export, update vitest config for coverage, and add query-v2 to the root package export. This phase validates the entire system works cohesively.

## Dependencies

- **Requires**: Phase 6 (all runtime code complete)
- **Blocks**: Phase 8 (Documentation + Demos)

## Execution

Sequential (depends on Phase 6).

## Tasks

### Task 7.1: Integration test — Full query lifecycle

- **File**: `src/query-v2/__tests__/integration/query-flow.test.ts`
- **Action**: Create
- **Description**: End-to-end test covering the complete query lifecycle as documented in the data flow diagrams.
- **Details**:
  - **Test 1 — Full lifecycle** (correctness verification #1 from testcases doc): `createApi` → `createResource` → `query(args)` → resolve → verify `MachineSuccess` data → `invalidate(args)` → verify `MachineRefreshing` with stale data → resolve refresh → verify `MachineSuccess` with fresh data. [ref: ../02-design/06-testcases.md — Correctness Verification #1]
  - **Test 2 — Optimistic update with rollback** (correctness verification #3): `query(args)` → `createPatch(draft => ...)` → verify UI sees optimistic data → abort patch → verify data reverted. Repeat with commit → verify data persists. [ref: ../02-design/06-testcases.md — Correctness Verification #3]
  - **Test 3 — Machine transition completeness** (correctness verification #5): Exercise every valid transition in the state diagram. Verify every invalid transition is prevented at type level. [ref: ../02-design/06-testcases.md — Correctness Verification #5]
  - Uses real signals, real Batcher, real Immer, controllable queryFn promises, fake timers.
- **Complexity**: Medium

### Task 7.2: Integration test — SSR hydration round-trip

- **File**: `src/query-v2/__tests__/integration/ssr-hydration.test.ts`
- **Action**: Create
- **Description**: End-to-end SSR test verifying server → client data flow.
- **Details**:
  - **Test** (correctness verification #2): Server-side `createApi` → `query(args)` → `getSnapshot()` → `JSON.stringify` → `JSON.parse` → client-side `createApi({ initialSnapshot })` → verify data available immediately → verify stale entries invalidated → verify `Machine.fromSnapshot()` produces correct `instanceof`. [ref: ../02-design/06-testcases.md — Correctness Verification #2]
  - Test version mismatch handling.
  - Test keyPrefix mismatch handling.
  - Verify `maxSnapshotDataAge` triggers refresh on stale entries.
- **Complexity**: Medium

### Task 7.3: Integration test — Plugin augmentation

- **File**: `src/query-v2/__tests__/integration/plugin-augmentation.test.ts`
- **Action**: Create
- **Description**: End-to-end plugin test verifying type-level and runtime augmentation.
- **Details**:
  - **Type test** (correctness verification #4): Create API with `ReactHooksPlugin`, verify `useResourceV2Agent` exists. Create API without plugin, verify method absent. Use `expectTypeOf`. [ref: ../02-design/06-testcases.md — Correctness Verification #4]
  - **Runtime test**: Create API with ReactHooksPlugin + custom mock plugin. Verify both plugins' contributions are available on the resource. Verify `install()` and `augmentResource()` called correctly.
  - Test multiple plugins composing without conflict.
- **Complexity**: Low

### Task 7.4: Finalize barrel export + vitest config + root export

- **Files** (all Modify):
  - `src/query-v2/index.ts` — Modify (final review — should already have all exports from Task 6.5)
  - `vitest.config.ts` — Modify
  - `src/index.ts` — Modify
- **Action**: Modify
- **Description**: Wire up query-v2 into the project's build and test infrastructure.
- **Details**:
  - **`src/query-v2/index.ts`**: Final review against architecture §7 public API surface. Ensure all exports from the architecture are present. No changes expected if Task 6.5 was complete. [ref: ../02-design/01-architecture.md#7]
  - **`vitest.config.ts`**: Add `'src/query-v2/**'` to `coverage.include` array. Exclude patterns (`*.test.ts`, `index.ts`, `*.types.ts`) already cover query-v2 files via glob. [ref: ../02-design/06-testcases.md — Coverage Targets]
  - **`src/index.ts`**: Add `export * from './query-v2';` to expose query-v2 public API from the root package. [ref: ../02-design/01-architecture.md#7]
- **Complexity**: Low

## Verification

- [ ] `npm run ts-check` passes
- [ ] All integration tests pass (query-flow, ssr-hydration, plugin-augmentation)
- [ ] Full query lifecycle test covers: cache miss → success → invalidate → refreshing → success
- [ ] SSR round-trip preserves data integrity
- [ ] Plugin type test verifies conditional method availability
- [ ] `vitest.config.ts` coverage includes `src/query-v2/**`
- [ ] `src/index.ts` exports query-v2 module
- [ ] `npm run test` passes (all existing tests + all new query-v2 tests)
- [ ] Coverage thresholds: 85%+ statements/branches/lines, 90% functions for query-v2
- [ ] No imports from `src/query/` in any query-v2 file
