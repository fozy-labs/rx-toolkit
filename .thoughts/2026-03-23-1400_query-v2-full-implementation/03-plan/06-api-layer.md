---
title: "Phase 6: API Layer"
date: 2026-03-25
stage: 03-plan
role: rdpi-planner
---

## Goal

Implement the public API factory functions: `createApi` (main entry point), `createResourceV2` (standalone resource factory), and `hydrateSnapshot` (standalone SSR hydration). These are the user-facing factory layer above core.

## Dependencies

- **Requires**: Phase 5 (ResourceV2, Agent, Snapshot, core barrel)
- **Blocks**: Phase 7

## Execution

Sequential: `createResourceV2` standalone can be parallel with `hydrateSnapshot`, but `createApi` depends on both conceptually. Barrel last.

## Tasks

### Task 6.1: Create createApi factory

- **File**: `src/query-v2/api/createApi.ts`
- **Action**: Create
- **Complexity**: High
- **Description**: Implement `createApi` — the main entry point for creating a query API instance.
- **Details**:
  - **Signature**: `createApi<TPlugins extends readonly IPlugin[]>(options?: ICreateApiOptions<TPlugins>): IApi<TPlugins>`
  - **Options** (`ICreateApiOptions<TPlugins>`):
    - `keyPrefix?: string | null`
    - `keyStrategy?: "serialize" | "compare"`
    - `serializeArgs?: TSerializeArgsFn`
    - `compareArg?: TCompareArgsFn`
    - `cacheLifetime?: number`
    - `plugins?: TPlugins`
    - `initialSnapshot?: TApiSnapshot | null`
    - `maxSnapshotDataAge?: number`
    - `doCacheArgs?: boolean`
    - No `resources` parameter — resources are created imperatively via `createResourceV2()`
  - **Behavior**:
    - Creates an API instance that manages resources and plugins
    - If `initialSnapshot` provided, saves internally as `_savedSnapshot` (validates version and keyPrefix)
    - Tracks resources in internal `Map<string, ResourceV2>`
    - Plugin augmentations are type-level only — `PluginAugmentations<TPlugins, TArgs, TData>` conditional types spread methods onto resources created via `createResourceV2()`
  - **Returned API** (`IApi<TPlugins>`):
    - `createResourceV2<TArgs, TData>(options): IResourceV2<TArgs, TData> & PluginAugmentations<TPlugins, TArgs, TData>` — creates and registers a resource; if `_savedSnapshot` has a matching slice, hydrates entries and consumes the slice
    - `resetAll(): void` — resets all resources, sets `_savedSnapshot = null`
    - `getSnapshot(): TApiSnapshot` — captures snapshot of all resources (throws if `keyStrategy: "compare"`)
  - **Naming**: `createApi` — no V2 suffix (ADR-15)
  - [ref: ../02-design/03-model.md#§12, ../02-design/04-decisions.md#ADR-9, ADR-15]

### Task 6.2: Create createResourceV2 standalone factory

- **File**: `src/query-v2/api/createResourceV2.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Implement `createResourceV2` — standalone resource factory for use without `createApi`.
- **Details**:
  - **Signature**: `createResourceV2<TArgs, TData>(options: IResourceV2Options<TArgs, TData>): IResourceV2<TArgs, TData>`
  - Thin wrapper: creates a `ResourceV2` instance and returns it with the public interface
  - Provides `createAgent()` method that constructs a `ResourceV2Agent` with the resource's callbacks
  - For users who don't need the full API app with plugins/snapshot
  - [ref: ../02-design/03-model.md#§12.3]

### Task 6.3: Create hydrateSnapshot standalone function

- **File**: `src/query-v2/api/hydrateSnapshot.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Implement standalone `hydrateSnapshot` — SSR hydration without requiring internal API access.
- **Details**:
  - **Signature**: `hydrateSnapshot(api: IApi, snapshot: TApiSnapshot): void`
  - Delegates to core `hydrateSnapshot()` from Snapshot module
  - Validates that the api instance matches expected shape
  - Thin wrapper for ergonomic standalone import
  - [ref: ../02-design/03-model.md#§12.3, ../02-design/04-decisions.md#ADR-8]

### Task 6.4: Create API barrel export

- **File**: `src/query-v2/api/index.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Barrel re-export `createApi`, `createResourceV2`, `hydrateSnapshot`.
- **Details**:
  - [ref: ../02-design/01-architecture.md#§2]

### Task 6.5: Create API tests

- **File**: `src/query-v2/api/__tests__/createApi.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test API factory, resource creation, plugin integration, and snapshot API.
- **Details**:
  - AP01: `createApi(options)` returns API with createResourceV2, resetAll, getSnapshot
  - AP02: `api.createResourceV2(options)` validates unique key
  - AP03: `api.createResourceV2` merges API defaults with resource options
  - AP04: `api.createResourceV2` — resource inherits API-level options
  - AP05: `api.resetAll()` calls `resetCache()` on all registered resources and deletes `_savedSnapshot`
  - AP06: `api.getSnapshot(): TApiSnapshot` delegates to snapshot module
  - AP08: `createApi` saves `initialSnapshot`; `createResourceV2` consumes its slice
  - AP08a: `createResourceV2` without matching snapshot key — no hydration
  - AP08b: `api.resetAll()` deletes `_savedSnapshot` — subsequent `createResourceV2` sees no snapshot
  - AP08c: Snapshot data older than `maxSnapshotDataAge` triggers auto-invalidation on `createResourceV2`
  - AP09: `createApi` with empty options uses defaults
  - AP10: `createResourceV2` without key — still works (snapshot limited)
  - AP11: Standalone `createResourceV2` accepts standalone-level options
  - [ref: ../02-design/06-testcases.md#AP01–AP11]

### Task 6.6: Update module barrel

- **File**: `src/query-v2/index.ts`
- **Action**: Modify
- **Complexity**: Low
- **Description**: Add API layer re-exports.
- **Details**:
  - Re-export: `createApi`, `createResourceV2`, `hydrateSnapshot` (API-layer version with `(api: IApi, snapshot: TApiSnapshot) => void` signature — core-layer `hydrateSnapshot` stays internal-only per Phase 5 barrel exclusion, so no naming collision)
  - Keep existing types, lib, and core exports
  - [ref: ../02-design/01-architecture.md#§5]

## Verification

- [ ] `npm run ts-check` passes
- [ ] `npx vitest run src/query-v2/api/` — AP01–AP11 pass
- [ ] `createApi` returns correctly typed API object with plugin augmentations
- [ ] Plugin `Object.assign` merge doesn't overwrite core resource methods
- [ ] No imports from react/ or plugins/ layers within api/
