---
title: "Query Module Shared Infrastructure — Codebase Analysis"
date: 2026-04-02
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

The query module's shared infrastructure centres on `CacheEntry` (reactive state container), `CacheMap` (strategy-based key→entry storage), a `machines/` state-machine layer (Resource 4-state + Command 4-state), the `Patcher` (Immer-based optimistic updates), shared `lib/` utilities, a plugin system, and a comprehensive `types/` barrel. The files `QueriesCache.ts`, `QueriesLifetimeHooks.ts`, and `ResetAllQueriesSignal.ts` referenced in coverage reports **do not exist** in the current source tree — they are artefacts of an earlier version captured only in `coverage/`.

## Findings

### 1. CacheEntry — Reactive State Container

- **Location**: `@/src/query/core/CacheEntry.ts:1-74`
- **What it does**: Generic reactive wrapper around `Signal.state<TState>`. Stores a single state value and exposes:
  - `peek()` — non-reactive read
  - `set(state)` — update (no-op after complete)
  - `complete()` — fires `onClean$` Subject, marks entry as dead
  - `obs` — RxJS Observable with `share({ resetOnRefCountZero })` for GC via subscriber count
  - `state$` — signal derived from `obs` via `signalize()`
- **Key dependencies**: `rxjs` (ReplaySubject, share, timer, finalize), `@/signals` (Signal, signalize)
- **Patterns**:
  - `_cacheLifetime` controls GC delay via `timer(lifetime)` in `share({ resetOnRefCountZero })`
  - Default lifetime = 60 000 ms; `false` = never reset; `0` = reset immediately
  - `ICacheEntryOptions.keyParts` passed into Signal key for devtools
  - Used as **base class** by both `ResourceCacheEntry` and `CommandCacheEntry`

### 2. CacheMap — Strategy-based Key→Entry Storage

- **Location**: `@/src/query/core/CacheMap/createCacheMap.ts:1-13`
- **What it does**: Factory function selecting `SerializeCacheMap` or `CompareCacheMap` based on `keyStrategy`
- **Interface**: `ICacheMap<TArgs, TEntry>` (`@/src/query/types/cache.types.ts:28-40`)
  - Methods: `get`, `create`, `getOrCreate`, `delete`, `has`, `clear`, `size`, `values()`

#### SerializeCacheMap
- **Location**: `@/src/query/core/CacheMap/SerializeCacheMap.ts:1-73`
- **What it does**: Maps `TArgs → string key → TEntry` via serialization. Default serializer = `stableStringify`
- **Patterns**:
  - Optional `doCacheArgs` enables a `WeakMap<object, string>` cache for serialized keys
  - Inner `Map<string, TEntry>` for storage

#### CompareCacheMap
- **Location**: `@/src/query/core/CacheMap/CompareCacheMap.ts:1-56`
- **What it does**: Maps `TArgs → TEntry` using reference identity (`Map<TArgs, TEntry>`)
- **Patterns**:
  - `_counter` auto-increments for argsKey when no `devtoolsKey` provided
  - No serialization — suitable for non-serializable args

### 3. machines/ — State Machine Layer

- **Location**: `@/src/query/core/machines/`
- **What it does**: Immutable state-machine classes for query lifecycle

#### Resource machines (4 states):
- `MachinePending<TArgs, TData>` — `@/src/query/core/machines/MachinePending.ts:1-40`
  - status = "pending", transitions → Success / Error
- `MachineSuccess<TArgs, TData>` — `@/src/query/core/machines/MachineSuccess.ts:1-62`
  - status = "success", extends `MachineWithData`, transitions → Refreshing / Pending
  - Carries `lastError` for refresh-error pattern
- `MachineError<TArgs, TData>` — `@/src/query/core/machines/MachineError.ts:1-40`
  - status = "error", transitions → Pending (retry / start)
- `MachineRefreshing<TArgs, TData>` — `@/src/query/core/machines/MachineRefreshing.ts:1-60`
  - status = "refreshing", extends `MachineWithData`, transitions → Success
  - On error: degrades to `MachineSuccess` with `lastError` (SWR semantics)
- `MachineWithData<TArgs, TData>` — `@/src/query/core/machines/MachineWithData.ts:1-100`
  - Abstract base for Success + Refreshing
  - Provides `createPatch()`, `finishPatch()`, `abortAllPendingPatches()` — all return new immutable instances
  - Delegates to `Patcher` for Immer-based patch management

