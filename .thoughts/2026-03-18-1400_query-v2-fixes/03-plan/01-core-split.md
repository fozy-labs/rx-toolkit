---
title: "Phase 1: Core Internal Split"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Split the flat `core/` directory into `common/`, `machines/` (already exists), and `resource/` sub-folders with barrel re-exports. Zero public API change — only internal file organization and import path updates. [ref: ../02-design/04-decisions.md ADR-2]

## Dependencies

- **Requires**: None — first phase
- **Blocks**: Phase 2 (Standalone Hooks), Phase 3A (DevTools), Phase 3B (Snapshot Errors)

## Execution

Sequential — must complete before any subsequent phase.

## Tasks

### Task 1.1: Create `core/common/` barrel file

- **File**: `src/query-v2/core/common/index.ts`
- **Action**: Create
- **Description**: Create barrel re-exporting all common module symbols:
  - `export { CacheEntry, type CacheEntryOptions } from "./CacheEntry";`
  - `export { CacheMap, type TCacheMapInstance } from "./CacheMap";`
  - `export { LifecycleHooks } from "./LifecycleHooks";`
- **Design reference**: [ref: ../02-design/04-decisions.md ADR-2 §decision]
- **Complexity**: Low

### Task 1.2: Create `core/resource/` barrel file

- **File**: `src/query-v2/core/resource/index.ts`
- **Action**: Create
- **Description**: Create barrel re-exporting all resource module symbols:
  - `export { ResourceV2, type ResourceV2Config } from "./ResourceV2";`
  - `export { ResourceV2Agent } from "./ResourceV2Agent";`
- **Design reference**: [ref: ../02-design/04-decisions.md ADR-2 §decision]
- **Complexity**: Low

### Task 1.3: Move common files to `core/common/` and update their relative imports

- **Files**:
  - `src/query-v2/core/CacheEntry.ts` → `src/query-v2/core/common/CacheEntry.ts`
  - `src/query-v2/core/CacheMap.ts` → `src/query-v2/core/common/CacheMap.ts`
  - `src/query-v2/core/LifecycleHooks.ts` → `src/query-v2/core/common/LifecycleHooks.ts`
- **Action**: Move + Modify
- **Description**: Move all three files into `core/common/`. Update their relative imports:
  - **CacheEntry.ts** (3 imports change):
    - `./machines/Machine` → `../machines/Machine`
    - `./machines/MachineIdle` → `../machines/MachineIdle`
    - `./machines/MachineWithData` → `../machines/MachineWithData`
  - **CacheMap.ts** (0 imports change):
    - `./CacheEntry` stays `./CacheEntry` (same directory after move)
  - **LifecycleHooks.ts** (1 import changes):
    - `./CacheEntry` stays `./CacheEntry` (same directory after move)
    - `./machines/Machine` → `../machines/Machine`
- **Design reference**: [ref: ../02-design/01-architecture.md §fix-3], [ref: ../01-research/01-codebase-analysis.md §3]
- **Complexity**: Medium

### Task 1.4: Move resource files to `core/resource/` and update their relative imports

- **Files**:
  - `src/query-v2/core/ResourceV2.ts` → `src/query-v2/core/resource/ResourceV2.ts`
  - `src/query-v2/core/ResourceV2Agent.ts` → `src/query-v2/core/resource/ResourceV2Agent.ts`
- **Action**: Move + Modify
- **Description**: Move both files into `core/resource/`. Update their relative imports:
  - **ResourceV2.ts** (8 relative imports change):
    - `./CacheEntry` → `../common/CacheEntry` (+ type import `CacheEntryOptions`)
    - `./CacheMap` → `../common/CacheMap` (+ type import `TCacheMapInstance`)
    - `./LifecycleHooks` → `../common/LifecycleHooks`
    - `./machines/Machine` → `../machines/Machine`
    - `./machines/MachineIdle` → `../machines/MachineIdle`
    - `./machines/MachineRefreshing` → `../machines/MachineRefreshing`
    - `./machines/MachineSuccess` → `../machines/MachineSuccess`
    - `./machines/MachineWithData` → `../machines/MachineWithData`
    - `./ResourceV2Agent` stays `./ResourceV2Agent` (same directory after move)
  - **ResourceV2Agent.ts** (2 relative imports change):
    - `./CacheEntry` → `../common/CacheEntry`
    - `./machines/Machine` → `../machines/Machine`
    - `./ResourceV2` stays `./ResourceV2` (same directory after move)
- **Design reference**: [ref: ../02-design/01-architecture.md §fix-3], [ref: ../01-research/01-codebase-analysis.md §3]
- **Complexity**: Medium

### Task 1.5: Update `core/index.ts` barrel

- **File**: `src/query-v2/core/index.ts`
- **Action**: Modify
- **Description**: Replace all 6 individual export statements with 3 sub-folder barrel re-exports:
  ```typescript
  export * from "./common";
  export * from "./machines";
  export * from "./resource";
  ```
  This preserves the exact same public export surface: `CacheEntry`, `CacheEntryOptions`, `CacheMap`, `TCacheMapInstance`, `LifecycleHooks`, `ResourceV2`, `ResourceV2Config`, `ResourceV2Agent`, plus all machine exports.
