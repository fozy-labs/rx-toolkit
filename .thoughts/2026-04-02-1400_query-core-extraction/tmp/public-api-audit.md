---
title: "Query Module Public API — Codebase Analysis"
date: 2026-04-02
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

The query module (`src/query/index.ts`) exposes a curated public surface of ~80 named exports (types + values), re-exported unchanged through `src/index.ts`. Internal implementation classes (CacheEntry, CacheMap, Resource, Command, etc.) live in `core/` but are **not** surfaced through the barrel. The `types/index.ts` barrel uses `export *` from all type files, but the query barrel cherry-picks only consumer-facing types, deliberately excluding cache infrastructure types.

## Findings

### 1. Root re-export chain

- **Location**: `@/src/index.ts:1-8`
- **What it does**: `export * from "./query"` — the entire public surface of the query module is forwarded verbatim to the package root.
- **Implication**: Every export in `src/query/index.ts` IS the public API. Nothing is added or filtered at root level.

### 2. `src/query/index.ts` — Complete export inventory

#### Value exports

| Export | Source | Classification |
|--------|--------|----------------|
| `SKIP` | `./lib/SKIP_TOKEN` | PUBLIC — sentinel token for skipping queries |
| `stableStringify` | `./lib` | PUBLIC — utility for manual arg serialization |
| `CURRENT_SNAPSHOT_VERSION` | `./types` (snapshot.types) | PUBLIC — snapshot format version constant |
| `Machine` | `./core/machines` | PUBLIC — machine factory class |
| `MachinePending` | `./core/machines` | PUBLIC — concrete machine state class |
| `MachineSuccess` | `./core/machines` | PUBLIC — concrete machine state class |
| `MachineError` | `./core/machines` | PUBLIC — concrete machine state class |
| `MachineRefreshing` | `./core/machines` | PUBLIC — concrete machine state class |
| `MachineWithData` | `./core/machines` | PUBLIC — abstract class for success/refreshing |
| `Patcher` | `./core/machines` | PUBLIC — immer-based patch utility |
| `CommandIdle` | `./core/machines` | PUBLIC — command machine state class |
| `CommandLoading` | `./core/machines` | PUBLIC — command machine state class |
| `CommandSuccess` | `./core/machines` | PUBLIC — command machine state class |
| `CommandError` | `./core/machines` | PUBLIC — command machine state class |
| `createApi` | `./api` | PUBLIC — main API factory |
| `commandLink` | `./api` | PUBLIC — helper to create type-erased command links |
| `useResourceAgent` | `./react` | PUBLIC — React hook |
| `useCommandAgent` | `./react` | PUBLIC — React hook |
| `ReactHooksPlugin` | `./plugins` | PUBLIC — React integration plugin |

#### Type exports (explicit named)