#### Command machines (4 states, separate hierarchy):
- `CommandIdle<TArgs, TData>` — `@/src/query/core/machines/CommandIdle.ts:1-16`
- `CommandLoading<TArgs, TData>` — `@/src/query/core/machines/CommandLoading.ts:1-28`
- `CommandSuccess<TArgs, TData>` — `@/src/query/core/machines/CommandSuccess.ts:1-30`
- `CommandError<TArgs, TData>` — `@/src/query/core/machines/CommandError.ts:1-24`
- **Pattern**: Command machines do NOT extend `MachineWithData`; they are standalone classes with `start()` / `successHappened()` / `errorHappened()` transitions. Marked "Stub — full implementation in Phase 2"

#### Machine (static factory)
- **Location**: `@/src/query/core/machines/Machine.ts:1-31`
- **What it does**: `Machine.pending()` and `Machine.fromSnapshot()` — factory for Resource machine instances only (not Command)

### 4. Patcher — Immer-based Optimistic Updates

- **Location**: `@/src/query/core/machines/Patcher.ts:1-139`
- **What it does**: Static utility class for creating, resolving, committing, and aborting optimistic patches
- **Key methods**:
  - `createPatch(patchFn, data)` → `{ patch: TPatch, data: TData }` — uses `produceWithPatches`
  - `resolvePatches(originalData, patches)` → `IPatchResolution<TData>` — replays committed/pending patches, drops aborted, detects consistency violations
  - `finishPatch(originalData, patches, type, patch)` — marks one patch and resolves
  - `abortAllPending(originalData, patches)` — aborts all pending patches
- **Key dependencies**: `immer` (enablePatches, produceWithPatches, applyPatches)
- **Patterns**:
  - Calls `enablePatches()` at module scope
  - Consistency violation detection: on catch → returns last valid data with `isConsistencyViolation: true`
  - Used by `MachineWithData` (abstract patch methods) and directly by `ResourceCacheEntry._doFetch()` success path

### 5. Resource Core (how shared infra is consumed)

- **Resource** — `@/src/query/core/resource/Resource.ts:1-175`
  - Owns a `CacheMap<TArgs, ResourceCacheEntry>`, delegates entry creation to `_entryFactory`
  - Exposes `createAgent()`, `query()`, `getEntry()`, `getEntry$()`, `invalidate()`, `resetCache()`
  - Internal methods: `cacheValues()`, `hydrateEntry()`, `hasEntry()` — used by Snapshot and createApi

- **ResourceCacheEntry** — `@/src/query/core/resource/ResourceCacheEntry.ts:1-250+`
  - **Extends** `CacheEntry<TMachineInstance<TArgs, TData>>`
  - Adds: query lifecycle (`_doFetch`), abort management (`AbortController`), optimistic patches (`_patchState`), lifecycle hooks (`onCacheEntryAdded`, `onQueryStarted`)
  - Uses `PromiseResolver` for lifecycle promise management
  - On `complete()`: aborts inflight, resolves/rejects lifecycle promises, calls `super.complete()`

- **ResourceAgent** — `@/src/query/core/resource/ResourceAgent.ts:1-135`
  - SWR observer: tracks current + previous entry for stale-while-revalidate data
  - Uses `Signal.state` and `Signal.compute` for reactive tracking

### 6. Command Core (how shared infra is consumed)

- **Command** — `@/src/query/core/command/Command.ts:1-48`
  - Owns `Map<symbol, CommandCacheEntry>` (keyed by symbol, not args)
  - `_getOrCreateEntry(key)` — internal, used by `CommandAgent.trigger()`

- **CommandCacheEntry** — `@/src/query/core/command/CommandCacheEntry.ts:1-240+`
  - **Extends** `CacheEntry<TCommandMachineInstance<TArgs, TResult>>`
  - Adds: `initiate(args)` (mutation execution), linked resource effects (optimistic + update + invalidate), lifecycle hooks
  - Uses `ResourceRef` for linked resource operations

- **CommandAgent** — `@/src/query/core/command/CommandAgent.ts:1-90`
  - Per-component mutation observer
  - `trigger()` delegates to `Command._getOrCreateEntry(key).initiate(args)`

- **ResourceRef** — `@/src/query/core/command/ResourceRef.ts:1-24`
  - Adapter: wraps `IResource` + args, exposes `invalidate()` and `patch()` for command link effects

### 7. lib/ — Shared Utilities

- **Location**: `@/src/query/lib/`
- **SKIP_TOKEN** — `@/src/query/lib/SKIP_TOKEN.ts:1-2`
  - `SKIP` unique symbol + `SKIP_TOKEN` type
  - Used by agents to skip/pause observation
