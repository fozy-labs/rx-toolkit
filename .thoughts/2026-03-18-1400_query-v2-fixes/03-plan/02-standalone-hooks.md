---
title: "Phase 2: Standalone Hooks + React Folder"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Extract React hooks from `ReactHooksPlugin` into standalone functions in a new `react/` directory. Refactor `ReactHooksPlugin.augmentResource` into a thin delegation wrapper. Both standalone and plugin call paths produce identical behavior. [ref: ../02-design/04-decisions.md ADR-1]

## Dependencies

- **Requires**: Phase 1 (Core Split) — standalone hooks import `ResourceV2` from the new `core/resource/` path; `ReactHooksPlugin` import path was already updated in Phase 1
- **Blocks**: Phase 3A (DevTools), Phase 3B (Snapshot Errors), Phase 4A (JSDoc), Phase 4B (Docs)

## Execution

Sequential — must complete after Phase 1 and before Phase 3.

## Tasks

### Task 2.1: Create `react/useResourceV2Agent.ts` standalone hook

- **File**: `src/query-v2/react/useResourceV2Agent.ts`
- **Action**: Create
- **Description**: Create standalone hook function with `resource` as explicit first parameter. Extract the following from `@/query-v2/plugins/ReactHooksPlugin.ts`:
  - `useResourceV2Agent` function body (lines ~53–90 of current plugin)
  - `compareArgs` helper function (used for arg diffing via `React.useRef`)
  - Signature: `useResourceV2Agent<TArgs, TData, TError>(resource: ResourceV2<TArgs, TData, TError>, args: TArgs | SKIP_TOKEN): IResourceV2AgentState<TArgs, TData, TError>`
  - Imports needed: `React` (from "react"), `useConstant` (from `@/common/react/useConstant`), `useSignal` (from `@/signals/react/useSignal`), `SKIP`/`SKIP_TOKEN` (from `@/query-v2/lib/SKIP_TOKEN`), `ResourceV2` (from `@/query-v2/core/resource/ResourceV2`), `IResourceV2AgentState` (from `@/query-v2/types/agent.types`), `shallowEqual` (from `@/common/utils/shallowEqual`)
- **Design reference**: [ref: ../02-design/04-decisions.md ADR-1 §decision], [ref: ../02-design/01-architecture.md §fix-1-2], [ref: ../02-design/02-dataflow.md §1-standalone-hook-lifecycle]
- **Complexity**: Medium

### Task 2.2: Create `react/useResourceV2Ref.ts` standalone hook

- **File**: `src/query-v2/react/useResourceV2Ref.ts`
- **Action**: Create
- **Description**: Create standalone hook function with `resource` as explicit first parameter. Extract the following from `@/query-v2/plugins/ReactHooksPlugin.ts`:
  - `useResourceV2Ref` function body (lines ~91–130 of current plugin)
  - `createRefHandle` helper function (creates `IResourceV2Ref` from cache entry)
  - `createSkippedRef` helper function (returns ref with `has: false`, no-op methods)
  - Signature: `useResourceV2Ref<TArgs, TData, TError>(resource: ResourceV2<TArgs, TData, TError>, args: TArgs | SKIP_TOKEN): IResourceV2Ref<TArgs, TData, TError>`
  - Imports needed: `React` (from "react"), `useConstant` (from `@/common/react/useConstant`), `SKIP`/`SKIP_TOKEN` (from `@/query-v2/lib/SKIP_TOKEN`), `ResourceV2` (from `@/query-v2/core/resource/ResourceV2`), `IResourceV2Ref` (from `@/query-v2/types/agent.types`), `TPatchFn` (from `@/query-v2/types/machine.types`), `shallowEqual` (from `@/common/utils/shallowEqual`)
- **Design reference**: [ref: ../02-design/04-decisions.md ADR-1 §decision], [ref: ../02-design/03-model.md §3-standalone-hooks-relationship]
- **Complexity**: Medium

### Task 2.3: Create `react/index.ts` barrel

- **File**: `src/query-v2/react/index.ts`
- **Action**: Create
- **Description**: Barrel re-exporting both standalone hooks:
  - `export { useResourceV2Agent } from "./useResourceV2Agent";`
  - `export { useResourceV2Ref } from "./useResourceV2Ref";`
- **Design reference**: [ref: ../02-design/01-architecture.md §fix-1-2 — new files table]
- **Complexity**: Low

### Task 2.4: Refactor `ReactHooksPlugin.ts` to delegate to standalone hooks