| Export | Source file | Classification |
|--------|------------|----------------|
| `SKIP_TOKEN` | `./lib/SKIP_TOKEN` | PUBLIC — type of SKIP sentinel |
| `TMachineStatus` | machine.types | PUBLIC — `"pending" \| "success" \| "error" \| "refreshing"` |
| `TPatchStatus` | machine.types | PUBLIC — `"pending" \| "committed" \| "aborted"` |
| `TPatch` | machine.types | PUBLIC — single immer patch record |
| `TPatchState` | machine.types | PUBLIC — grouped patch lifecycle state |
| `TPendingState` | machine.types | PUBLIC — machine state discriminant |
| `TSuccessState` | machine.types | PUBLIC — machine state discriminant |
| `TErrorState` | machine.types | PUBLIC — machine state discriminant |
| `TRefreshingState` | machine.types | PUBLIC — machine state discriminant |
| `TMachineState` | machine.types | PUBLIC — union of all 4 machine states |
| `TMachineInstance` | machine.types | PUBLIC — alias for TMachineState |
| `TMachineWithData` | machine.types | PUBLIC — alias for `MachineWithData` type (renamed on export) |
| `IPatchHandle` | machine.types | PUBLIC — { commit, abort } handle |
| `CreatePatchResult` | machine.types | PUBLIC — result of MachineWithData.createPatch |
| `IMachineStatic` | machine.types | PUBLIC — Machine static factory interface |
| `TQueryFn` | resource.types | PUBLIC — resource query function signature |
| `TSerializeArgsFn` | resource.types | PUBLIC — args serializer |
| `TCompareArgsFn` | resource.types | PUBLIC — args comparator |
| `TResourceOptions` | resource.types | PUBLIC — createResource options |
| `IResource` | resource.types | PUBLIC — resource instance interface |
| `IResourceCacheEntry` | resource.types | PUBLIC — consumer-facing cache entry |
| `TResourceAgentState` | agent.types | PUBLIC — resource agent's reactive state |
| `IResourceAgent` | agent.types | PUBLIC — resource agent interface |
| `ICacheEntryAddedTools` | lifecycle.types | PUBLIC — onCacheEntryAdded callback tools |
| `IQueryStartedTools` | lifecycle.types | PUBLIC — onQueryStarted callback tools |
| `TOnCacheEntryAdded` | lifecycle.types | PUBLIC — callback type |
| `TOnQueryStarted` | lifecycle.types | PUBLIC — callback type |
| `TResourceSnapshotSlice` | snapshot.types | PUBLIC — single resource snapshot entry |
| `TResourceSnapshot` | snapshot.types | PUBLIC — per-resource snapshot |
| `TApiSnapshot` | snapshot.types | PUBLIC — full API snapshot |
| `IPluginContext` | plugin.types | PUBLIC — plugin install context |
| `IPlugin` | plugin.types | PUBLIC — plugin interface |
| `IReactHooksPluginContributions` | plugin.types | PUBLIC — React plugin resource augmentations |
| `PluginResourceContributions` | plugin.types | PUBLIC — maps plugin → resource methods |
| `PluginAugmentations` | plugin.types | PUBLIC — merges all plugin resource contributions |
| `TCommandMachineStatus` | command-machine.types | PUBLIC — `"idle" \| "loading" \| "success" \| "error"` |
| `TCommandIdleState` | command-machine.types | PUBLIC — command state discriminant |
| `TCommandLoadingState` | command-machine.types | PUBLIC — command state discriminant |
| `TCommandSuccessState` | command-machine.types | PUBLIC — command state discriminant |
| `TCommandErrorState` | command-machine.types | PUBLIC — command state discriminant |
| `TCommandMachineState` | command-machine.types | PUBLIC — union of all 4 command states |
| `TCommandMachineInstance` | command-machine.types | PUBLIC — union of command machine class instances |
| `ICommandCacheEntryAddedTools` | command-lifecycle.types | PUBLIC — command lifecycle callback tools |
| `ICommandQueryStartedTools` | command-lifecycle.types | PUBLIC — command lifecycle callback tools |
| `TOnCommandCacheEntryAdded` | command-lifecycle.types | PUBLIC — callback type |
| `TOnCommandQueryStarted` | command-lifecycle.types | PUBLIC — callback type |
| `TCommandQueryFn` | command.types | PUBLIC — command query function signature |
| `ICommandLinkOptions` | command.types | PUBLIC — link definition interface |
| `CommandLink` | command.types | PUBLIC — type-erased link |
| `TCommandOptions` | command.types | PUBLIC — createCommand options |
| `ICommand` | command.types | PUBLIC — command instance interface |
| `IResourceRef` | command.types | PUBLIC — resource adapter for patching |
| `TCommandAgentState` | command.types | PUBLIC — command agent reactive state |
| `ICommandAgent` | command.types | PUBLIC — command agent interface |
| `IReactHooksPluginCommandContributions` | plugin.types | PUBLIC — React plugin command augmentations |
| `PluginCommandContributions` | plugin.types | PUBLIC — maps plugin → command methods |
| `PluginCommandAugmentations` | plugin.types | PUBLIC — merges all plugin command contributions |
| `ArgsOrVoid` | shared.types | PUBLIC — utility type |
| `ArgsOrVoidOrSkip` | shared.types | PUBLIC — utility type |
| `Prettify` | shared.types | PUBLIC — type-level utility |
| `UnionToIntersection` | shared.types | PUBLIC — type-level utility |

