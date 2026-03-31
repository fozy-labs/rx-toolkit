---
title: "Query-V2 Module Architecture — Codebase Analysis"
date: 2026-03-30
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

Query-v2 is a reactive data-fetching module built on top of `@/signals`. It uses an immutable state-machine pattern (4 states: pending/success/error/refreshing), CacheEntry as a reactive container backed by `Signal.state`, and a layered architecture: core → api → plugins → react. ResourceV2 is the central data-fetching unit; ResourceV2Agent provides SWR-style observation; CacheMap handles key-based entry storage; Patcher manages Immer-based optimistic updates.

## Findings

### 1. State Machine (`core/machines/`)

- **Location**: `@/src/query-v2/core/machines/`
- **States**: `pending` → `success` | `error`; `success` → `refreshing`; `refreshing` → `success` (with lastError on error); `error` → `pending` (retry)
- **Pattern**: Immutable classes, each transition returns a new instance
- **Machine factory** (`Machine.ts:14-34`): static object with `pending()` and `fromSnapshot()` methods
- **MachinePending** (`MachinePending.ts:10-40`): `status="pending"`, `data=null`, `error=null`, transitions: `successHappened(data)→MachineSuccess`, `errorHappened(error)→MachineError`
- **MachineSuccess** (`MachineSuccess.ts:13-63`): `status="success"`, has `data`, `updatedAt`, optional `lastError`, extends `MachineWithData`, transitions: `invalidate()→MachineRefreshing`, `start(args)→MachinePending`
- **MachineError** (`MachineError.ts:9-38`): `status="error"`, `data=null`, has `error`, transitions: `retry()→MachinePending`, `start(args)→MachinePending`
- **MachineRefreshing** (`MachineRefreshing.ts:13-62`): `status="refreshing"`, has `data` (stale), extends `MachineWithData`, transitions: `successHappened(data)→MachineSuccess` (resolves patches), `errorHappened(error)→MachineSuccess` (preserves stale data + lastError)
- **MachineWithData** (`MachineWithData.ts:11-92`): abstract base for `Success`/`Refreshing`, owns `patchState`, methods: `createPatch(patchFn)`, `finishPatch(type, patch)`, `abortAllPendingPatches()`, abstract `cloneWith(updates)`
- **Patcher** (`Patcher.ts:1-133`): static class, uses Immer `produceWithPatches` + `applyPatches`. Methods: `createPatch()`, `resolvePatches()`, `finishPatch()`, `abortAllPending()`. Returns `IPatchResolution<TData>` with data + patchState

### 2. CacheEntry (`core/CacheEntry.ts`)

- **Location**: `@/src/query-v2/core/CacheEntry.ts:11-73`
- **What it does**: Reactive container wrapping `Signal.state<TState>`. Exposes `obs` (RxJS Observable with `share({resetOnRefCountZero})` for GC) and `state$` (signalized observable)
- **Key API**: `peek()`, `set(state)`, `complete()`, `onClean$` (Subject)
- **Cache lifetime**: configurable via `cacheLifetime` option (default 60s), controls `resetOnRefCountZero` timer
- **Pattern**: Constructor takes `initialState` + optional `ICacheEntryOptions`. Once `complete()` is called, `set()` is a no-op

### 3. CacheMap (`core/CacheMap/`)

- **Location**: `@/src/query-v2/core/CacheMap/`
- **Factory**: `createCacheMap(options)` → returns `SerializeCacheMap` or `CompareCacheMap` based on `keyStrategy`
- **SerializeCacheMap** (`SerializeCacheMap.ts`): uses `stableStringify` to serialize args to string keys, optional `WeakMap` args caching via `doCacheArgs`
- **CompareCacheMap** (`CompareCacheMap.ts`): uses reference identity (`Map<TArgs, TEntry>`), counter-based argsKey
- **Interface** `ICacheMap<TArgs, TEntry>`: `get`, `create`, `getOrCreate`, `delete`, `has`, `clear`, `size`, `values()`

### 4. ResourceV2 (`core/resource/ResourceV2.ts`)