- **File**: `src/query-v2/plugins/ReactHooksPlugin.ts`
- **Action**: Modify
- **Description**: Remove all hook implementation code and helper functions (`useResourceV2Agent`, `useResourceV2Ref`, `compareArgs`, `createRefHandle`, `createSkippedRef`). Replace with imports from `@/query-v2/react/` and thin delegation:
  - Add imports: `import { useResourceV2Agent } from "@/query-v2/react/useResourceV2Agent";` and `import { useResourceV2Ref } from "@/query-v2/react/useResourceV2Ref";`
  - Remove imports no longer needed: `React`, `useConstant`, `shallowEqual`, `useSignal`, `ReadableSignalLike`, `SKIP`/`SKIP_TOKEN`, `TPatchFn`, `IResourceV2AgentState`, `IResourceV2Ref`
  - `augmentResource(res, _options)` body becomes:
    ```typescript
    return {
        useResourceV2Agent: (args) => useResourceV2Agent(res, args),
        useResourceV2Ref: (args) => useResourceV2Ref(res, args),
    };
    ```
  - Keep: `IReactHooksPluginContributions` interface, `ReactHooksPlugin` class shell, `install` method, declaration merging block, `IPlugin`/`IPluginContext`/`IResourceV2Options` type imports
- **Design reference**: [ref: ../02-design/02-dataflow.md §2-plugin-hook-lifecycle], [ref: ../02-design/04-decisions.md ADR-1 §consequences — plugin becomes thin wrapper]
- **Complexity**: Medium

### Task 2.5: Update `query-v2/index.ts` barrel to re-export from `react/`

- **File**: `src/query-v2/index.ts`
- **Action**: Modify
- **Description**: Add re-export of standalone hooks from the new `react/` module. Add after the existing Plugins section:
  - `export { useResourceV2Agent, useResourceV2Ref } from "./react";`
- **Design reference**: [ref: ../02-design/01-architecture.md §fix-1-2 — modified files table]
- **Complexity**: Low

### Task 2.6: Create standalone hook unit tests

- **Files**:
  - `src/query-v2/react/__tests__/useResourceV2Agent.test.ts`
  - `src/query-v2/react/__tests__/useResourceV2Ref.test.ts`
- **Action**: Create
- **Description**: Create test files for standalone hooks covering test cases T1–T7:
  - **useResourceV2Agent.test.ts** (T1–T5):
    - T1: Renders with resource + args, returns reactive `IResourceV2AgentState` with `status === "success"` after queryFn resolves
    - T2: With `SKIP` — state is `{ status: "idle", data: null }`, queryFn not called
    - T3: Args change triggers re-query (render with args₁, re-render with args₂)
    - T4: SKIP → real args triggers `agent.start`, state transitions idle → pending → success
    - T5: Same args on re-render is no-op (queryFn called once)
  - **useResourceV2Ref.test.ts** (T6–T7):
    - T6: Returns `IResourceV2Ref` with correct shape (`has`, `lock`, `invalidate`, `createPatch`, `create`)
    - T7: With `SKIP` returns skipped ref (`has === false`, `createPatch` returns `null`)
  - Tests should use `@testing-library/react` `renderHook` and mock `ResourceV2` with controlled `queryFn`
- **Design reference**: [ref: ../02-design/06-testcases.md §fix-1-2], addresses T1–T7
- **Complexity**: High

### Task 2.7: Verify and update existing plugin/integration tests

- **Files**:
  - `src/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts`
  - `src/query-v2/__tests__/integration/plugin-augmentation.test.ts`
- **Action**: Modify (if needed)
- **Description**: Run existing tests. If they fail due to `ReactHooksPlugin` internal refactoring, update:
  - `ReactHooksPlugin.test.ts`: Verify `augmentResource` still returns `{ useResourceV2Agent, useResourceV2Ref }` as functions. Tests PL1-PL4 should pass since the external contract is unchanged. May need import adjustments if the test directly imports helpers that were moved.
  - `plugin-augmentation.test.ts`: Imports use absolute paths (`@/query-v2/plugins/ReactHooksPlugin`, `@/query-v2/api/createApi`) which are unchanged. Test behavior should be identical since plugin delegation is transparent.
  - If tests pass without modification, this task is a no-op verification.
- **Design reference**: [ref: ../02-design/08-risks.md R3 — plugin backward compatibility], addresses T8–T13
- **Complexity**: Low

## Verification

- [ ] `npm run ts-check` passes — new `react/` module compiles, `ReactHooksPlugin` delegation compiles
- [ ] `vitest run src/query-v2/react/` — all new standalone hook tests pass (T1–T7)
- [ ] `vitest run src/query-v2/plugins/` — existing plugin tests pass without changes (T10–T11, part of T12)
- [ ] `vitest run src/query-v2/__tests__/integration/plugin-augmentation.test.ts` — plugin augmentation integration passes (T8, T9, T12, T13)
- [ ] Plugin path and standalone path produce identical results: `resource.useResourceV2Agent(args)` delegates to `useResourceV2Agent(resource, args)` [mitigates R3]
- [ ] `vitest run src/query-v2/` — full regression suite green [mitigates R7]
