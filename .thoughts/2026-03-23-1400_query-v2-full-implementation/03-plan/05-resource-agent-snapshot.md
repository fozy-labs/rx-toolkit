---
title: "Phase 5: Core — ResourceV2, Agent & Snapshot"
date: 2026-03-25
stage: 03-plan
role: rdpi-planner
---

## Goal

Implement the ResourceV2 orchestrator (query coordination, CacheMap management, GC lifecycle, SWR, resetAll), ResourceV2Agent (per-consumer stateful observer), Snapshot capture/hydration, and finalize the core layer barrel exports.

## Dependencies

- **Requires**: Phase 4 (ResourceV2CacheEntry, LifecycleHooks)
- **Blocks**: Phase 6

## Execution

Sequential. ResourceV2 first (Agent depends on its `_getEntry` callback), then Agent, then Snapshot (depends on ResourceV2 for traversal), then barrel finalization.

## Tasks

### Task 5.1: Create ResourceV2

- **File**: `src/query-v2/core/Resource/ResourceV2.ts`
- **Action**: Create
- **Complexity**: High
- **Description**: Implement `ResourceV2<TArgs, TData>` — the main resource orchestrator.
- **Details**:
  - **Constructor** receives `IResourceV2Options<TArgs, TData>`:
    - `queryFn: TQueryFn`
    - `cacheLifetime?: number | false` (default: 60_000ms — ADR-5)
    - `serializeArgs?` / `compareArgs?` for CacheMap strategy selection
    - `onCacheEntryAdded?`, `onQueryStarted?` lifecycle hooks
  - **CacheMap**: uses `createCacheMap()` factory from Phase 3 to instantiate the correct map implementation
  - **Public methods** (matching `IResourceV2<TArgs, TData>` — all use `ArgsOrVoid<TArgs>` rest-parameter ergonomics):
    - **`createAgent(): ResourceV2Agent<TArgs, TData>`** — creates and returns a new `ResourceV2Agent`, passing `_getEntry` and `_compareArgs` callbacks. Required by Tasks 6.2 and 7.1.
    - **`query(...args: [...ArgsOrVoid<TArgs>, doForce?: boolean]): Promise<TData>`** — convenience: gets or creates entry for args, then delegates to `entry.query(doForce)`
    - **`getEntry(...args: ArgsOrVoid<TArgs>): IResourceV2CacheEntry<TArgs, TData> | null`** — returns the existing cache entry for the given args, or `null` if no entry exists. Does NOT create entries.
    - **`getEntry(...args: [...ArgsOrVoid<TArgs>, doInitiate: true]): IResourceV2CacheEntry<TArgs, TData>`** — overload: when `doInitiate` is `true`, creates the entry via `cacheMap.getOrCreate(args)` if it doesn't exist, fires `onCacheEntryAdded` for new entries. Always returns a non-null entry.
    - **`getEntry$(...args: ArgsOrVoid<TArgs>): IResourceV2CacheEntry<TArgs, TData> | null`** — reactive version via `Signal.compute`. Returns `null` when no entry exists or after `resetAll()` (reads `_status$` signal).
    - **`getEntry$(...args: [...ArgsOrVoid<TArgs>, doInitiate: true]): IResourceV2CacheEntry<TArgs, TData>`** — reactive overload: forces creation when `doInitiate` is `true`. Always returns non-null.
    - **`invalidate(...args: ArgsOrVoid<TArgs>): void`** — looks up the corresponding ResourceV2CacheEntry and delegates to `entry.invalidate()`
  - **`resetCache()`** — internal method (called by createApi's `resetAll()`): resets all machines to idle, completes entries, clears CacheMap, calls `lifecycleHooks.clearAll()`, sets `_status$("idle")`
  - **GC lifecycle** (ADR-5):
    - Each entry tracked via `share({ resetOnRefCountZero })` pattern from RxJS
    - When refcount drops to 0, start `cacheLifetime` timer
    - If timer expires with no re-subscription, remove entry from CacheMap
    - `cacheLifetime: false` disables GC entirely (for testing)
  - **SWR** (ADR-3): delegated to ResourceV2CacheEntry (keeps previous data during refetch)
  - **`_getEntry`** callback: exposed for Agent (returns entry for given args)
  - **`_compareArgs`** callback: exposed for Agent (uses CacheMap equality semantics)
  - **Reactive chain**: `Signal.state` → `Signal.compute` pipeline connected through CacheEntry signals
  - **Reactive reset** (ADR-11): maintains `_status$: SignalFn<"idle" | "ready">` and `_lastEntry$: SignalFn<ResourceV2CacheEntry | null>` internal signals. `getEntry$` is a `Signal.compute` reading both. `resetCache()` sets `_status$("idle")`, causing all `getEntry$` computeds to return null — consumers see fresh state after reset
  - [ref: ../02-design/03-model.md#§7, ../02-design/01-architecture.md#§3.2, ../02-design/02-dataflow.md#GC-lifecycle, ../02-design/04-decisions.md#ADR-3, ADR-5, ADR-11]

### Task 5.2: Create ResourceV2Agent

- **File**: `src/query-v2/core/Resource/ResourceV2Agent.ts`
- **Action**: Create
- **Complexity**: High
- **Description**: Implement `ResourceV2Agent<TArgs, TData>` — per-consumer stateful observer of a resource entry.
- **Details**:
  - **Constructor** receives `_getEntry: (args) => RCE`, `_compareArgs: (a, b) => boolean`
  - **`start(args: SKIP_TOKEN): void`** / **`start(...args: ArgsOrVoid<TArgs>): void`**:
    - If `SKIP` → disconnect from any entry, `state$` produces idle-like state
    - If new args differ from current (via `_compareArgs`) → switch to new entry via `_getEntry(args)`, trigger query, update `_tracking$` (previous/current entry pair)
    - If same args → no-op
  - **`state$: ComputeFn<IResourceV2AgentState<TArgs, TData>>`** — derived computed signal:
    - Reads from `_tracking$` (previous/current RCE pair)
    - Produces `IResourceV2AgentState` with: `status`, `data`, `error`, `args`, `isLoading`, `isInitialLoading`, `isRefreshing`, `isSuccess`, `isError`, `entry`
    - `data` is `TData | null` — carries previous entry's data during SWR pending (ADR-3)
    - Updates reactively when underlying machine changes
  - **`compareArgs(a: TArgs, b: TArgs): boolean`** — delegates to `_compareArgs`
  - **No direct dependency on ResourceV2 class** — only callbacks (ADR-18)
  - Uses `Batcher` from `@/signals` for multi-signal atomic updates
  - [ref: ../02-design/03-model.md#§8, ../02-design/04-decisions.md#ADR-18]

### Task 5.3: Create Resource barrel export

- **File**: `src/query-v2/core/Resource/index.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Barrel re-export `ResourceV2`, `ResourceV2CacheEntry`, `ResourceV2Agent`.
- **Details**:
  - [ref: ../02-design/01-architecture.md#§2]

### Task 5.4: Create Snapshot module

- **File**: `src/query-v2/core/Snapshot.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Implement snapshot capture (`getSnapshot`) and hydration (`hydrateSnapshot`) logic.
- **Details**:
  - **`getSnapshot(resources: Map<string, ResourceV2>): TApiSnapshot`**:
    - Iterates all resources, for each iterates all CacheMap entries
    - Extracts `.state` from each machine instance (TMachineState serializable data)
    - Packages into `TApiSnapshot` with `CURRENT_SNAPSHOT_VERSION`
  - **`hydrateSnapshot(resources: Map<string, ResourceV2>, snapshot: TApiSnapshot): void`**:
    - Validates snapshot version
    - For each resource in snapshot, creates entries in CacheMap
    - Hydrates each entry with `Machine.fromSnapshot(state)` → writes to entry signal
    - Three-phase lifecycle: save on server → consume per-resource on client → delete on resetAll
  - Error handling: malformed snapshot entries are skipped with console warning
  - [ref: ../02-design/03-model.md#§10, §12, ../02-design/02-dataflow.md#snapshot-scenarios, ../02-design/04-decisions.md#ADR-8]

### Task 5.5: Create core barrel export

- **File**: `src/query-v2/core/index.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Barrel re-export all core modules: `machines/`, `CacheEntry`, `CacheMap/`, `LifecycleHooks`, `Resource/`, `Snapshot`.
- **Details**:
  - [ref: ../02-design/01-architecture.md#§2]

### Task 5.6: Create ResourceV2 tests

- **File**: `src/query-v2/core/Resource/__tests__/ResourceV2.test.ts`
- **Action**: Create
- **Complexity**: High
- **Description**: Test ResourceV2 orchestration, CacheMap integration, GC, and SWR.
- **Details**:
  ResourceV2 core:
  - RE01: `resource.query(args)` — creates entry, fetches, returns data on success
  - RE02: `resource.query(args)` — deduplicates in-flight requests (same args)
  - RE03: `resource.query(args)` — force=true skips dedup
  - RE04: `resource.query(args)` — error state: retry on re-query
  - RE05: `resource.query(args)` — cached success: no re-fetch
  - RE06: `resource.getEntry(args)` returns null when no entry
  - RE07: `resource.getEntry(args, true)` creates entry if needed
  - RE08: `resource.getEntry$(args)` is reactive to resetAll
  - RE09: `resource.invalidate(args)` — success → refreshing → refetch
  - RE10: `resource.invalidate(args)` — non-success entry: no-op
  - RE11: Args change: old entry's request continues independently
  - RE12: Refresh error (ADR-2): errorHappened on refreshing preserves stale data
  - RE13: ResourceV2 internal `compareArgs(a, b)` uses configured strategy
  - RE14: ResourceV2 internal `resetCache()` — aborts all, clears GC, completes entries, clears map
  - RE15: ResourceV2 internal `cacheEntries()` iterates all entries (for snapshot)
  - RE16: ResourceV2 internal `hydrateEntry(args, machine)` — creates entry from snapshot
  - RE18: ResourceV2 internal `hasEntry(args)` checks existence
  - RE19: Batcher.run wraps state transitions (batched updates)

  ResourceV2 — _status$ Signal (ADR-11):
  - RE20: `_status$` starts as "idle"
  - RE21: `_status$` transitions to "ready" on first query
  - RE22: `_status$` reverts to "idle" on `resetCache()`
  - RE23: `getEntry$(args)` returns null when _status$ is "idle"

  GC lifecycle:
  - GC01: GC timer starts when refcount drops to 0
  - GC02: GC timer cancelled when new subscriber arrives
  - GC03: `cacheLifetime: false` disables GC entirely
  - GC04: GC fires: complete(), delete from cache, fire lifecycle hook
  - GC05: Rapid subscribe/unsubscribe — timer resets correctly
  - [ref: ../02-design/06-testcases.md#RE01–RE23, GC01–GC05]

### Task 5.7: Create ResourceV2Agent tests

- **File**: `src/query-v2/core/Resource/__tests__/ResourceV2Agent.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test agent lifecycle, args management, and reactive state projection.
- **Details**:
  - AG01: `agent.start(args)` obtains entry via `_getEntry` callback and calls `entry.query()`
  - AG02: `agent.state$` derives flat state from machine
  - AG03: SWR: previous data shown while loading new args
  - AG04: SWR: previous cleared when current resolves
  - AG05: `isInitialLoading` — true only with no previous data
  - AG06: `isInitialLoading` — false when SWR data exists
  - AG07: `start(SKIP)` — agent stays idle
  - AG08: Same args: no re-fetch when already in success/pending
  - AG09: Same args in error state: triggers retry
  - AG10: Rapid arg changes: only latest args tracked
  - AG11: SWR chain protection: rapid change doesn't accumulate previous entries
  - AG12: `agent.state$` is a ComputeFn — reactive to signal changes
  - AG13: `agent.compareArgs(a, b)` delegates to resource
  - AG14: `entry` field on agent state provides consumer entry handle
  - AG15: `isRefreshing` true during refreshing state
  - AG16: `isError` true on error, `error` carries the thrown value
  - AG17: `args` field reflects current agent args
  - AG18: `args` is null when agent is idle/SKIP
  - [ref: ../02-design/06-testcases.md#AG01–AG18]

### Task 5.8: Create Snapshot tests

- **File**: `src/query-v2/core/__tests__/Snapshot.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test snapshot capture and hydration for SSR.
- **Details**:
  - SN01: `getSnapshot()` captures only success entries
  - SN02: `getSnapshot()` includes version and keyPrefix
  - SN03: `hydrateSnapshot(resources: Map<string, ResourceV2>, snapshot)` reconstructs machine instances via `Machine.fromSnapshot()`
  - SN04: `createApi({initialSnapshot})` throws on version mismatch at save time
  - SN05: `createApi({initialSnapshot})` throws on keyPrefix mismatch at save time
  - SN06: `createResourceV2()` with no matching snapshot slice — no hydration, no warning
  - SN07: Per-resource hydration populates empty cache from snapshot slice
  - SN08: `maxSnapshotDataAge`: expired entry auto-invalidated at `createResourceV2` time
  - SN09: Full round-trip: getSnapshot → JSON.stringify → JSON.parse → createApi({initialSnapshot}) → createResourceV2
  - SN10: `getSnapshot()` throws for compare strategy resources
  - SN11: Snapshot slice is deleted from `_savedSnapshot` after `createResourceV2` consumes it
  - SN12: `resetAll()` deletes `_savedSnapshot`
  - [ref: ../02-design/06-testcases.md#SN01–SN12]

### Task 5.9: Update module barrel

- **File**: `src/query-v2/index.ts`
- **Action**: Modify
- **Complexity**: Low
- **Description**: Add core layer re-exports to module barrel.
- **Details**:
  - Re-export: `Machine`, all machine classes, `Patcher`, `CacheEntry`, `ResourceV2`, `ResourceV2CacheEntry`, `ResourceV2Agent`, `LifecycleHooks`
  - Re-export snapshot: `getSnapshot`, `CURRENT_SNAPSHOT_VERSION`
  - Do NOT export core-layer `hydrateSnapshot` — it is internal only (takes `Map<string, ResourceV2>` parameter). The public `hydrateSnapshot` (taking `IApi` parameter) will be added in Phase 6 from the api layer.
  - Do NOT export CacheMap internals (SerializeCacheMap, CompareCacheMap) — internal only
  - Keep existing types and lib exports
  - [ref: ../02-design/01-architecture.md#§5]

## Verification

- [ ] `npm run ts-check` passes
- [ ] `npx vitest run src/query-v2/core/Resource/__tests__/ResourceV2.test.ts` — RE01–RE23, GC01–GC05 pass
- [ ] `npx vitest run src/query-v2/core/Resource/__tests__/ResourceV2Agent.test.ts` — AG01–AG18 pass
- [ ] `npx vitest run src/query-v2/core/__tests__/Snapshot.test.ts` — SN01–SN12 pass
- [ ] GC tests use real/fake timers and verify cleanup lifecycle
- [ ] Agent communicates with ResourceV2 only via `_getEntry`/`_compareArgs` callbacks
- [ ] No imports from api/, react/, plugins/ layers