- **Location**: `@/src/query-v2/core/resource/ResourceV2.ts:20-198`
- **Implements**: `IResourceV2<TArgs, TData>`
- **Constructor**: takes `TResourceV2Options`, creates CacheMap, stores queryFn/compareArgsFn/lifecycle hooks
- **Internal signals**: `_lastEntry$`, `status$` ("idle" | "ready")
- **Key methods**:
  - `createAgent()→ResourceV2Agent` — factory
  - `query(...args, doForce?)→Promise<TData>` — executes queryFn
  - `getEntry(…args)`/`getEntry$(…args)` — non-reactive/reactive cache entry access with optional `doInitiate: true`
  - `invalidate(...args)` — sets entry to refreshing + refetches
  - `subscribe(...args)→Subscription` — keeps entry alive
  - `resetCache()` — clears all entries, signals idle
  - `hydrateEntry(args, machine)` — SSR snapshot hydration
- **Entry factory** (`_entryFactory`): creates `ResourceV2CacheEntry`, subscribes to `onClean$` for auto cache removal, sets status to "ready"

### 5. ResourceV2CacheEntry (`core/resource/ResourceV2CacheEntry.ts`)

- **Location**: `@/src/query-v2/core/resource/ResourceV2CacheEntry.ts:40-350`
- **Extends**: `CacheEntry<TMachineInstance<TArgs, TData>>`
- **Implements**: `IResourceV2CacheEntry<TArgs, TData>`
- **Owns**: `AbortController`, inflight promise, `_patchState`, lifecycle promise resolvers (`_entryDataLoaded`, `_entryRemoved`, `_queryFulfilled`)
- **Key methods**:
  - `query(doForce?)→Promise<TData>` — dedup, state transition, abort previous, call queryFn
  - `createPatch(patchFn)→IPatchHandle|null` — optimistic update via Patcher
  - `invalidate()` — transitions success→refreshing + refetch
  - `complete()` — abort inflight, resolve lifecycle promises, fire onClean$
- **Lifecycle hooks**: `_fireCacheEntryAdded()` — creates `$cacheDataLoaded`/`$cacheEntryRemoved` promises; `_doFetch()` — manages `onQueryStarted`/`$queryFulfilled`
- **Fetch flow**: abort previous → new AbortController → call queryFn → on success: resolve patches if refreshing, set MachineSuccess → on error: if refreshing preserve stale data as MachineSuccess(lastError), else MachineError
- **Consistency violation detection**: in `_finishPatch()`, if abort causes violation → auto `invalidate()`

### 6. ResourceV2Agent (`core/resource/ResourceV2Agent.ts`)

- **Location**: `@/src/query-v2/core/resource/ResourceV2Agent.ts:15-145`
- **Implements**: `IResourceV2Agent<TArgs, TData>`
- **Pattern**: SWR observer — tracks `_previous$` and `_tracking$` (current entry + args)
- **`start(...args)`**: compares args, if SKIP → clears tracking; if same → noop; if different → swap current→previous (only if previous has data), create new computed entry
- **`state$`**: `Signal.compute` that derives `TResourceV2AgentState` from current + previous entries
- **SWR behavior**: when current is pending/error and previous has data → status="refreshing", data=previous.data
- **State shape**: `{ status, data, error, lastError?, args, isLoading, isInitialLoading, isRefreshing, isRefreshError, isSuccess, isError, entry }`

### 7. Types (`types/`)