- **Design reference**: [ref: ../02-design/04-decisions.md ADR-2 §decision]
- **Complexity**: Low

### Task 1.6: Update absolute imports in modules outside `core/`

- **Files**:
  - `src/query-v2/api/createApi.ts` — line 1: `@/query-v2/core/ResourceV2` → `@/query-v2/core/resource/ResourceV2`
  - `src/query-v2/plugins/ReactHooksPlugin.ts` — line 5: `@/query-v2/core/ResourceV2` → `@/query-v2/core/resource/ResourceV2`
  - `src/query-v2/snapshot/Snapshot.ts` — line 4: `@/query-v2/core/ResourceV2` → `@/query-v2/core/resource/ResourceV2`
- **Action**: Modify
- **Description**: Three files outside `core/` use absolute imports to `@/query-v2/core/ResourceV2`. After the file moves to `core/resource/ResourceV2.ts`, these imports must be updated. Machine imports in `Snapshot.ts` (`@/query-v2/core/machines/Machine`, `@/query-v2/core/machines/MachineSuccess`) are unchanged since `machines/` does not move.
- **Design reference**: [ref: ../02-design/04-decisions.md ADR-2 §consequences — internal cross-imports need updating]
- **Complexity**: Low

### Task 1.7: Move co-located test files and update their imports

- **Files**:
  - `src/query-v2/core/CacheEntry.test.ts` → `src/query-v2/core/common/CacheEntry.test.ts`
  - `src/query-v2/core/CacheMap.test.ts` → `src/query-v2/core/common/CacheMap.test.ts`
- **Action**: Move + Modify
- **Description**: These tests are co-located next to their source files and must move with them. Update relative imports after move:
  - **CacheEntry.test.ts** (6 imports change):
    - `./CacheEntry` stays `./CacheEntry`
    - `./machines/MachineError` → `../machines/MachineError`
    - `./machines/MachineIdle` → `../machines/MachineIdle`
    - `./machines/MachinePending` → `../machines/MachinePending`
    - `./machines/MachineRefreshing` → `../machines/MachineRefreshing`
    - `./machines/MachineSuccess` → `../machines/MachineSuccess`
    - `./machines/MachineWithData` → `../machines/MachineWithData`
  - **CacheMap.test.ts** (2 imports change):
    - `./CacheEntry` stays `./CacheEntry`
    - `./CacheMap` stays `./CacheMap`
    - `./machines/Machine` → `../machines/Machine`
    - `./machines/MachineIdle` → `../machines/MachineIdle`
- **Design reference**: Addresses T18, T19
- **Complexity**: Low

### Task 1.8: Update imports in `core/__tests__/` test files

- **Files**:
  - `src/query-v2/core/__tests__/ResourceV2.test.ts`
  - `src/query-v2/core/__tests__/ResourceV2Agent.test.ts`
  - `src/query-v2/core/__tests__/LifecycleHooks.test.ts`
- **Action**: Modify
- **Description**: These test files use relative imports to source files. After source file moves, update only the affected relative paths:
  - **ResourceV2.test.ts** (1 import changes):
    - `../ResourceV2` → `../resource/ResourceV2`
    - All `../machines/*` imports stay unchanged (machines/ not moved)
  - **ResourceV2Agent.test.ts** (2 imports change):
    - `../ResourceV2` → `../resource/ResourceV2`
    - `../ResourceV2Agent` → `../resource/ResourceV2Agent`
  - **LifecycleHooks.test.ts** (2 imports change):
    - `../CacheEntry` → `../common/CacheEntry`
    - `../LifecycleHooks` → `../common/LifecycleHooks`
    - All `../machines/*` imports stay unchanged
- **Design reference**: Addresses T16, T17, T20
- **Complexity**: Low

## Verification

- [ ] `npm run ts-check` passes — all import paths resolve after file moves [mitigates R2]
- [ ] `vitest run src/query-v2/` — full test suite passes, all 8 machine tests unaffected (T21)
- [ ] `core/index.ts` barrel exports resolve: `ResourceV2`, `CacheEntry`, `CacheMap`, `LifecycleHooks`, `ResourceV2Agent` + all machine exports (T14)
- [ ] Cross-subfolder import works: `ResourceV2` imports `CacheEntry` from `../common/CacheEntry` (T15)
- [ ] Existing tests pass without assertion changes: ResourceV2.test.ts (T16), ResourceV2Agent.test.ts (T17), CacheEntry.test.ts (T18), CacheMap.test.ts (T19), LifecycleHooks.test.ts (T20)
- [ ] `query-v2/index.ts` barrel still exports all core symbols (T22)
- [ ] No circular dependencies between `common/` and `resource/` (architecture invariant)
