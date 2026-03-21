---
title: "Phase 1: Foundation — Types, Tokens, Utilities"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Establish the type foundation and utility modules for the entire query-v2 module. After this phase, all interfaces, type aliases, sentinel values, and shared utilities are available for subsequent phases to import. No runtime logic beyond simple token definitions.

## Dependencies

- **Requires**: None
- **Blocks**: Phase 2 (State Machines), Phase 3 (Cache Layer)

## Execution

Sequential (first phase — no parallelization possible).

## Tasks

### Task 1.1: Create type definition files

- **Files** (all Create):
  - `src/query-v2/types/index.ts`
  - `src/query-v2/types/shared.types.ts`
  - `src/query-v2/types/machine.types.ts`
  - `src/query-v2/types/cache.types.ts`
  - `src/query-v2/types/resource.types.ts`
  - `src/query-v2/types/agent.types.ts`
  - `src/query-v2/types/api.types.ts`
  - `src/query-v2/types/plugin.types.ts`
  - `src/query-v2/types/snapshot.types.ts`
  - `src/query-v2/types/lifecycle.types.ts`
- **Action**: Create
- **Description**: Create all type definition files based on the domain model. Each file defines the interfaces and type aliases specified in the design. `index.ts` is the barrel re-export.
- **Details**:
  - `shared.types.ts`: `Prettify<T>` utility type, `TSerializeArgsFn`, `TCompareArgsFn`, `TBeforeDevtoolsPushFn`, `TQueryFn`, `TQueryFnTools`, `NO_VALUE` type alias (the type, not the runtime value). [ref: ../02-design/03-model.md#1.14, #1.15]
  - `machine.types.ts`: `TMachine<TData, TError>` union type, `TMachineStatus`, all 5 state shape interfaces (`TResourceV2IdleState`, `TResourceV2PendingState`, `TResourceV2SuccessState`, `TResourceV2ErrorState`, `TResourceV2RefreshingState`), `TResourceV2Patch`, `TPatchFn`. [ref: ../02-design/03-model.md#1.3, #1.8]
  - `cache.types.ts`: `ICacheEntry<TData, TError>`, `ICacheMap<TArgs, TData, TError>`, `ICacheMapOptions<TArgs>`. [ref: ../02-design/03-model.md#1.5, #1.6]
  - `resource.types.ts`: `IResourceV2Options<TArgs, TData, TError>`, `IResourceV2<TArgs, TData, TError>`. [ref: ../02-design/03-model.md#1.2]
  - `agent.types.ts`: `IResourceV2Agent<TArgs, TData, TError>`, `IResourceV2AgentState<TArgs, TData, TError>`, `IResourceV2Ref<TArgs, TData, TError>`. [ref: ../02-design/03-model.md#1.7, #1.16]
  - `api.types.ts`: `ICreateApiOptions<TPlugins>`, `IApi<TPlugins>`. [ref: ../02-design/03-model.md#1.1]
  - `plugin.types.ts`: `IPlugin`, `IPluginContext`, `PluginAugmentations<TPlugins, TArgs, TData, TError>`, `ExtractPluginContributions`. Note: `PluginAugmentations` uses `UnionToIntersection` + `Prettify` as per ADR-1. [ref: ../02-design/03-model.md#1.9, ../02-design/04-decisions.md#ADR-1]
  - `snapshot.types.ts`: `TApiSnapshot`, `TResourceSnapshot`, `TResourceV2SnapshotSlice`. [ref: ../02-design/03-model.md#1.11]
  - `lifecycle.types.ts`: `TOnCacheEntryAdded`, `TOnQueryStarted`, `TCacheEntryAddedTools`, `TQueryStartedTools`. [ref: ../02-design/03-model.md#1.13]
  - `index.ts`: Barrel re-export from all type files.
  - **Important**: `TMachine` union type in `machine.types.ts` should forward-declare the class names (e.g., `import type { MachineIdle } from '../core/machines/MachineIdle'`). Since the classes don't exist yet, use the type-only import — the classes will be created in Phase 2. Alternatively, define `TMachine` as a union of the state shapes initially, and refine to class types in Phase 2. Choose whichever approach compiles cleanly.
- **Complexity**: Medium

### Task 1.2: Create SKIP_TOKEN and NO_VALUE tokens

- **Files** (all Create):
  - `src/query-v2/lib/SKIP_TOKEN.ts`
  - `src/query-v2/lib/NO_VALUE.ts`
- **Action**: Create
- **Description**: Implement the two sentinel symbols used throughout the module.
- **Details**:
  - `SKIP_TOKEN.ts`: Export `const SKIP: unique symbol = Symbol('SKIP')` and `type SKIP_TOKEN = typeof SKIP`. [ref: ../02-design/03-model.md#1.12]
  - `NO_VALUE.ts`: Export `const NO_VALUE: unique symbol = Symbol('NO_VALUE')` and `type NO_VALUE = typeof NO_VALUE`. [ref: ../02-design/03-model.md#1.12]
  - Follow the pattern of existing `@/query/SKIP_TOKEN.ts` in the v1 module.
- **Complexity**: Low

### Task 1.3: Create stableStringify utility

- **File**: `src/query-v2/lib/stableStringify.ts`
- **Action**: Create
- **Description**: Implement a deterministic JSON.stringify that sorts object keys for stable cache key generation.
- **Details**:
  - Must recursively sort object keys before stringifying.
  - Used as the default `serializeArgs` function for the `serialize` key strategy.
  - Reference the external research: [ref: ../01-research/03-external-research.md#5.1]
  - Must handle: plain objects, arrays, primitives, null, nested structures. Does NOT need to handle Date, Map, Set, RegExp (documented limitation per UC-9).
  - Check if a suitable implementation exists in `src/common/utils/` before creating — if so, re-export it instead.
- **Complexity**: Low

### Task 1.4: Create stub index.ts barrel

- **File**: `src/query-v2/index.ts`
- **Action**: Create
- **Description**: Create the public barrel export file with placeholder exports. Initially exports only types, tokens, and utilities available from this phase.
- **Details**:
  - Export `SKIP`, `SKIP_TOKEN` from `./lib/SKIP_TOKEN`
  - Export `NO_VALUE` from `./lib/NO_VALUE`
  - Export all types from `./types`
  - Remaining exports (machine classes, createApi, plugins) will be added in later phases.
  - This ensures the module is importable and compilable from Phase 1 onward. [ref: ../02-design/01-architecture.md#7]
- **Complexity**: Low

## Verification

- [ ] `npm run ts-check` passes with all new type files
- [ ] All type interfaces match the design model definitions (spot-check `TMachine`, `ICreateApiOptions`, `IResourceV2`, `PluginAugmentations`)
- [ ] `SKIP` and `NO_VALUE` are `unique symbol` types — `SKIP === SKIP` is `true`, `SKIP === Symbol('other')` is `false`
- [ ] `stableStringify({ b: 2, a: 1 })` === `stableStringify({ a: 1, b: 2 })` (key order independence)
- [ ] `src/query-v2/index.ts` is importable without errors
- [ ] No imports from `src/query/` exist in any created file