- **stableStringify** — `@/src/query/lib/stableStringify.ts:1-24`
  - Deterministic `JSON.stringify` with sorted keys
  - Default `serializeArgs` for SerializeCacheMap
  - Does NOT handle Date, Map, Set, RegExp (documented limitation)

### 8. types/ — Shared Type Definitions

- **Location**: `@/src/query/types/`
- **Barrel**: `@/src/query/types/index.ts:1-12` — re-exports all 12 type modules

| File | Key exports | Used by |
|------|------------|---------|
| `machine.types.ts` | `TMachineStatus`, `TPatchState`, `TPendingState`, `TSuccessState`, `TErrorState`, `TRefreshingState`, `TMachineState`, `TMachineInstance`, `IPatchHandle`, `CreatePatchResult` | machines/, ResourceCacheEntry, Snapshot |
| `cache.types.ts` | `ICacheEntry`, `ICacheEntryOptions`, `ICacheMap`, `ICacheMapOptions`, `TCacheMapFactory` | CacheEntry, CacheMap, Resource |
| `resource.types.ts` | `TQueryFn`, `TResourceOptions`, `IResource`, `IResourceCacheEntry`, `TSerializeArgsFn`, `TCompareArgsFn` | Resource, ResourceCacheEntry, createApi |
| `command.types.ts` | `TCommandQueryFn`, `TCommandOptions`, `ICommand`, `ICommandAgent`, `CommandLink`, `IResourceRef`, `TCommandAgentState` | Command, CommandCacheEntry, CommandAgent |
| `command-machine.types.ts` | `TCommandMachineStatus`, `TCommandIdleState`, `TCommandLoadingState`, `TCommandSuccessState`, `TCommandErrorState`, `TCommandMachineInstance` | Command machines |
| `agent.types.ts` | `TResourceAgentState`, `IResourceAgent` | ResourceAgent, ReactHooksPlugin |
| `lifecycle.types.ts` | `ICacheEntryAddedTools`, `IQueryStartedTools`, `TOnCacheEntryAdded`, `TOnQueryStarted` | ResourceCacheEntry |
| `command-lifecycle.types.ts` | `ICommandCacheEntryAddedTools`, `ICommandQueryStartedTools`, `TOnCommandCacheEntryAdded`, `TOnCommandQueryStarted` | CommandCacheEntry |
| `snapshot.types.ts` | `CURRENT_SNAPSHOT_VERSION`, `TResourceSnapshotSlice`, `TResourceSnapshot`, `TApiSnapshot` | Snapshot, createApi |
| `plugin.types.ts` | `IPlugin`, `IPluginContext`, `PluginAugmentations`, `PluginCommandAugmentations`, `PluginResourceContributions`, `PluginCommandContributions` | createApi, ReactHooksPlugin |
| `shared.types.ts` | `ArgsOrVoid`, `ArgsOrVoidOrSkip`, `Prettify`, `UnionToIntersection` | everywhere |
| `api.types.ts` | `ICreateApiOptions`, `IApi` | createApi |

### 9. plugins/ — Plugin System

- **Location**: `@/src/query/plugins/`
- **Interface**: `IPlugin` (`@/src/query/types/plugin.types.ts:12-26`)
  - `name: string`
  - `install(context: IPluginContext)` — called once by `createApi()`
  - `augmentResource?(resource, options)` → `Record<string, unknown>` — called per `createResource()`
  - `augmentCommand?(command, options)` → `Record<string, unknown>` — called per `createCommand()`

- **ReactHooksPlugin** — `@/src/query/plugins/ReactHooksPlugin.ts:1-37`
  - Only concrete plugin implementation
  - `install()` is a no-op
  - `augmentResource()` returns `{ useResourceAgent }` — wraps `useResourceAgent(resource, ...args)`
  - `augmentCommand()` returns `{ useCommandAgent }` — wraps `useCommandAgent(command)`
  - Type-level contributions via conditional types in `plugin.types.ts:40-47` and `plugin.types.ts:60-67`

- **Plugin application** in `createApi()` (`@/src/query/api/createApi.ts:90-108`, `140-158`):
  - Plugins installed once with `{ keyStrategy }` context
  - Per createResource/createCommand: iterate plugins, call augment*, `Object.assign` contributions to instance
  - Duplicate key detection across plugins

### 10. Snapshot System