### 3. `types/index.ts` barrel vs query barrel filtering

- **Location**: `@/src/query/types/index.ts:1-12`
- **What it does**: Uses `export *` from all 12 type files — this means the `types/` barrel exports EVERYTHING including internal types.
- **Key observation**: `src/query/index.ts` uses explicit named imports from `./types`, NOT `export * from "./types"`. This is a deliberate filter.

#### Types exported from `types/index.ts` but NOT from `src/query/index.ts` (INTERNAL):

| Type | Source file | Classification |
|------|------------|----------------|
| `ICacheEntry` | cache.types | INTERNAL — low-level reactive container interface |
| `ICacheEntryOptions` | cache.types | INTERNAL — CacheEntry constructor options |
| `ICacheMap` | cache.types | INTERNAL — generic cache storage interface |
| `TCacheMapFactory` | cache.types | INTERNAL — CacheMap factory function type |
| `ICacheMapOptions` | cache.types | INTERNAL — CacheMap config |
| `IPatchResolution` | machines/Patcher.ts | INTERNAL — exported from core but NOT from query barrel |

### 4. CacheEntry, ResourceCacheEntry, CommandCacheEntry

#### `CacheEntry` (class)
- **Location**: `@/src/query/core/CacheEntry.ts`
- **Exported from**: `core/index.ts` — YES
- **Exported from**: `src/query/index.ts` — **NO**
- **Classification**: INTERNAL — implementation class, not part of public API
- **Public interface**: Only its interface `ICacheEntry` (from cache.types) is available, and even that is NOT re-exported from the query barrel. Consumers interact with it only through `IResourceCacheEntry` which extends `ICacheEntry`.

#### `ResourceCacheEntry` (class)
- **Location**: `@/src/query/core/resource/` (exported from `core/index.ts`)
- **Exported from**: `core/index.ts` — YES
- **Exported from**: `src/query/index.ts` — **NO**
- **Classification**: INTERNAL — implementation class
- **Public interface**: `IResourceCacheEntry<TArgs, TData>` (from resource.types) — this IS publicly exported.

#### `CommandCacheEntry` (class)
- **Location**: `@/src/query/core/command/` (exported from `core/index.ts`)
- **Exported from**: `core/index.ts` — YES
- **Exported from**: `src/query/index.ts` — **NO**
- **Classification**: INTERNAL — implementation class
- **Public interface**: No dedicated public interface type — commands don't expose cache entries directly to consumers.

### 5. Machine classes — export status

All machine classes ARE publicly exported from `src/query/index.ts`:

| Class | Public? | Notes |
|-------|---------|-------|
| `Machine` | YES | Factory class with static methods (`idle`, `fromSnapshot`) |
| `MachinePending` | YES | Concrete class for pending state |
| `MachineSuccess` | YES | Concrete class for success state |
| `MachineError` | YES | Concrete class for error state |
| `MachineRefreshing` | YES | Concrete class for refreshing state |
| `MachineWithData` | YES | Abstract base for success/refreshing |
| `Patcher` | YES | Static utility class for immer patches |
| `CommandIdle` | YES | Command machine — idle state |
| `CommandLoading` | YES | Command machine — loading state |
| `CommandSuccess` | YES | Command machine — success state |
| `CommandError` | YES | Command machine — error state |

`IPatchResolution` (exported from machines barrel) is **NOT** re-exported from the query barrel — INTERNAL.

### 6. Lifecycle hook types — export status

