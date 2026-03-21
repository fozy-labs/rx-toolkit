---
title: "Verification: Phase 1 — Core Internal Split"
date: 2026-03-18
stage: 04-implement
role: rdpi-tester
---

## Results

| Check | Status | Details |
|-------|--------|---------|
| `npm run ts-check` | PASS | TypeScript compilation succeeds with no errors. Note: tsconfig excludes `**/*.test.ts`, so test file imports are not checked by tsc. |
| `npx vitest run src/query-v2/` — full suite | FAIL | 18/19 test files pass (179 tests). 1 test file fails: `Snapshot.test.ts` — see details below. |
| `core/index.ts` barrel resolves all symbols | PASS | Barrel re-exports `./common` (CacheEntry, CacheEntryOptions, CacheMap, TCacheMapInstance, LifecycleHooks), `./machines` (Machine, TMachineInstance, MachineIdle, MachinePending, MachineSuccess, MachineError, MachineRefreshing, MachineWithData, Patcher), `./resource` (ResourceV2, ResourceV2Config, ResourceV2Agent). All expected symbols present. |
| Cross-subfolder import works | PASS | `ResourceV2.ts` imports from `../common/CacheEntry`, `../common/CacheMap`, `../common/LifecycleHooks`. `ResourceV2Agent.ts` imports from `../common/CacheEntry`. |
| Existing tests pass without assertion changes | PASS | ResourceV2.test.ts (22 tests), ResourceV2Agent.test.ts (13 tests), CacheEntry.test.ts (13 tests), CacheMap.test.ts (18 tests), LifecycleHooks.test.ts (9 tests) — all pass. |
| `query-v2/index.ts` barrel exports all core symbols | PASS | Explicitly exports Machine, TMachineInstance, MachineIdle, MachinePending, MachineSuccess, MachineError, MachineRefreshing, MachineWithData, Patcher, CacheEntry, CacheEntryOptions, CacheMap, TCacheMapInstance, LifecycleHooks, ResourceV2, ResourceV2Config, ResourceV2Agent from `./core`. |
| No circular dependencies between `common/` and `resource/` | PASS | `common/` files import only from `../machines/*`, `@/signals`, `@/query-v2/types/*`, `@/query-v2/lib/*`, `@/common/utils/*`, and sibling `./` files. Zero imports from `resource/`. `resource/` imports from `../common/*` and `../machines/*` — one-directional dependency. |

## Failure Details

### `Snapshot.test.ts` — stale import path

**File**: `src/query-v2/snapshot/__tests__/Snapshot.test.ts`, line 4

**Error**:
```
Error: Failed to resolve import "@/query-v2/core/ResourceV2" from "src/query-v2/snapshot/__tests__/Snapshot.test.ts". Does the file exist?
```

**Cause**: The import on line 4 was not updated during the coder phase:
```typescript
import { ResourceV2, type ResourceV2Config } from "@/query-v2/core/ResourceV2";
```
Should be:
```typescript
import { ResourceV2, type ResourceV2Config } from "@/query-v2/core/resource/ResourceV2";
```

**Why ts-check didn't catch it**: The root `tsconfig.json` excludes `**/*.test.ts` from compilation, so `tsc --noEmit` doesn't check test file imports. Only vitest (via vite's import resolution) catches the stale path.

**Root cause**: The plan's Task 1.6 listed 3 files with `@/query-v2/core/ResourceV2` imports to update (`createApi.ts`, `ReactHooksPlugin.ts`, `Snapshot.ts`), but `Snapshot.test.ts` also has this import and was not listed as needing an update. The coder followed the plan correctly — the plan itself missed this file.

## Summary

6/7 checks passed. 1 failure: `Snapshot.test.ts` has a stale import `@/query-v2/core/ResourceV2` that must be updated to `@/query-v2/core/resource/ResourceV2`.