- **Location**: `@/src/query/core/Snapshot.ts:1-92`
- **getSnapshot(resources, keyPrefix)** — iterates resources, captures `MachineSuccess` entries; throws for compare-strategy resources
- **hydrateSnapshot(resources, snapshot)** — version check, iterates snapshot entries, calls `Machine.fromSnapshot()` + `resource.hydrateEntry()`
- `hydrateSnapshot` is NOT exported from core index — only the API-layer version (in `createApi`) is public

### 11. API Layer (how it connects shared infra)

- **createApi** — `@/src/query/api/createApi.ts:1-175`
  - Owns `_resources: Map<string, Resource>` and `_commands: Set<Command>`
  - Merges API-level defaults (keyStrategy, serializeArgs, compareArg, cacheLifetime, doCacheArgs) into resource/command options
  - `resetAll()` iterates both maps and calls `resetCache()` on each
  - Standalone factories `_createResource()` and `_createCommand()` exist for plugin-less usage

### 12. Missing Files (from task scope)

- **`QueriesCache.ts`** — does NOT exist in `src/`. Coverage HTML at `coverage/query/core/QueriesCache.ts.html` indicates it existed in a prior version.
- **`QueriesLifetimeHooks.ts`** — does NOT exist in `src/`. Coverage HTML at `coverage/query/core/QueriesLifetimeHooks.ts.html` only.
- **`ResetAllQueriesSignal.ts`** — does NOT exist in `src/`. Coverage HTML at `coverage/query/core/ResetAllQueriesSignal.ts.html` only.
- These three files appear to have been refactored away. `resetAll()` is now handled directly in `createApi()`. Cache management is distributed to `Resource.resetCache()` and `Command.resetCache()`. Lifetime hooks are embedded within `ResourceCacheEntry` and `CommandCacheEntry` lifecycle methods.

## Code References

- `@/src/query/core/CacheEntry.ts:1-74` — shared reactive state container
- `@/src/query/core/CacheMap/createCacheMap.ts:1-13` — CacheMap factory
- `@/src/query/core/CacheMap/SerializeCacheMap.ts:1-73` — serialize-strategy CacheMap
- `@/src/query/core/CacheMap/CompareCacheMap.ts:1-56` — compare-strategy CacheMap
- `@/src/query/core/machines/Machine.ts:1-31` — static factory for Resource machines
- `@/src/query/core/machines/MachinePending.ts:1-40` — pending state
- `@/src/query/core/machines/MachineSuccess.ts:1-62` — success state
- `@/src/query/core/machines/MachineError.ts:1-40` — error state
- `@/src/query/core/machines/MachineRefreshing.ts:1-60` — refreshing state
- `@/src/query/core/machines/MachineWithData.ts:1-100` — abstract base for data-bearing states
- `@/src/query/core/machines/Patcher.ts:1-139` — Immer-based optimistic patch engine
- `@/src/query/core/machines/CommandIdle.ts:1-16` — command idle state
- `@/src/query/core/machines/CommandLoading.ts:1-28` — command loading state
- `@/src/query/core/machines/CommandSuccess.ts:1-30` — command success state
- `@/src/query/core/machines/CommandError.ts:1-24` — command error state
- `@/src/query/core/resource/Resource.ts:1-175` — resource class (owns CacheMap)
- `@/src/query/core/resource/ResourceCacheEntry.ts:1-250` — resource cache entry (extends CacheEntry)
- `@/src/query/core/resource/ResourceAgent.ts:1-135` — SWR agent
- `@/src/query/core/command/Command.ts:1-48` — command class (owns Map<symbol, entry>)
- `@/src/query/core/command/CommandCacheEntry.ts:1-240` — command cache entry (extends CacheEntry)
- `@/src/query/core/command/CommandAgent.ts:1-90` — command agent
- `@/src/query/core/command/ResourceRef.ts:1-24` — linked resource adapter
- `@/src/query/core/Snapshot.ts:1-92` — snapshot capture/hydrate
- `@/src/query/lib/SKIP_TOKEN.ts:1-2` — SKIP sentinel
- `@/src/query/lib/stableStringify.ts:1-24` — deterministic serialization
- `@/src/query/types/index.ts:1-12` — types barrel (12 modules)
- `@/src/query/types/plugin.types.ts:1-67` — plugin interface and type-level contributions
- `@/src/query/plugins/ReactHooksPlugin.ts:1-37` — sole plugin implementation
- `@/src/query/api/createApi.ts:1-175` — API factory (connects all shared infra)
