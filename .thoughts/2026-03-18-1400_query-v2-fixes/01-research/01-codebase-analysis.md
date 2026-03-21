---
title: "Query v2 Fixes — Codebase Analysis"
date: 2026-03-18
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

The query-v2 module is a self-contained query/cache layer at `@/query-v2/` with a plugin-based architecture for extending resources. React hooks currently live inside a plugin (`ReactHooksPlugin`) and require explicit registration; there is no `react/` folder. Core has a flat structure with machines already isolated in a `machines/` sub-folder but no `common/` or `resource/` separation. DevTools integration flows through `CacheEntry` → signals `beforeDevtoolsPush`, not through `ResourceV2Agent`. Snapshot hydration silently ignores version/prefix mismatches without errors. JSDoc coverage is strong in types but absent from most implementation files. Documentation files do not describe snapshot contents during optimistic updates.

## Findings

### 1. React Hooks & Plugin Dependency

- **Hook implementations**: `@/query-v2/plugins/ReactHooksPlugin.ts:53-130`
  - `useResourceV2Agent(resource, args)` — React hook wrapping `resource.createAgent()` + `useSignal(agent.state$)`. Manages arg diffing via `React.useRef` and `compareArgs`.
  - `useResourceV2Ref(resource, args)` — React hook returning `IResourceV2Ref` with imperative cache entry access (`has`, `lock`, `invalidate`, `createPatch`, `create`).
  - Helper functions: `createRefHandle`, `createSkippedRef`, `compareArgs`.

- **Plugin mechanism**: `@/query-v2/plugins/ReactHooksPlugin.ts:28-49`
  - `ReactHooksPlugin` implements `IPlugin` interface (`@/query-v2/types/plugin.types.ts:7-18`).
  - `install(context)` stores `IPluginContext` (currently unused beyond storing).
  - `augmentResource(res, options)` returns `{ useResourceV2Agent, useResourceV2Ref }` as plain object.
  - These are merged onto the resource via `Object.assign` in `createApi.ts:73-76`.

- **Type-level wiring**: `@/query-v2/plugins/ReactHooksPlugin.ts:20-25`
  - Declaration merging on `PluginContributionMap` at `@/query-v2/types/plugin.types.ts:38`.
  - `PluginAugmentations<TPlugins, ...>` type utility (`@/query-v2/types/plugin.types.ts:50-60`) extracts and intersects contributions from all plugins.

- **What breaks without plugin**: If `ReactHooksPlugin` is not passed to `createApi({ plugins: [...] })`, the `augmentResource` method is never called, so `useResourceV2Agent` and `useResourceV2Ref` are `undefined` on the resource at runtime. The TypeScript types correctly reflect this absence via `PluginAugmentations<[]>` resolving to `object`.

- **Public exports from `@/query-v2/index.ts:33-35`**:
  - `ReactHooksPlugin` class and `IReactHooksPluginContributions` type are exported.
  - Hooks are NOT independently exported — they are only accessible as methods on plugin-augmented resources.

### 2. React Hooks Folder Location

- **Current location**: All React hook code lives in `@/query-v2/plugins/ReactHooksPlugin.ts` (single file, 130 lines).
  - Tests: `@/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts`.
  - Re-export barrel: `@/query-v2/plugins/types.ts` re-exports plugin types from `@/query-v2/types/plugin.types.ts`.

- **No `@/query-v2/react/` folder exists**. `file_search` confirmed zero files under `src/query-v2/react/`.

- **External imports referencing current location**:
  - `@/query-v2/__tests__/integration/plugin-augmentation.test.ts:2` — imports `ReactHooksPlugin` from `@/query-v2/plugins/ReactHooksPlugin`.
  - `@/query-v2/index.ts:33` — barrel export from `./plugins/ReactHooksPlugin`.

- **Comparison with original query module `@/query/react/`**:
  - `@/query/react/` contains 5 dedicated files, each a standalone hook:
    - `useResourceAgent.ts` + `useResourceAgent.test.ts`
    - `useResourceRef.ts` + `useResourceRef.test.ts`
    - `useCommandAgent.ts` + `useCommandAgent.test.ts`
    - `useOperationAgent.ts`
  - Hooks in v1 are standalone exports, not plugin-dependent.

### 3. Core Module Organization