All lifecycle types ARE publicly exported:

| Type | Public? | Source |
|------|---------|--------|
| `ICacheEntryAddedTools` | YES | lifecycle.types |
| `IQueryStartedTools` | YES | lifecycle.types |
| `TOnCacheEntryAdded` | YES | lifecycle.types |
| `TOnQueryStarted` | YES | lifecycle.types |
| `ICommandCacheEntryAddedTools` | YES | command-lifecycle.types |
| `ICommandQueryStartedTools` | YES | command-lifecycle.types |
| `TOnCommandCacheEntryAdded` | YES | command-lifecycle.types |
| `TOnCommandQueryStarted` | YES | command-lifecycle.types |

### 7. Core internals NOT in the public API

These are exported from `core/index.ts` but blocked by the query barrel:

| Symbol | Kind | Location |
|--------|------|----------|
| `CacheEntry` | class | `@/src/query/core/CacheEntry.ts` |
| `createCacheMap` | function | `@/src/query/core/CacheMap/` |
| `Resource` | class | `@/src/query/core/resource/` |
| `ResourceAgent` | class | `@/src/query/core/resource/` |
| `ResourceCacheEntry` | class | `@/src/query/core/resource/` |
| `Command` | class | `@/src/query/core/command/` |
| `CommandAgent` | class | `@/src/query/core/command/` |
| `CommandCacheEntry` | class | `@/src/query/core/command/` |
| `ResourceRef` | class | `@/src/query/core/command/` |
| `getSnapshot` | function | `@/src/query/core/Snapshot.ts` |
| `IPatchResolution` | type | `@/src/query/core/machines/Patcher.ts` |
| `_createCommand` | function | `@/src/query/api/_createCommand.ts` |
| `_createResource` | function | `@/src/query/api/_createResource.ts` |

### 8. `cache.types.ts` — all INTERNAL

All 5 exports from `cache.types.ts` are excluded from the query barrel:
- `ICacheEntry` — used internally by `IResourceCacheEntry` (extends it) but not directly exported
- `ICacheEntryOptions` — CacheEntry constructor input
- `ICacheMap` — generic map interface
- `TCacheMapFactory` — factory function type
- `ICacheMapOptions` — CacheMap configuration

## Code References

- `@/src/index.ts:8` — `export * from "./query"` (root re-export)
- `@/src/query/index.ts:1-109` — complete public API barrel
- `@/src/query/types/index.ts:1-12` — types barrel (re-exports everything, including internals)
- `@/src/query/types/cache.types.ts:1-55` — internal cache infrastructure types
- `@/src/query/types/lifecycle.types.ts:1-31` — lifecycle hook types (all public)
- `@/src/query/types/command-lifecycle.types.ts:1-14` — command lifecycle types (all public)
- `@/src/query/types/machine.types.ts:1-98` — machine state types (all public)
- `@/src/query/types/resource.types.ts:1-72` — resource types (public except `ICacheEntry` dependency)
- `@/src/query/types/command-machine.types.ts:1-52` — command machine types (all public)
- `@/src/query/types/command.types.ts:1-89` — command types (all public)
- `@/src/query/types/agent.types.ts:1-42` — agent types (all public)
- `@/src/query/types/snapshot.types.ts:1-23` — snapshot types + version constant (all public)
- `@/src/query/types/plugin.types.ts:1-65` — plugin types (all public)
- `@/src/query/types/api.types.ts:1-39` — API factory types (all public)
- `@/src/query/types/shared.types.ts:1-11` — utility types (all public)
- `@/src/query/core/index.ts:1-27` — core barrel (exports internals not in public API)
- `@/src/query/core/machines/index.ts:1-12` — machines barrel
- `@/src/query/core/machines/Patcher.ts:8-11` — `IPatchResolution` (internal, not re-exported)
- `@/src/query/api/index.ts:1-3` — API barrel (includes internal `_createCommand`)
