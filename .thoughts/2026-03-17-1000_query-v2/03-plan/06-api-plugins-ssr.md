---
title: "Phase 6: createApi + Plugin System + SSR Snapshots"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Implement the top-level API factory (`createApi`), the plugin system (`IPlugin`, `ReactHooksPlugin`), and the SSR snapshot layer (`getSnapshot`/`initialSnapshot` hydration). This phase completes all runtime functionality — after this phase, the entire query-v2 public API is usable.

## Dependencies

- **Requires**: Phase 4 (ResourceV2), Phase 5 (Agent — ReactHooksPlugin wraps Agent for hooks)
- **Blocks**: Phase 7 (Integration tests, barrel export)

## Execution

Sequential (depends on Phase 4 + 5).

## Tasks

### Task 6.1: Implement plugin types and runtime

- **Files** (all Create):
  - `src/query-v2/plugins/types.ts`
  - `src/query-v2/plugins/ReactHooksPlugin.ts`
- **Action**: Create
- **Description**: Implement the plugin interface and the `ReactHooksPlugin` that adds `useResourceV2Agent` and `useResourceV2Ref` hooks to resources.
- **Details**:
  - `plugins/types.ts`: `IPlugin` interface (`name`, `install(context)`, `augmentResource(resource, options)`), `IPluginContext` interface. Runtime types — not just TS types. [ref: ../02-design/03-model.md#1.9]
  - `ReactHooksPlugin` class:
    - `install(context)`: Store reference to plugin context for later use.
    - `augmentResource(resource, options)`: Return an object with `useResourceV2Agent` and `useResourceV2Ref` methods. [ref: ../02-design/03-model.md#1.10]
    - `useResourceV2Agent(args)`: React hook that creates an Agent via `useConstant(() => resource.createAgent())`, calls `agent.start(args)` on effect, returns `agent.state$()` via `useSignal` pattern. Follow existing patterns in `@/query/react/useResourceAgent.ts`. Uses `useConstant`, `useEventHandler` from `@/common/react/`. [ref: ../02-design/04-decisions.md#ADR-9]
    - `useResourceV2Ref(args)`: React hook returning `IResourceV2Ref` imperative handle — `has`, `lock()`, `invalidate()`, `createPatch()`, `create()`. Follow existing pattern in `@/query/react/useResourceRef.ts`. [ref: ../02-design/03-model.md#1.16]
  - **Type-level integration**: `ExtractPluginContributions` conditional type maps `ReactHooksPlugin` → `IReactHooksPluginContributions<TArgs, TData, TError>`. This is defined in `types/plugin.types.ts` (Phase 1) and wired at runtime here. [ref: ../02-design/04-decisions.md#ADR-1]
- **Complexity**: High

### Task 6.2: Implement SSR Snapshot layer

- **File**: `src/query-v2/snapshot/Snapshot.ts`
- **Action**: Create
- **Description**: Implement snapshot serialization (`getSnapshot`) and deserialization (hydration via `initialSnapshot`).
- **Details**:
  - **`getSnapshot(resources)`**: Iterates all registered resources, for each resource iterates CacheMap entries. Only `MachineSuccess` entries are captured. Produces `TApiSnapshot` with `version`, `keyPrefix`, and `resources` keyed by resource key. [ref: ../02-design/02-dataflow.md#5, ../02-design/03-model.md#1.11]
  - **`hydrateSnapshot(snapshot, api, resources)`**: Validates `version` (must match `CURRENT_SNAPSHOT_VERSION`), validates `keyPrefix` match. For each entry, calls `Machine.fromSnapshot(state)` → `MachineSuccess`. Populates CacheMap. If `Date.now() - updatedAt > maxSnapshotDataAge`, calls `resource.invalidate(args)` for stale entries. [ref: ../02-design/02-dataflow.md#5]
  - SSR snapshots require `keyStrategy: 'serialize'`. `getSnapshot()` with `compare` strategy throws a descriptive error (S6). [ref: ../02-design/04-decisions.md#ADR-3]
  - `CURRENT_SNAPSHOT_VERSION = 1` (integer counter per Q17).
  - `keyPrefix` mismatch: silent skip, not an error (S5).
  - `version` mismatch: skip hydration entirely (S4).
- **Complexity**: Medium

### Task 6.3: Implement createApi factory

- **File**: `src/query-v2/api/createApi.ts`
- **Action**: Create
- **Description**: Implement the `createApi` factory function — the top-level public API entry point.
- **Details**:
  - Accepts `ICreateApiOptions<TPlugins>`. [ref: ../02-design/03-model.md#1.1]
  - Returns `IApi<TPlugins>` with `createResource`, `resetAll`, `getSnapshot`.
  - **Plugin initialization**: Iterates `options.plugins`, calls `plugin.install({ api, keyStrategy })`. [ref: ../02-design/02-dataflow.md#6]
  - **`createResource(options)`**:
    1. Merge options: resource options override API defaults (cacheLifetime, serializeArgs, compareArg, doCacheArgs, maxSnapshotDataAge, beforeDevtoolsPush).
    2. Validate unique `key` (for `serialize` strategy, key is required; for `compare`, optional). Throw on duplicate. [ref: ../02-design/06-testcases.md#6 — API2]
    3. Create `ResourceV2` instance with merged options.
    4. Iterate plugins: `plugin.augmentResource(resource, options)` → spread returned properties onto resource. [ref: ../02-design/02-dataflow.md#6]
    5. Register resource in internal resource registry (for `resetAll` and `getSnapshot`).
    6. If `initialSnapshot` has data for this resource key, hydrate entries. [ref: ../02-design/02-dataflow.md#5]
    7. Return augmented resource typed as `IResourceV2 & PluginAugmentations<TPlugins>`.
  - **`resetAll()`**: Iterate all registered resources, call reset on each (all machines → MachineIdle, all caches cleared, all in-flight requests aborted). [ref: ../02-design/06-testcases.md#6 — API3]
  - **`getSnapshot()`**: Delegates to Snapshot.getSnapshot with registered resources. [ref: ../02-design/02-dataflow.md#5]
  - **ADR-6 forward-compatibility**: Internal resource registry uses a generic `Map` (not typed to resources only) so `createCommand` can be added later.
- **Complexity**: High

### Task 6.4: createApi, Plugin, and SSR tests

- **Files** (all Create):
  - `src/query-v2/api/createApi.test.ts`
  - `src/query-v2/plugins/ReactHooksPlugin.test.ts`
  - `src/query-v2/snapshot/Snapshot.test.ts`
- **Action**: Create
- **Description**: Tests for API factory, plugin system, and SSR snapshots.
- **Details**:
  - **createApi tests**: API1 (default options), API2 (unique key enforcement), API3 (resetAll), API4 (keyPrefix in devtools keys), API5 (default keyStrategy is serialize), API6 (compare strategy selects CompareCacheMap), API7 (per-resource options override). [ref: ../02-design/06-testcases.md#6]
  - **Plugin tests**: PL1 (ReactHooksPlugin adds useResourceV2Agent), PL2 (without plugin, hooks not present), PL3 (install called once), PL4 (augmentResource called per createResource), PL5 (multiple plugins compose contributions). [ref: ../02-design/06-testcases.md#8]
  - **PL6 (type test)**: Use `vitest` `expectTypeOf` to verify that `api.createResource(...)` with `ReactHooksPlugin` returns a type with `useResourceV2Agent` method, and without the plugin it does NOT. This validates ADR-1 plugin type system. [ref: ../02-design/06-testcases.md#8, ../02-design/08-risks.md#R1]
  - **ReactHooksPlugin hook tests**: Use `@testing-library/react` `renderHook` + `act`. Test that `useResourceV2Agent(args)` returns reactive state, updates on query resolution. Test `useResourceV2Ref(args)` returns imperative handle. Follow existing test patterns from `@/query/react/useResourceAgent.test.ts`.
  - **SSR tests**: S1 (getSnapshot captures only MachineSuccess), S2 (initialSnapshot hydrates), S3 (maxSnapshotDataAge triggers invalidation), S4 (version mismatch → skip), S5 (keyPrefix mismatch → skip), S6 (compare strategy throws on getSnapshot), S7 (round-trip: getSnapshot → initialSnapshot), S8 (Machine.fromSnapshot instanceof check). [ref: ../02-design/06-testcases.md#7]
  - **Devtools tests**: D1 (default beforeDevtoolsPush projects machine.state), D2 (custom beforeDevtoolsPush transforms), D3 (beforeDevtoolsPush suppression). [ref: ../02-design/06-testcases.md#10]
  - Type test for PL6 should use at least 2 plugins (ReactHooksPlugin + mock plugin) to validate TS2589 mitigation per R1. [ref: ../02-design/08-risks.md#R1]
- **Complexity**: High

### Task 6.5: Update index.ts barrel with full exports

- **File**: `src/query-v2/index.ts`
- **Action**: Modify
- **Description**: Update the barrel export file to include all public API exports defined in the architecture.
- **Details**:
  - Add exports: `createApi` from `./api/createApi`.
  - Add exports: `ReactHooksPlugin` from `./plugins/ReactHooksPlugin`.
  - Add exports: All machine classes from `./core/machines/Machine`.
  - Add exports: `Machine` namespace from `./core/machines/Machine`.
  - Verify all type exports match architecture §7. [ref: ../02-design/01-architecture.md#7]
  - Do NOT add to `src/index.ts` yet (that's Phase 7).
- **Complexity**: Low

## Verification

- [ ] `npm run ts-check` passes
- [ ] All 7 createApi test cases (API1–API7) pass
- [ ] All 6 plugin test cases (PL1–PL6) pass, including type test with 2 plugins
- [ ] All 8 SSR test cases (S1–S8) pass
- [ ] Devtools tests D1–D3 pass
- [ ] ReactHooksPlugin `useResourceV2Agent` renders correctly via `renderHook`
- [ ] `useResourceV2Ref` provides imperative handle
- [ ] Plugin type system: resource with ReactHooksPlugin has hook methods, resource without does not
- [ ] SSR round-trip: `getSnapshot()` → `initialSnapshot` produces identical data
- [ ] Stale snapshot entries trigger `MachineRefreshing` (invalidation on hydration)
- [ ] `compare` strategy + `getSnapshot()` throws descriptive error
- [ ] No TS2589 errors with ReactHooksPlugin + mock plugin
- [ ] No imports from `src/query/`