- **`@/query-v2/core/index.ts` exports** (`@/query-v2/core/index.ts:1-6`):
  - `*` from `./machines` (barrel: Machine, MachineIdle, MachinePending, MachineSuccess, MachineError, MachineRefreshing, MachineWithData, Patcher, TMachineInstance)
  - `CacheEntry`, `CacheEntryOptions`
  - `CacheMap`, `TCacheMapInstance`
  - `LifecycleHooks`
  - `ResourceV2`, `ResourceV2Config`
  - `ResourceV2Agent`

- **File-to-category mapping**:

  | File | Current Category | Proposed Split |
  |------|-----------------|----------------|
  | `machines/Machine.ts` | Machine | `machines/` |
  | `machines/MachineIdle.ts` | Machine | `machines/` |
  | `machines/MachinePending.ts` | Machine | `machines/` |
  | `machines/MachineSuccess.ts` | Machine | `machines/` |
  | `machines/MachineError.ts` | Machine | `machines/` |
  | `machines/MachineRefreshing.ts` | Machine | `machines/` |
  | `machines/MachineWithData.ts` | Machine | `machines/` |
  | `machines/Patcher.ts` | Machine | `machines/` |
  | `machines/index.ts` | Machine barrel | `machines/` |
  | `CacheEntry.ts` | Common utility | `common/` |
  | `CacheMap.ts` | Common utility | `common/` |
  | `LifecycleHooks.ts` | Common utility | `common/` |
  | `ResourceV2.ts` | Resource logic | `resource/` |
  | `ResourceV2Agent.ts` | Resource logic | `resource/` |

- **Machines sub-folder** (`@/query-v2/core/machines/`):
  - `Machine.ts` — `TMachineInstance` union type + `Machine.idle()` factory + `Machine.fromSnapshot()` reconstructor.
  - `MachineIdle.ts` — Initial state (`status: "idle"`); transitions to `MachinePending` via `start(args)`.
  - `MachinePending.ts` — Loading state (`status: "pending"`); transitions to `MachineSuccess` via `successHappened(data)` or `MachineError` via `errorHappened(error)`.
  - `MachineSuccess.ts` — Data-loaded state (`status: "success"`); transitions to `MachineRefreshing` via `invalidate()`. Has `create(data, args)` and `deploy(state)` static factories.
  - `MachineError.ts` — Error state (`status: "error"`).
  - `MachineRefreshing.ts` — Re-fetch with stale data (`status: "refreshing"`); transitions to `MachineSuccess` via `successHappened(data)` or back to `MachineSuccess` (with stale data) via `errorHappened(error)`.
  - `MachineWithData.ts` — Abstract base for Success/Refreshing with patch queue support (`createPatch`, `finishPatch`, `abortAllPendingPatches`).
  - `Patcher.ts` — Immer integration for optimistic patch application.
  - `index.ts` — Barrel re-export of all machine classes + `Patcher` + `TMachineInstance`.

- **Current structure**: `machines/` is already isolated. `CacheEntry`, `CacheMap`, `LifecycleHooks` sit at `core/` root alongside `ResourceV2.ts` and `ResourceV2Agent.ts` — all flat.

### 4. DevTools Agent State Logging

- **DevTools integration path** (signals layer, not query-v2 directly):
  - `CacheEntry` constructor (`@/query-v2/core/CacheEntry.ts:20-39`) creates a `Signal.state()` with a `beforeDevtoolsPush` option.
  - The default `beforeDevtoolsPush` callback extracts `machine.state` (the plain state object) from the machine instance and pushes it to devtools.
  - Optional user-provided `beforeDevtoolsPush` from `ResourceV2Config.beforeDevtoolsPush` (`@/query-v2/core/ResourceV2.ts:36`) composes with the default.

- **What data is sent to devtools**:
  - Every `CacheEntry` signal push sends the machine's `.state` object to Redux DevTools (via `@/signals` layer).
  - State objects are flat records: `{ status, args, data, error, updatedAt, originalData, patches }` — their exact shape depends on the current machine class.
  - The signal key is built from `keyPrefix/resourceKey/serializedArgs` (`@/query-v2/core/ResourceV2.ts:532-539` in `_buildCacheEntryOptions`).

- **ResourceV2Agent does NOT send to devtools directly**:
  - `ResourceV2Agent` (`@/query-v2/core/ResourceV2Agent.ts`) has zero references to "devtools".
  - Agent's `_state$` is a `Signal.compute()` that reads from `CacheEntry.machine$()`.
  - When `CacheEntry.machine$` signal updates, the devtools push happens at the `CacheEntry` signal level.
  - The agent's computed signal (`_state$`) itself does NOT have a `beforeDevtoolsPush` — it is a derived signal observed by React hooks.

