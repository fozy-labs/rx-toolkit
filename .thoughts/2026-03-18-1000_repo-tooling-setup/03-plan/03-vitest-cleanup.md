---
title: "Phase 3: Vitest Import Cleanup"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Remove explicit vitest imports from all test files and verify that `tsconfig.test.json` (created in Phase 1) provides the global types correctly. After this phase, no test file contains `import { ... } from "vitest"` and all tests still pass.

## Dependencies

- **Requires**: Phase 1 (`tsconfig.test.json` must exist)
- **Blocks**: Phase 4 (recommended — Formatting Migration produces a cleaner formatting commit on import-cleaned files)

## Execution

Parallel with Phase 2 (ESLint Configuration).

## Tasks

### Task 3.1: Remove vitest imports from all test files

- **File**: Multiple (~60 files — see list below)
- **Action**: Modify
- **Description**: Remove all `import { ... } from 'vitest'` and `import { ... } from "vitest"` lines from every test file in `src/`. This includes standard globals (`describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach`) and `expectTypeOf`.
- **Details**:
  - Use regex find-and-replace across all files: `^import\s+\{[^}]+\}\s+from\s+['"]vitest['"];?\s*\n`
  - Replace with empty string
  - **Special cases** — files with TWO separate vitest import lines (both must be removed):
    - `src/query-v2/__tests__/integration/plugin-augmentation.test.ts` — has `import { describe, it, expect, vi } from 'vitest'` AND `import { expectTypeOf } from 'vitest'`
    - `src/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts` — same pattern
  - **Special case** — file with `expectTypeOf` on same line as globals:
    - `src/query-v2/core/machines/Machine.test.ts` — `import { describe, it, expect, expectTypeOf } from 'vitest'`
  - **Setup file**:
    - `src/__tests__/setup.ts` — imports `afterEach, beforeEach` from `'vitest'`
  - [ref: ../02-design/05-usecases.md#uc-8-vitest-import-removal]
  - [ref: ../02-design/08-risks.md#r06-vitest-import-removal-misses-edge-cases]

**Complete list of affected files (verified against repository):**

`src/__tests__/setup.ts` and all `.test.ts` files:

| Directory | Files |
|-----------|-------|
| `src/__tests__/integration/` | `signals-integration.test.ts`, `signals-exports.test.ts`, `deprecated-api.test.ts`, `common-exports.test.ts`, `root-exports.test.ts` |
| `src/signals/base/` | `DependencyTracker.test.ts`, `Devtools.test.ts`, `ComputeCache.test.ts`, `Batcher.test.ts`, `Indexer.test.ts`, `ReadonlySignal.test.ts`, `SyncObservable.test.ts` |
| `src/signals/signals/` | `Signal.test.ts`, `LocalState.test.ts`, `Computed.test.ts`, `State.test.ts`, `Effect.test.ts` |
| `src/signals/operators/` | `signalize.test.ts` |
| `src/signals/types/` | `normalizeSignalOptions.test.ts` |
| `src/signals/react/` | `useSignal.test.ts` |
| `src/common/utils/` | `shallowEqual.test.ts`, `PromiseResolver.test.ts`, `deepEqual.test.ts` |
| `src/common/devtools/` | `reduxDevtools.test.ts`, `combineDevtools.test.ts` |
| `src/common/options/` | `SharedOptions.test.ts`, `DefaultOptions.test.ts` |
| `src/query/` | `SKIP_TOKEN.test.ts` |
| `src/query/react/` | `useResourceRef.test.ts`, `useResourceAgent.test.ts`, `useCommandAgent.test.ts` |
| `src/query/lib/` | `ReactiveCache.test.ts`, `IndirectMap.test.ts` |
| `src/query/core/` | `QueriesCache.test.ts`, `ResetAllQueriesSignal.test.ts`, `QueriesLifetimeHooks.test.ts` |
| `src/query/core/Resource/` | `ResourceRef.test.ts`, `ResourceDuplicator.test.ts`, `Resource.test.ts` |
| `src/query/core/Command/` | `Command.test.ts` |
| `src/query-v2/__tests__/integration/` | `ssr-hydration.test.ts`, `query-flow.test.ts`, `plugin-augmentation.test.ts` |
| `src/query-v2/snapshot/__tests__/` | `Snapshot.test.ts` |
| `src/query-v2/plugins/__tests__/` | `ReactHooksPlugin.test.ts` |
| `src/query-v2/core/__tests__/` | `ResourceV2Agent.test.ts`, `ResourceV2.test.ts`, `LifecycleHooks.test.ts` |
| `src/query-v2/core/` | `CacheEntry.test.ts`, `CacheMap.test.ts` |
| `src/query-v2/core/machines/` | `Machine.test.ts`, `MachineError.test.ts`, `MachinePending.test.ts`, `MachineIdle.test.ts`, `MachineSuccess.test.ts`, `MachineRefreshing.test.ts`, `MachineWithData.test.ts`, `Patcher.test.ts` |
| `src/query-v2/api/__tests__/` | `createApi.test.ts` |

### Task 3.2: Verify no stale vitest imports remain

- **File**: N/A (verification command)
- **Action**: Execute
- **Description**: After removal, grep for any remaining vitest imports to catch edge cases the regex missed.
- **Details**:
  - Run `grep -rn "from ['\"]vitest" src/` — expected: zero results
  - If any remain, manually remove them
  - [ref: ../02-design/06-testcases.md, T23]

## Verification

- [ ] `grep -rn "from ['\"]vitest" src/` returns zero results (T23)
- [ ] `npm run test` passes — all tests pass with same count as before (T22)
- [ ] `tsc --project tsconfig.test.json --noEmit` passes (T01 — types resolve without explicit imports)
- [ ] `npm run ts-check` still passes (compilability invariant)