- **Location**: `@/src/query-v2/types/`
- **machine.types.ts**: `TMachineStatus`, `TPatchStatus`, `TPatch`, `TPatchState<TData>`, state interfaces (`TPendingState`, `TSuccessState`, `TErrorState`, `TRefreshingState`), `TMachineState`, `TMachineInstance`, `MachineWithData`, `IPatchHandle`, `CreatePatchResult`, `IMachineStatic`
- **cache.types.ts**: `ICacheEntry<TState>`, `ICacheEntryOptions<TState>`, `ICacheMap<TArgs, TEntry>`, `TCacheMapFactory`, `ICacheMapOptions`
- **resource.types.ts**: `TQueryFn<TArgs, TData>`, `TSerializeArgsFn`, `TCompareArgsFn`, `TResourceV2Options`, `IResourceV2`, `IResourceV2CacheEntry`
- **agent.types.ts**: `TResourceV2AgentState<TArgs, TData>` (discriminated union with "idle" | TMachineStatus), `IResourceV2Agent`
- **lifecycle.types.ts**: `ICacheEntryAddedTools<TData>`, `IQueryStartedTools<TArgs, TData>`, `TOnCacheEntryAdded`, `TOnQueryStarted`
- **plugin.types.ts**: `IPluginContext`, `IPlugin` (name, install, augmentResource?), `IReactHooksPluginContributions`, `PluginResourceContributions` (conditional type per plugin name), `PluginAugmentations` (union→intersection merge)
- **api.types.ts**: `ICreateApiOptions<TPlugins>`, `IApi<TPlugins>`
- **snapshot.types.ts**: `TResourceV2SnapshotSlice`, `TResourceSnapshot`, `TApiSnapshot`, `CURRENT_SNAPSHOT_VERSION`
- **shared.types.ts**: `ArgsOrVoid<TArgs>`, `ArgsOrVoidOrSkip<TArgs>`, `Prettify<T>`, `UnionToIntersection<U>`

### 8. API Layer (`api/`)

- **Location**: `@/src/query-v2/api/createApi.ts:24-160`
- **`createApi<TPlugins>(options?)`**: creates API instance with shared defaults (keyPrefix, keyStrategy, serializeArgs, compareArg, cacheLifetime, plugins, initialSnapshot)
- **`api.createResourceV2(options)`**: merges API defaults → creates ResourceV2 → hydrates from snapshot → applies plugin augmentations → returns augmented IResourceV2
- **`api.resetAll()`**: resets all registered resources
- **`api.getSnapshot()`**: captures snapshot via `getSnapshot()` core function
- **Plugin augmentation**: iterates plugins calling `augmentResource()`, detects key collisions, uses `Object.assign`
- **`_createResourceV2.ts`**: standalone factory wrapper, no API features — just `new ResourceV2(options)`

### 9. Plugin System (`plugins/`)

- **Location**: `@/src/query-v2/plugins/`
- **IPlugin contract**: `{ name: string, install(ctx), augmentResource?(resource, options)→Record<string, unknown> }`
- **ReactHooksPlugin** (`ReactHooksPlugin.ts:4-20`): `name="ReactHooksPlugin"`, `augmentResource` returns `{ useResourceV2Agent(...args) }` wrapping the hook
- **Type augmentation**: `PluginResourceContributions<TPlugin, TArgs, TData>` uses conditional type on plugin `name` literal → `IReactHooksPluginContributions` for "ReactHooksPlugin"
- **Extensibility**: new plugins add a new conditional branch; `PluginAugmentations` merges via `UnionToIntersection`

### 10. React Layer (`react/`)

- **Location**: `@/src/query-v2/react/useResourceV2Agent.ts:1-16`
- **`useResourceV2Agent(resource, ...args)`**: creates agent via `useConstant`, calls `agent.start(...args)` in `useEffect`, returns `useSignal(agent.state$)`
- **Pattern**: constant agent instance per component, effect-driven arg changes, signal-reactive state

### 11. Snapshot / SSR (`core/Snapshot.ts`)

- **Location**: `@/src/query-v2/core/Snapshot.ts:12-88`
- **`getSnapshot(resources, keyPrefix)`**: iterates resources, captures only `status:"success"` entries, throws for compare-strategy resources
- **`hydrateSnapshot(resources, snapshot)`**: version-checks, iterates snapshot entries, calls `Machine.fromSnapshot()` + `resource.hydrateEntry()`
- **API-layer**: `createApi` handles `initialSnapshot` + `maxSnapshotDataAge` auto-invalidation

### 12. Lib (`lib/`)