- **Shared devtools infra** (`@/common/devtools/`):
  - `reduxDevtools.ts` — connects to `window.__REDUX_DEVTOOLS_EXTENSION__`, batches updates via configurable strategy (sync/microtask/task).
  - `combineDevtools.ts` — multiplexes multiple `DevtoolsLike` instances.
  - `types.ts` — `DevtoolsLike` interface with `state(name, initState)` method.

- **Current behavior**: Each `CacheEntry` signal state transition (idle → pending → success, etc.) is pushed to devtools. Agent state (`IResourceV2AgentState`) is a computed derivation and is NOT separately pushed to devtools. The task "DevTools must not receive agent state logs" suggests either that agent state IS being logged somewhere (not found in current code) or that this is a preventative requirement.

### 5. Snapshot Loading Error Handling

- **`hydrateSnapshot` function** (`@/query-v2/snapshot/Snapshot.ts:57-96`):
  - **Version mismatch** (line 68-70): `if (snapshot.version !== CURRENT_SNAPSHOT_VERSION) return;` — silent skip, no error.
  - **Key prefix mismatch** (line 73-75): `if (snapshot.keyPrefix !== apiKeyPrefix) return;` — silent skip, no error.
  - **Unknown resource key** (line 80): `if (!resource) continue;` — skips silently.
  - **`Machine.fromSnapshot` failure** (line 82-84): If `Machine.fromSnapshot()` receives an unrecognized status, it throws (`@/query-v2/core/machines/Machine.ts:44: throw new Error(\`Unknown machine status: ...\``)`). This error is NOT caught by `hydrateSnapshot`.
  - **`resource.hydrateEntry` no-op on existing entries** (`@/query-v2/core/ResourceV2.ts:308`: `if (existing) return;`): silent skip.

- **Consumer path via `createApi`** (`@/query-v2/api/createApi.ts:84-89`):
  - `hydrateSnapshot` is called during `createResource` if `initialSnapshot` is provided.
  - Called per-resource, not for the entire registry at once.
  - No try/catch wrapping — a `Machine.fromSnapshot` error would propagate up to the `createResource` caller.

- **Test coverage** (`@/query-v2/snapshot/__tests__/Snapshot.test.ts`):
  - S1: Only `MachineSuccess` entries captured — ✓ tested.
  - S2: Hydration produces `MachineSuccess` — ✓ tested.
  - S3: `maxSnapshotDataAge` triggers invalidation — ✓ tested.
  - S4: Version mismatch → snapshot ignored — ✓ tested (verifies entries are not hydrated).
  - S5: Key prefix mismatch → silent skip — ✓ tested.
  - S6: Compare strategy throws on `getSnapshot` — ✓ tested.
  - S7: Round-trip — ✓ tested.
  - S8: `Machine.fromSnapshot` reconstructs — ✓ tested.
  - **NOT tested**: Malformed snapshot data (missing fields, wrong types), `Machine.fromSnapshot` with invalid status, snapshot with corrupt entries. No test verifies that an error IS thrown on loading failure.

### 6. JSDoc Coverage

#### Public API surface (`@/query-v2/api/`)

| Export | File | Has JSDoc |
|--------|------|-----------|
| `createApi()` | `@/query-v2/api/createApi.ts:11` | **No** |

#### Core implementation (`@/query-v2/core/`)

| Class/Function | File | Has JSDoc |
|----------------|------|-----------|
| `ResourceV2` class | `@/query-v2/core/ResourceV2.ts:46` | **No** (class-level) |
| `ResourceV2.createAgent()` | `@/query-v2/core/ResourceV2.ts:88` | **No** |
| `ResourceV2.query()` | `@/query-v2/core/ResourceV2.ts:90` | **No** |
| `ResourceV2.query$()` | `@/query-v2/core/ResourceV2.ts:168` | **No** |
| `ResourceV2.entry()` | `@/query-v2/core/ResourceV2.ts:191` | **No** |
| `ResourceV2.invalidate()` | `@/query-v2/core/ResourceV2.ts:229` | **No** |
| `ResourceV2.key` getter | `@/query-v2/core/ResourceV2.ts:287` | **Yes** (`/** Public key getter for API registry */`) |
| `ResourceV2.keyStrategy` getter | `@/query-v2/core/ResourceV2.ts:292` | **Yes** |
| `ResourceV2.getSerializedKey()` | `@/query-v2/core/ResourceV2.ts:297` | **Yes** |
| `ResourceV2.cacheEntries()` | `@/query-v2/core/ResourceV2.ts:302` | **Yes** |
| `ResourceV2.hydrateEntry()` | `@/query-v2/core/ResourceV2.ts:307` | **Yes** |
| `ResourceV2.hasEntry()` | `@/query-v2/core/ResourceV2.ts:322` | **Yes** |
| `ResourceV2.populateEntry()` | `@/query-v2/core/ResourceV2.ts:327` | **Yes** |
| `ResourceV2.createEntryPatch()` | `@/query-v2/core/ResourceV2.ts:346` | **Yes** |
| `ResourceV2.lockEntry()` | `@/query-v2/core/ResourceV2.ts:375` | **Yes** |
| `ResourceV2.onRefreshError()` | `@/query-v2/core/ResourceV2.ts:386` | **Yes** |
| `ResourceV2.resetCache()` | `@/query-v2/core/ResourceV2.ts:393` | **No** |
| `ResourceV2.scheduleGc()` | `@/query-v2/core/ResourceV2.ts:418` | **Yes** |
| `ResourceV2.cancelGc()` | `@/query-v2/core/ResourceV2.ts:435` | **Yes** |
| `CacheEntry` class | `@/query-v2/core/CacheEntry.ts:17` | **No** (class-level) |
| `CacheEntry.machine$` | `@/query-v2/core/CacheEntry.ts:42` | **No** |
| `CacheEntry.peek()` | `@/query-v2/core/CacheEntry.ts:46` | **No** |
| `CacheEntry.set()` | `@/query-v2/core/CacheEntry.ts:50` | **No** |
| `CacheEntry.complete()` | `@/query-v2/core/CacheEntry.ts:66` | **No** |
| `ResourceV2Agent` class | `@/query-v2/core/ResourceV2Agent.ts:18` | **No** (class-level) |
| `ResourceV2Agent.state$` | `@/query-v2/core/ResourceV2Agent.ts:97` | **No** |
| `ResourceV2Agent.start()` | `@/query-v2/core/ResourceV2Agent.ts:101` | **No** |
| `ReactHooksPlugin` class | `@/query-v2/plugins/ReactHooksPlugin.ts:28` | **No** (class-level) |
| `IReactHooksPluginContributions` | `@/query-v2/plugins/ReactHooksPlugin.ts:14` | **Yes** (`/** Contributions added by ReactHooksPlugin to resources */`) |

#### Machine classes (`@/query-v2/core/machines/`)

All machine classes (`MachineIdle`, `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`, `MachineWithData`, `Patcher`) have **zero JSDoc** comments.

#### Types (`@/query-v2/types/`)

All type files have **comprehensive JSDoc** on every interface, type, and field:
- `agent.types.ts` — all fields documented
- `api.types.ts` — all interfaces documented
- `cache.types.ts` — all interfaces documented
- `lifecycle.types.ts` — all interfaces documented
- `machine.types.ts` — all state types documented
- `plugin.types.ts` — all interfaces documented
- `resource.types.ts` — all interfaces documented
- `shared.types.ts` — all types documented
- `snapshot.types.ts` — all interfaces documented

#### Lib (`@/query-v2/lib/`)

| Export | File | Has JSDoc |
|--------|------|-----------|
| `stableStringify()` | `@/query-v2/lib/stableStringify.ts:5` | **Yes** |
| `SKIP` / `SKIP_TOKEN` | `@/query-v2/lib/SKIP_TOKEN.ts` | **No** |
| `NO_VALUE` | `@/query-v2/lib/NO_VALUE.ts` | **No** |

#### Snapshot

| Export | File | Has JSDoc |
|--------|------|-----------|
| `getSnapshot()` | `@/query-v2/snapshot/Snapshot.ts:12` | **Yes** |
| `hydrateSnapshot()` | `@/query-v2/snapshot/Snapshot.ts:57` | **Yes** |

#### Summary

- Types directory: **~100%** JSDoc coverage.
- Implementation classes (`ResourceV2`, `CacheEntry`, `ResourceV2Agent`, machines, `Patcher`): **No class-level JSDoc**. `ResourceV2` has JSDoc on ~11 of ~18 public/protected methods (utility getters, snapshot helpers, patch/lock methods); the critical query/entry/createAgent methods lack JSDoc.
- `createApi` function: **No JSDoc**.
- Machine classes: **Zero JSDoc**.

### 7. Optimistic Update Snapshot Content

- **Snapshot data structure** (`@/query-v2/types/snapshot.types.ts:17-23`):
  ```
  TResourceV2SnapshotSlice: { status: "success", args: unknown, data: TData, updatedAt: number }
  ```
  Four fields only. No `originalData`, no `patches`, no `error`.

- **`getSnapshot()` filtering** (`@/query-v2/snapshot/Snapshot.ts:30-40`):
  - Only `MachineSuccess` instances are included (`if (!(machine instanceof MachineSuccess)) continue`).
  - Extracts: `status`, `args`, `data`, `updatedAt` from `machine.state`.
  - Does NOT capture `originalData` or `patches` even though `TResourceV2SuccessState` includes them.

- **Effect of optimistic patches on snapshots**:
  - `MachineSuccess.state` (`@/query-v2/types/machine.types.ts:25-33`) has fields: `status`, `args`, `data`, `error`, `updatedAt`, `originalData`, `patches`.
  - When patches are active, `data` contains the patched (optimistic) data, while `originalData` holds the server-confirmed data.
  - `getSnapshot()` captures `data` (the patched version) but NOT `originalData` or `patches`.
  - A snapshot taken during an active optimistic operation would serialize the **optimistic** data, not the original server data.

- **`hydrateSnapshot()`** (`@/query-v2/snapshot/Snapshot.ts:78-84`):
  - Uses `Machine.fromSnapshot()` which only reconstructs a basic `MachineSuccess` with `{ data, args, updatedAt }` — no patch queue is restored.

- **Documentation review**:

  | Document | Describes snapshot contents | Mentions optimistic updates + snapshots |
  |----------|---------------------------|----------------------------------------|
  | `docs/query-v2/optimistic-updates.md` | **No** — explains `createPatch`/`commit`/`abort` lifecycle but does not mention snapshot interaction. | **No** |
  | `docs/query-v2/api-reference.md` | **Partially** — lists `TApiSnapshot`, `TResourceSnapshot`, `TResourceV2SnapshotSlice` types with field descriptions. States "Всегда success (только успешные записи)" for status. | **No** |
  | `docs/query-v2/ssr.md` | **Yes** — shows `TApiSnapshot` interface with all fields. States "Только записи в состоянии `success` включаются в snapshot" and "Snapshot не включает информацию о патчах или pending-запросах". | **Partially** — the limitations section mentions "патчи" are excluded, but does not describe what happens when a snapshot is taken during an active optimistic update (i.e., that `data` will be the optimistic version). |

- **Gaps**: None of the three docs describe:
  - That `data` in a snapshot taken during an optimistic update is the **patched** (optimistic) data, not the original server data.
  - That `originalData` and `patches` are not included in snapshots.
  - The implications: hydrating a snapshot taken mid-optimistic-update would install the optimistic data as if it were confirmed server data.

## Code References

- `@/query-v2/index.ts:1-43` — public barrel exports
- `@/query-v2/plugins/ReactHooksPlugin.ts:1-130` — React hooks inside plugin
- `@/query-v2/plugins/types.ts:1-5` — re-exports plugin types
- `@/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts` — plugin tests
- `@/query-v2/types/plugin.types.ts:1-62` — plugin interface + type machinery
- `@/query-v2/core/index.ts:1-6` — core barrel exports
- `@/query-v2/core/ResourceV2.ts:1-539` — resource implementation
- `@/query-v2/core/ResourceV2Agent.ts:1-135` — agent implementation (no devtools references)
- `@/query-v2/core/CacheEntry.ts:1-82` — cache entry with devtools push (`beforeDevtoolsPush` at line 27)
- `@/query-v2/core/CacheMap.ts:1-100+` — dual-strategy cache map
- `@/query-v2/core/LifecycleHooks.ts:1-100+` — lifecycle hook management
- `@/query-v2/core/machines/index.ts:1-8` — machine barrel exports
- `@/query-v2/core/machines/Machine.ts:1-53` — TMachineInstance union + factories
- `@/query-v2/core/machines/MachineIdle.ts` — idle state class
- `@/query-v2/core/machines/MachinePending.ts` — pending state class
- `@/query-v2/core/machines/MachineSuccess.ts` — success state class
- `@/query-v2/core/machines/MachineError.ts` — error state class
- `@/query-v2/core/machines/MachineRefreshing.ts` — refreshing state class
- `@/query-v2/core/machines/MachineWithData.ts` — abstract base with patch support
- `@/query-v2/core/machines/Patcher.ts` — Immer patch logic
- `@/query-v2/api/createApi.ts:1-104` — API factory (plugin wiring at lines 38-76)
- `@/query-v2/snapshot/Snapshot.ts:1-96` — getSnapshot + hydrateSnapshot
- `@/query-v2/snapshot/__tests__/Snapshot.test.ts:1-250` — 8 snapshot tests (S1-S8)
- `@/query-v2/types/agent.types.ts` — IResourceV2Agent, IResourceV2AgentState, IResourceV2Ref
- `@/query-v2/types/api.types.ts` — ICreateApiOptions, IApi
- `@/query-v2/types/cache.types.ts` — ICacheEntry, ICacheMap
- `@/query-v2/types/machine.types.ts` — TMachineStatus, all state types, TPatchFn, TMachine
- `@/query-v2/types/resource.types.ts` — IResourceV2Options, IResourceV2
- `@/query-v2/types/shared.types.ts` — TBeforeDevtoolsPushFn, TQueryFn, TSerializeArgsFn
- `@/query-v2/types/snapshot.types.ts` — TApiSnapshot, TResourceSnapshot, TResourceV2SnapshotSlice
- `@/query-v2/types/lifecycle.types.ts` — lifecycle hook types
- `@/query-v2/lib/SKIP_TOKEN.ts` — SKIP sentinel
- `@/query-v2/lib/NO_VALUE.ts` — NO_VALUE sentinel
- `@/query-v2/lib/stableStringify.ts` — deterministic JSON.stringify
- `@/common/devtools/types.ts` — DevtoolsLike interface
- `@/common/devtools/reduxDevtools.ts` — Redux DevTools driver
- `@/common/devtools/combineDevtools.ts` — devtools multiplexer
- `@/query/react/` — v1 hooks (useResourceAgent, useResourceRef, useCommandAgent, useOperationAgent)
- `docs/query-v2/optimistic-updates.md` — optimistic updates documentation
- `docs/query-v2/api-reference.md` — API reference documentation
- `docs/query-v2/ssr.md` — SSR/snapshot documentation

## Files Affected by Fixes

| # | Fix Area | Files to Modify | Files to Create/Move |
|---|----------|----------------|---------------------|
| 1 | React hooks without plugin | `@/query-v2/plugins/ReactHooksPlugin.ts`, `@/query-v2/api/createApi.ts`, `@/query-v2/index.ts`, `@/query-v2/types/plugin.types.ts` | Potentially extract hooks into standalone functions |
| 2 | React hooks in `react/` folder | `@/query-v2/plugins/ReactHooksPlugin.ts`, `@/query-v2/index.ts` | `@/query-v2/react/useResourceV2Agent.ts`, `@/query-v2/react/useResourceV2Ref.ts`, `@/query-v2/react/index.ts` |
| 3 | Core split into common/machines/resource | `@/query-v2/core/index.ts`, `@/query-v2/core/CacheEntry.ts`, `@/query-v2/core/CacheMap.ts`, `@/query-v2/core/LifecycleHooks.ts`, `@/query-v2/core/ResourceV2.ts`, `@/query-v2/core/ResourceV2Agent.ts` | `@/query-v2/core/common/`, `@/query-v2/core/resource/` (machines/ already exists) |
| 4 | DevTools agent state | `@/query-v2/core/CacheEntry.ts` | — (Agent already doesn't push; `CacheEntry` pushes machine state only) |
| 5 | Snapshot loading errors | `@/query-v2/snapshot/Snapshot.ts`, `@/query-v2/snapshot/__tests__/Snapshot.test.ts` | — |
| 6 | JSDoc comments | `@/query-v2/api/createApi.ts`, `@/query-v2/core/ResourceV2.ts`, `@/query-v2/core/CacheEntry.ts`, `@/query-v2/core/ResourceV2Agent.ts`, `@/query-v2/plugins/ReactHooksPlugin.ts`, all files in `@/query-v2/core/machines/` | — |
| 7 | Snapshot docs for optimistic updates | `docs/query-v2/optimistic-updates.md`, `docs/query-v2/api-reference.md`, `docs/query-v2/ssr.md` | — |
