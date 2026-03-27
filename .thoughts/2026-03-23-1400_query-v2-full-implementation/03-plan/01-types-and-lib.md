---
title: "Phase 1: Types & Lib Layer"
date: 2026-03-25
stage: 03-plan
role: rdpi-planner
---

## Goal

Establish the foundational type system and utility library that all higher layers depend on. Creates the `src/query-v2/` directory structure, all shared type definitions, and the lib layer with pure utility functions.

## Dependencies

- **Requires**: None (first phase)
- **Blocks**: Phase 2, Phase 3

## Execution

Sequential within sub-groups; type files can be created in parallel, lib files can be created in parallel.

## Tasks

### Task 1.1: Create shared type definitions — machine types

- **File**: `src/query-v2/types/machine.types.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Define all machine-related types: `TMachineStatus` string literal union (`"idle" | "pending" | "success" | "error" | "refreshing"`), `TPatchStatus` string literal union (`"pending" | "committed" | "aborted"`), `TPatch` (no generic — `{ patches: Patch[], inversePatches: Patch[], status: TPatchStatus }`), `TPatchState<TData>` (`{ originalData, patches, isConsistencyViolation }`), `TIdleState`, `TPendingState<TArgs>`, `TSuccessState<TArgs, TData>`, `TErrorState<TArgs>`, `TRefreshingState<TArgs, TData>`, `TMachineState<TArgs, TData>` discriminated union, `TMachineInstance<TArgs, TData>` union of all machine classes, `IPatchHandle` (no generic), `CreatePatchResult<TArgs, TData>`, `IMachineStatic` factory interface.
- **Details**:
  - `TMachineStatus` and `TPatchStatus` are string literal unions
  - All states carry `status`; data-bearing states (`success`, `refreshing`) add `data`, `updatedAt`, `patchState`
  - `IPatchHandle` has only `{ commit(): void; abort(): void }` — no generics, no `undo()`, no `state`
  - `CreatePatchResult<TArgs, TData>` returns `{ machine: MachineWithData<TArgs, TData>, patchHandle: IPatchHandle }`
  - Import `Patch` type from `immer`
  - [ref: ../02-design/03-model.md#§2, §3]

### Task 1.2: Create shared type definitions — cache types

- **File**: `src/query-v2/types/cache.types.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Define `ICacheEntry<TState>` interface (`state$()`, `peek()`, `set()`, `complete()`, `onClean$`, `obs`), `ICacheEntryOptions`, `ICacheMap<TArgs, TEntry>` interface (`get`, `getOrCreate`, `delete`, `has`, `clear`, `entries`, `size`, `values`), `ICacheMapOptions<TArgs, TEntry>`, `TCacheMapFactory<TArgs, TEntry>` type.
- **Details**:
  - `ICacheEntry<TState>` is a generic internal reactive container wrapping a `Signal.state<TState>`
  - `state$()` — reactive read (registers signal dependency)
  - `peek()` — non-reactive read
  - `set(state)` — update stored state (no-op if completed)
  - `complete()` — fires `onClean$` and marks completed; subsequent `set()` calls are no-ops
  - `onClean$: Subject<void>` — cleanup observable, fires on `complete()`
  - `obs: Observable<TState>` — RxJS Observable bridge for GC via `share({resetOnRefCountZero})`
  - `ICacheEntryOptions` has `keyParts?: string[]` and `beforeDevtoolsPush?` callback
  - `ICacheMap<TArgs, TEntry>` — generic storage container with no `TData` parameter. `TEntry` is unconstrained. Methods: `get`, `getOrCreate`, `delete`, `has`, `clear`, `size`, `values`, `entries`
  - `TCacheMapFactory<TArgs, TEntry>` is `(args: TArgs) => TEntry` — factory function called by CacheMap to create entries
  - `ICacheMapOptions<TArgs, TEntry>` has `factory: TCacheMapFactory<TArgs, TEntry>`, `keyStrategy`, `serializeArgs?`, `compareArg?`, `doCacheArgs?`
  - [ref: ../02-design/03-model.md#§5, §6]

### Task 1.3: Create shared type definitions — resource types

- **File**: `src/query-v2/types/resource.types.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Define `TQueryFn<TArgs, TData>`, `TSerializeArgsFn<TArgs>`, `TCompareArgsFn<TArgs>`, `IResourceV2Options<TArgs, TData>`, `IResourceV2<TArgs, TData>`, `IResourceV2CacheEntry<TArgs, TData>` (extends `ICacheEntry<TMachineInstance<TArgs, TData>>` with `machine$`, `isMyArgs`, `createPatch`, `invalidate`, `query`).
- **Details**:
  - `TQueryFn` signature: `(args: TArgs, tools: { abortSignal: AbortSignal }) => Promise<TData>`
  - `IResourceV2Options` includes `queryFn`, `key?`, `cacheLifetime?`, `serializeArgs?`, `compareArg?`, `onCacheEntryAdded?`, `onQueryStarted?`, `beforeDevtoolsPush?`, `maxSnapshotDataAge?`, `doCacheArgs?`
  - `IResourceV2<TArgs, TData>` — five public methods (all use `ArgsOrVoid<TArgs>` rest-parameter ergonomics):
    - `createAgent(): IResourceV2Agent<TArgs, TData>` — create an agent (SWR observer)
    - `query(...args: [...ArgsOrVoid<TArgs>, doForce?: boolean]): Promise<TData>` — execute query, return promise of data
    - `getEntry(...args: ArgsOrVoid<TArgs>): IResourceV2CacheEntry<TArgs, TData> | null` and `getEntry(...args: [...ArgsOrVoid<TArgs>, doInitiate: true]): IResourceV2CacheEntry<TArgs, TData>` — non-reactive cache entry access (two overloads: returns null when no entry, or forces creation with `doInitiate: true`)
    - `getEntry$(...args: ArgsOrVoid<TArgs>): IResourceV2CacheEntry<TArgs, TData> | null` and `getEntry$(...args: [...ArgsOrVoid<TArgs>, doInitiate: true]): IResourceV2CacheEntry<TArgs, TData>` — reactive cache entry access via Signal.compute (two overloads, same semantics as `getEntry`; returns null after `resetAll()`)
    - `invalidate(...args: ArgsOrVoid<TArgs>): void` — force re-fetch for args in success state
  - `IResourceV2CacheEntry` extends `ICacheEntry<TMachineInstance<TArgs, TData>>` — public interface: `machine$` (reactive signal alias for `state$()`), `isMyArgs(args): boolean`, `createPatch(patchFn): IPatchHandle | null`, `invalidate(): void`, `query(doForce?: boolean): Promise<TData>`
  - ArgsOrVoid ergonomics: `TArgs = void` makes args parameter optional
  - [ref: ../02-design/03-model.md#§7.1, §7.2b, §7.3]

### Task 1.4: Create shared type definitions — agent types

- **File**: `src/query-v2/types/agent.types.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Define `IResourceV2AgentState<TArgs, TData>` (status, data, error, args, isLoading, isInitialLoading, isRefreshing, isSuccess, isError, entry), `IResourceV2Agent<TArgs, TData>` (`state$`, `start()`, `compareArgs()`).
- **Details**:
  - `IResourceV2Agent.state$: ComputeFn<IResourceV2AgentState<TArgs, TData>>` — reactive computed state signal
  - `start(args: SKIP_TOKEN): void` and `start(...args: ArgsOrVoid<TArgs>): void` — starts observing a resource with given args; passing SKIP disables observation
  - `compareArgs(a: TArgs, b: TArgs): boolean` — compares args using resource strategy
  - No `signal`, `current`, `setArgs()`, or `destroy()` — lifecycle managed by ResourceV2
  - `IResourceV2AgentState.data` is `TData | null` (not narrowed by status) because Agent composes state from two entries (previous/current) for SWR (ADR-3)
  - [ref: ../02-design/03-model.md#§8.1]

### Task 1.5: Create shared type definitions — lifecycle types

- **File**: `src/query-v2/types/lifecycle.types.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Define `ICacheEntryAddedTools<TData>`, `IQueryStartedTools<TArgs, TData>`, `TOnCacheEntryAdded<TArgs, TData>` callback type, `TOnQueryStarted<TArgs, TData>` callback type.
- **Details**:
  - `ICacheEntryAddedTools<TData>` provides `$cacheDataLoaded: Promise<TData>` (resolves on first MachineSuccess), `$cacheEntryRemoved: Promise<void>` (resolves on GC/resetAll)
  - `IQueryStartedTools<TArgs, TData>` provides `$queryFulfilled: Promise<{ data: TData }>` (resolves/rejects on query completion), `getCacheEntry: () => IResourceV2CacheEntry<TArgs, TData>`
  - [ref: ../02-design/03-model.md#§9]

### Task 1.6: Create shared type definitions — snapshot types

- **File**: `src/query-v2/types/snapshot.types.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Define `CURRENT_SNAPSHOT_VERSION` constant, `TResourceV2SnapshotSlice<TData = unknown>` (per-entry serialized state — no `TArgs` generic), `TResourceSnapshot` (per-resource map), `TApiSnapshot` (all resources, version).
- **Details**:
  - `CURRENT_SNAPSHOT_VERSION` is a numeric constant (value: `1`)
  - `TResourceV2SnapshotSlice<TData = unknown>` has `status: "success"`, `args: unknown`, `data: TData`, `updatedAt: number` — only success entries are snapshotted
  - `TResourceSnapshot` has `entries: Record<string, TResourceV2SnapshotSlice>`
  - `TApiSnapshot` has `version: typeof CURRENT_SNAPSHOT_VERSION`, `keyPrefix: string | null`, `resources: Record<string, TResourceSnapshot>`
  - [ref: ../02-design/03-model.md#§10]

### Task 1.7: Create shared type definitions — plugin types

- **File**: `src/query-v2/types/plugin.types.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Define `IPluginContext` (no generics — resource access context for plugins), `IPlugin` interface, `PluginResourceContributions<TPlugin, TArgs, TData>` conditional type (3 type params), `PluginAugmentations<TPlugins, TArgs, TData>` intersection type (3 type params), `IReactHooksPluginContributions<TArgs, TData>` for the built-in React hooks plugin.
- **Details**:
  - `IPluginContext` has no type parameters — provides `keyStrategy: "serialize" | "compare"` to plugins
  - `PluginResourceContributions<TPlugin, TArgs, TData>` maps a single plugin type to its contributed resource methods via conditional types (NOT `declare module` — ADR-9)
  - `PluginAugmentations<TPlugins extends readonly IPlugin[], TArgs, TData>` merges contributions from all plugins via `Prettify<UnionToIntersection<PluginResourceContributions<TPlugins[number], TArgs, TData>>>`
  - `Object.assign` merge strategy for augmentations at runtime
  - `IReactHooksPluginContributions<TArgs, TData>` defines `useResourceV2Agent` hook signature on resources
  - [ref: ../02-design/03-model.md#§11, ../02-design/04-decisions.md#ADR-9]

### Task 1.8: Create shared type definitions — utility types & API types

- **File**: `src/query-v2/types/shared.types.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Define `ArgsOrVoid<TArgs>`, `ArgsOrVoidOrSkip<TArgs>`, `Prettify<T>`, `UnionToIntersection<U>` utility types.
- **Details**:
  - `ArgsOrVoid` makes args optional when `TArgs = void`
  - `ArgsOrVoidOrSkip` extends the above to accept SKIP token
  - [ref: ../02-design/03-model.md#§8.1]

---

- **File**: `src/query-v2/types/api.types.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Define `ICreateApiOptions<TPlugins>` (keyPrefix, keyStrategy, serializeArgs, compareArg, cacheLifetime, plugins, initialSnapshot, maxSnapshotDataAge, doCacheArgs), `IApi<TPlugins>` interface with `createResourceV2()`, `resetAll()`, `getSnapshot()`.
- **Details**:
  - `IApi<TPlugins>` is generic only over plugins (no `TResources` generic, no `resources` property)
  - `createResourceV2<TArgs, TData>(options): IResourceV2<TArgs, TData> & PluginAugmentations<TPlugins, TArgs, TData>` — factory method for creating resources
  - `resetAll()` — resets all resources, clears saved snapshot
  - `getSnapshot(): TApiSnapshot` — captures snapshot (throws if `keyStrategy: "compare"`)
  - `ICreateApiOptions` has no `resources` parameter — resources are created via `api.createResourceV2()` after API construction
  - [ref: ../02-design/03-model.md#§12.1, ../02-design/04-decisions.md#ADR-15]

### Task 1.9: Create types barrel export

- **File**: `src/query-v2/types/index.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Barrel re-export all type files: `machine.types`, `cache.types`, `resource.types`, `agent.types`, `lifecycle.types`, `snapshot.types`, `plugin.types`, `shared.types`, `api.types`.
- **Details**: Export only types (`export type { ... } from ...`). No runtime code in the types layer.
  - [ref: ../02-design/01-architecture.md#§2]

### Task 1.10: Create SKIP_TOKEN

- **File**: `src/query-v2/lib/SKIP_TOKEN.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Define `SKIP` unique symbol and `SKIP_TOKEN` type guard/token for skipping resource observation.
- **Details**:
  - `const SKIP: unique symbol`
  - `type SKIP_TOKEN = typeof SKIP`
  - When passed as args to Agent.setArgs(), disables observation
  - Follow pattern from `src/query/SKIP_TOKEN.ts`
  - [ref: ../02-design/03-model.md#§8.1]

### Task 1.11: Create stableStringify utility

- **File**: `src/query-v2/lib/stableStringify.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Implement `stableStringify(value: unknown): string` — deterministic JSON serialization with sorted keys.
- **Details**:
  - Used by `SerializeCacheMap` to convert args to cache keys
  - Must handle nested objects, arrays, null, undefined, primitives
  - Must produce identical output for semantically equal objects regardless of key insertion order
  - [ref: ../02-design/03-model.md#§16.1]

### Task 1.12: Create lib barrel export

- **File**: `src/query-v2/lib/index.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Barrel re-export: `SKIP_TOKEN`, `stableStringify`.
- **Details**:
  - [ref: ../02-design/01-architecture.md#§2]

### Task 1.13: Create lib test — SKIP_TOKEN

- **File**: `src/query-v2/lib/__tests__/SKIP_TOKEN.test.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Test `SKIP` token identity and type.
- **Details**:
  - L01: SKIP is a unique symbol
  - Verify `typeof SKIP === 'symbol'`
  - [ref: ../02-design/06-testcases.md#L01]

### Task 1.14: Create lib test — stableStringify

- **File**: `src/query-v2/lib/__tests__/stableStringify.test.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Test stableStringify correctness for all input types.
- **Details**:
  - L02: `stableStringify` — plain object with sorted keys
  - L03: `stableStringify` — nested objects
  - L04: `stableStringify` — arrays preserved in order
  - L05: `stableStringify` — null and undefined handling
  - L06: `stableStringify` — primitives (string, number, boolean)
  - L07: `stableStringify` — empty object and empty array
  - L08: `stableStringify` — determinism: same output for same input across calls
  - L09: `stableStringify` — Date/Map/Set fallback (no crash)
  - [ref: ../02-design/06-testcases.md#L02–L09]

### Task 1.15: Create module barrel (initial)

- **File**: `src/query-v2/index.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Create initial module barrel that re-exports from `types/` and `lib/`. This will be incrementally expanded in later phases.
- **Details**:
  - Re-export all public types
  - Re-export `SKIP` from lib
  - Re-export `stableStringify` from lib
  - [ref: ../02-design/01-architecture.md#§5]

## Verification

- [ ] `npm run ts-check` passes
- [ ] `npx vitest run src/query-v2/lib/` — all lib tests pass (L01–L09)
- [ ] No runtime code in `types/` — only type exports
- [ ] All type files import only from `immer` (external) or peer type files — no upward imports
- [ ] Module barrel `src/query-v2/index.ts` compiles and re-exports correctly