- **`SKIP_TOKEN`** (`lib/SKIP_TOKEN.ts`): `SKIP = Symbol("SKIP")`, used by Agent to skip observation
- **`stableStringify`** (`lib/stableStringify.ts`): deterministic JSON.stringify with sorted keys, default serializer

## Code References

- `@/src/query-v2/core/machines/Machine.ts:14-34` – Machine static factory
- `@/src/query-v2/core/machines/MachinePending.ts:10-40` – Pending state class
- `@/src/query-v2/core/machines/MachineSuccess.ts:13-63` – Success state class
- `@/src/query-v2/core/machines/MachineError.ts:9-38` – Error state class
- `@/src/query-v2/core/machines/MachineRefreshing.ts:13-62` – Refreshing state class
- `@/src/query-v2/core/machines/MachineWithData.ts:11-92` – Abstract data-carrying base
- `@/src/query-v2/core/machines/Patcher.ts:18-133` – Immer patch management
- `@/src/query-v2/core/CacheEntry.ts:11-73` – Reactive signal container
- `@/src/query-v2/core/CacheMap/createCacheMap.ts:10-13` – CacheMap factory
- `@/src/query-v2/core/CacheMap/SerializeCacheMap.ts:8-79` – String-key CacheMap
- `@/src/query-v2/core/CacheMap/CompareCacheMap.ts:7-63` – Reference-key CacheMap
- `@/src/query-v2/core/resource/ResourceV2.ts:20-198` – Main resource class
- `@/src/query-v2/core/resource/ResourceV2CacheEntry.ts:40-350` – Cache entry with fetch lifecycle
- `@/src/query-v2/core/resource/ResourceV2Agent.ts:15-145` – SWR-style observer agent
- `@/src/query-v2/core/Snapshot.ts:12-88` – Snapshot capture/hydration
- `@/src/query-v2/api/createApi.ts:24-160` – API factory with plugin orchestration
- `@/src/query-v2/api/_createResourceV2.ts:4-7` – Standalone resource factory
- `@/src/query-v2/plugins/ReactHooksPlugin.ts:4-20` – React hooks plugin
- `@/src/query-v2/react/useResourceV2Agent.ts:7-16` – React hook
- `@/src/query-v2/types/machine.types.ts` – Machine state types
- `@/src/query-v2/types/resource.types.ts` – Resource/CacheEntry interfaces
- `@/src/query-v2/types/agent.types.ts` – Agent state types
- `@/src/query-v2/types/plugin.types.ts` – Plugin system types
- `@/src/query-v2/types/api.types.ts` – API types
- `@/src/query-v2/types/lifecycle.types.ts` – Lifecycle hook types
- `@/src/query-v2/types/cache.types.ts` – CacheEntry/CacheMap types
- `@/src/query-v2/types/snapshot.types.ts` – Snapshot types
- `@/src/query-v2/types/shared.types.ts` – Utility types (ArgsOrVoid, Prettify)
- `@/src/query-v2/lib/SKIP_TOKEN.ts` – SKIP sentinel
- `@/src/query-v2/lib/stableStringify.ts` – Deterministic JSON serialization
- `@/src/query-v2/index.ts` – Public API barrel exports

## Key Patterns for CommandV2 Reference

1. **Immutable state machine**: each machine state is a class with typed transitions returning new instances
2. **CacheEntry as reactive wrapper**: `Signal.state` + RxJS `share()` with `resetOnRefCountZero` for GC
3. **Resource = CacheMap + entry factory + lifecycle hooks**: resource creates/manages cache entries
4. **Agent = SWR observer**: tracks current/previous entries, derives flat state via `Signal.compute`
5. **Plugin augmentation**: `augmentResource()` returns methods; conditional types map plugin name → contributions
6. **Lifecycle promises**: `onCacheEntryAdded` → `$cacheDataLoaded`/`$cacheEntryRemoved`; `onQueryStarted` → `$queryFulfilled`
7. **Optimistic updates via Patcher**: Immer-based, tracked in `patchState`, resolved on server response, auto-invalidate on consistency violation
8. **API layer merges defaults**: keyStrategy, serializeArgs, cacheLifetime propagated from createApi to each resource
