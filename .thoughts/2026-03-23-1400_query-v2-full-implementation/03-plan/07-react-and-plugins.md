---
title: "Phase 7: React & Plugins Layers"
date: 2026-03-25
stage: 03-plan
role: rdpi-planner
---

## Goal

Implement the React hook layer (`useResourceV2Agent`) and the built-in `ReactHooksPlugin` that auto-attaches the hook to resources created via `createApi`. This completes the runtime feature set.

## Dependencies

- **Requires**: Phase 6 (API layer — createApi, plugin infrastructure)
- **Blocks**: Phase 8

## Execution

Sequential: react layer first (useResourceV2Agent), then plugins layer (ReactHooksPlugin depends on the hook).

## Tasks

### Task 7.1: Create useResourceV2Agent hook

- **File**: `src/query-v2/react/useResourceV2Agent.ts`
- **Action**: Create
- **Complexity**: High
- **Description**: Implement `useResourceV2Agent` — React hook for observing a resource entry via an agent.
- **Details**:
  - **Signature**: `useResourceV2Agent<TArgs, TData>(resource: IResourceV2, args: ArgsOrVoidOrSkip<TArgs>): IResourceV2AgentState<TArgs, TData>`
  - **Behavior**:
    - Creates a `ResourceV2Agent` (via `resource.createAgent()`) and stores it as a stable ref
    - Calls `agent.start(args)` on each render / when args change
    - Uses `useSyncExternalStore` for tear-free integration with React concurrent mode
    - The `subscribe` callback connects to agent's `state$` signal
    - The `getSnapshot` callback returns `agent.state$()` (non-reactive peek for useSyncExternalStore)
    - Triggers query on mount / args change (delegated to `agent.start`)
    - No explicit `destroy()` — Agent lifecycle is managed by ResourceV2
  - Uses `useConstant` from `@/common/react` for stable agent reference
  - Uses `useEventHandler` from `@/common/react` for stable callbacks
  - SKIP token support: passing `SKIP` as args disconnects observation
  - [ref: ../02-design/03-model.md#§14, ../02-design/04-decisions.md#ADR-7]

### Task 7.2: Create react barrel export

- **File**: `src/query-v2/react/index.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Barrel re-export `useResourceV2Agent`.
- **Details**:
  - [ref: ../02-design/01-architecture.md#§2]

### Task 7.3: Create ReactHooksPlugin

- **File**: `src/query-v2/plugins/ReactHooksPlugin.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Implement `ReactHooksPlugin` — built-in plugin that adds `useResourceV2Agent` as a method on resources.
- **Details**:
  - Implements `IPlugin` interface
  - **`augmentResource<TArgs, TData>(resource: IResourceV2<TArgs, TData>, options: IResourceV2Options<TArgs, TData>)`**: returns `IReactHooksPluginContributions<TArgs, TData>` — adds `useResourceV2Agent` method to the resource:
    - The contributed method is `(...args: ArgsOrVoidOrSkip<TArgs>) => useResourceV2Agent(resource, args)`
    - Pre-binds the resource parameter so users call `todosResource.useResourceV2Agent(args)` (where `todosResource = api.createResourceV2({...})`)
  - Type-level: `IReactHooksPluginContributions<TArgs, TData>` defines `useResourceV2Agent` on augmented resources
  - `PluginAugmentations<[ReactHooksPlugin], TArgs, TData>` (3 type params) maps to `IReactHooksPluginContributions<TArgs, TData>` via conditional type
  - Merge strategy: `Object.assign` — plugin adds method to resource instance
  - [ref: ../02-design/03-model.md#§11.1, ../02-design/04-decisions.md#ADR-9]

### Task 7.4: Create plugins barrel export

- **File**: `src/query-v2/plugins/index.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Barrel re-export `ReactHooksPlugin`.
- **Details**:
  - [ref: ../02-design/01-architecture.md#§2]

### Task 7.5: Create useResourceV2Agent tests

- **File**: `src/query-v2/react/__tests__/useResourceV2Agent.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test React hook integration with resource agent.
- **Details**:
  - RH01: `useResourceV2Agent(resource, args)` — renders with pending, then success
  - RH02: `useResourceV2Agent(resource, SKIP)` — idle state, no fetch
  - RH03: `useResourceV2Agent` — args change triggers new fetch + SWR
  - RH04: `useResourceV2Agent` — unmount cleans up agent/subscription
  - RH05: `useResourceV2Agent` — same args on rerender: no re-fetch
  - RH06: `useResourceV2Agent` void args — no second argument
  - RH07: Multiple components sharing same resource/args — single fetch
  - RH08: `useSyncExternalStore` tearing protection
  - RH09: Error boundary: hook does not throw on error state
  - RH10: Rapid unmount/remount — no stale callbacks
  - Uses `@testing-library/react` renderHook, act
  - Uses `createControllableObservable` from test helpers
  - [ref: ../02-design/06-testcases.md#RH01–RH10]

### Task 7.6: Create ReactHooksPlugin tests

- **File**: `src/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test plugin augmentation and integration with createApi.
- **Details**:
  - PL01: `plugin.install(context)` called during `createApi()`
  - PL02: `plugin.augmentResource(resource, options)` called per `createResourceV2()`
  - PL03: Contributions merged via Object.assign onto resource
  - PL04: Plugin install called in registration order
  - PL05: Key collision detection: throws on duplicate contribution keys
  - PL06: ReactHooksPlugin contributes `useResourceV2Agent` method to resource instances via `augmentResource()`
  - PL07: Plugin error in `install` propagates
  - PL08: Plugin error in `augmentResource` propagates
  - PL11: Later plugin's `augmentResource` can access earlier plugin's contributions on the resource object
  - [ref: ../02-design/06-testcases.md#PL01–PL08, PL11]

### Task 7.7: Create ReactHooksPlugin type-level tests

- **File**: `src/query-v2/plugins/__tests__/ReactHooksPlugin.test-d.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Type-level tests for plugin augmentation generics.
- **Details**:
  - PL09: `PluginAugmentations<[ReactHooksPlugin], TArgs, TData>` resolves to `IReactHooksPluginContributions<TArgs, TData>` at compile time
  - PL10: `PluginAugmentations` rejects invalid plugin access at compile time
  - Uses `expectTypeOf` from vitest for type-level assertions
  - [ref: ../02-design/06-testcases.md#PL09–PL10]

### Task 7.8: Update module barrel

- **File**: `src/query-v2/index.ts`
- **Action**: Modify
- **Complexity**: Low
- **Description**: Add react and plugins layer re-exports.
- **Details**:
  - Re-export: `useResourceV2Agent` from react/
  - Re-export: `ReactHooksPlugin` from plugins/
  - Keep existing types, lib, core, and api exports
  - [ref: ../02-design/01-architecture.md#§5]

## Verification

- [ ] `npm run ts-check` passes
- [ ] `npx vitest run src/query-v2/react/` — RH01–RH10 pass
- [ ] `npx vitest run src/query-v2/plugins/` — PL01–PL11 pass (including type-level)
- [ ] `useResourceV2Agent` uses `useSyncExternalStore` (not `useState`/`useEffect`)
- [ ] Plugin augmentation is type-safe via `PluginAugmentations` conditional types (not `declare module`)
- [ ] React layer only imports from core and common/react — not from api/ or plugins/
