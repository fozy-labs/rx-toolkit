# Verification: 03-model.md

**Date**: 2026-03-25
**Document**: `02-design/03-model.md`
**Issues reference**: `02-design/REVIEW.md`

## Results Summary

| Total | PASS | FAIL |
|-------|------|------|
| 28    | 28   | 0    |

## Issue-by-Issue Verification

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| 1 | V2 suffix consistently applied | PASS | All public query-v2 types use V2: `IResourceV2`, `IResourceV2CacheEntry`, `IResourceV2Agent`, `IResourceV2AgentState`, `ResourceV2CacheEntry`, `ResourceV2Agent`, `TResourceV2SnapshotSlice`, `createResourceV2`, `useResourceV2Agent`. Base internals (`CacheEntry`, `CacheMap`, `Machine*`, `Patcher`) correctly omit V2 as shared infrastructure. |
| 3 | Dependency chain explicit | PASS | §6.4 shows ResourceV2 → factory callback → ResourceV2CacheEntry. §6.3 states CacheMap is fully generic. §7.3 shows ResourceV2CacheEntry extends CacheEntry. Chain: Resource → (uses) CacheMap\<TArgs, RCE\> via factory → RCE extends CacheEntry. |
| 3.1 | No direct ResourceV2 → CacheEntry dependency | PASS | §7.2 `IResourceV2` references only `IResourceV2CacheEntry`, never `ICacheEntry`. §6.4 construction code creates `ResourceV2CacheEntry` instances — no import or reference to raw `CacheEntry` from ResourceV2 level. |
| 6 | ResourceV2CacheEntry inherits CacheEntry | PASS | §7.3 concrete class: `class ResourceV2CacheEntry<TArgs, TData> extends CacheEntry<TMachineInstance<TArgs, TData>>`. Interface: `IResourceV2CacheEntry extends ICacheEntry<TMachineInstance<TArgs, TData>>`. |
| 9 | CacheMap has no knowledge of CacheEntry | PASS | §6 header: "TEntry is intentionally unconstrained — CacheMap is a pure generic container." §6.3: "CacheMap has no knowledge of CacheEntry or ResourceV2CacheEntry — it is fully generic over TEntry (unconstrained)." No constraint on TEntry in `ICacheMap<TArgs, TEntry>`. |
| 11 | ResourceV2CacheEntry has invalidate(), query() | PASS | §7.3 `IResourceV2CacheEntry`: `invalidate(): void` and `query(doForce?: boolean): Promise<TData>` both present. Invalidate described as "transitions success → refreshing, then calls query() internally". Query described as "Manages AbortController internally. Deduplicates inflight requests at the entry level." |
| 12 | Patcher output with isConsistencyViolation | PASS | §2 `TPatchState<TData>` has `isConsistencyViolation: boolean`. §4 `IPatchResolution<TData>` returns `patchState: TPatchState<TData> \| null`. All Patcher methods (`resolvePatches`, `finishPatch`, `abortAllPending`) return `IPatchResolution<TData>`. Ref to open-questions Q6 present. |
| 13 | "snapshot" variable renamed | PASS | §12.1 uses `_savedSnapshot: TApiSnapshot \| null` as the internal field. No bare "snapshot" variable. Types are clearly named: `TApiSnapshot`, `TResourceSnapshot`, `TResourceV2SnapshotSlice`. Parameters use `initialSnapshot`, method `getSnapshot()`, function `hydrateSnapshot()`. |
| 14 | Plugin augmentation: PluginAugmentations\<TPlugin\> | PASS | §11 defines `PluginAugmentations<TPlugins extends readonly IPlugin[], TArgs, TData>` using conditional types (`PluginResourceContributions`) and `UnionToIntersection`. No declaration merging. Explicit compile-time resolution example shown in §11.1. |
| 15 | Pending state data typed as TData \| null | PASS | §2 `TPendingState<TArgs>`: `data: null` (strict null in machine). §8.1 `IResourceV2AgentState`: `data: TData \| null` with ADR-3 note explaining SWR composition from two entries. Both correct for their respective contexts. |
| 16 | Generic type inference noted | PASS | §11.1 provides full step-by-step type resolution chain for plugin augmentation. §12.1 shows `TPlugins` inference via `as const`. Type flow is traceable through the document. |
| 17 | Operations/OperationV2 removed | PASS | Zero mentions of "Operation", "OperationV2", "Command", "useOperationV2", or "useCommandAgent" anywhere in the document. §13 React hooks section only contains `useResourceV2Agent`. |
| 18 | No _inflightMap; abort at RCE level | PASS | §7.3 `ResourceV2CacheEntry` has `_abortController: AbortController \| null` and `_inflightPromise: Promise<TData> \| null` — abort is per-entry. No `_inflightMap` exists anywhere in the model. Query method described as: "Manages AbortController internally." |
| 19 | CacheMap: serialize vs compare different implementations | PASS | §6.3 defines two classes: `SerializeCacheMap` (uses `Map<string, TEntry>` with `_serializeArgs`) and `CompareCacheMap` (uses `Array<{ args, entry }>` with `_compareArg` linear scan). Selected via `keyStrategy` in `createCacheMap()`. |
| 20 | Boolean "is" prefix | PASS | §8.1: `isLoading`, `isInitialLoading`, `isRefreshing`, `isSuccess`, `isError`. §7.3: `isMyArgs()`. §2: `isConsistencyViolation`. All booleans consistently prefixed with "is". |
| 21 | machine$ is a signal, not a method | PASS | §7.3: `readonly machine$: ReadableSignalFnLike<TMachineInstance<TArgs, TData>>` — declared as signal property. Comment: "Call as machine$() for reactive read." Concrete class: "machine$ is a signal property aliasing inherited state$()". |
| 22 | No SharedOptions/DefaultOptions | PASS | No mention of `SharedOptions`, `DefaultOptions`, or any shared options class/interface. Options defined per-resource (`IResourceV2Options`) and per-API (`ICreateApiOptions`) only. |
| 23 | getOrCreate with factory | PASS | §6.1: `getOrCreate(args: TArgs): TEntry` in `ICacheMap`. §6.2: `factory: TCacheMapFactory<TArgs, TEntry>` in `ICacheMapOptions`. §6.3: Both implementations use factory in getOrCreate. §6.4: Full explanation of factory delegation pattern. |
| 24 | Agent works with RCE, queryFn executed by RCE | PASS | §8.1 Agent has `_getEntry: (args: TArgs) => ResourceV2CacheEntry<TArgs, TData>`, calls `entry.query()`. §7.3 RCE: `query()` "Manages AbortController internally" and executes queryFn. Agent never calls queryFn directly. |
| 25 | Agent does NOT depend on Resource | PASS | §8.1 `ResourceV2Agent` holds `_getEntry` callback and `_compareArgs` callback — no reference to `IResourceV2` or `ResourceV2`. Created via `ResourceV2.createAgent()` but holds only injected callbacks. |
| 27 | No separate resetAllCacheV2(), only api.resetAll() | PASS | §12.1 `IApi` has `resetAll(): void`. §12.2 standalone functions only expose `createResourceV2`. No `resetAllCacheV2()` function anywhere in model. |
| 37 | TArgs typed everywhere \<TArgs, TData\> | PASS | All resource-level generics use `<TArgs, TData>`: Machine states, instances, RCE, Agent, AgentState, ResourceV2, Options, Lifecycle hooks, Snapshot types. Data-only types (`TPatchState<TData>`, `IPatchResolution<TData>`) correctly omit TArgs. Base `ICacheEntry<TState>` correctly generic over TState. |
| 38 | CacheMap TEntry explicitly defined | PASS | §6 explicitly states: "TEntry is intentionally unconstrained." `ICacheMap<TArgs, TEntry>` — no `extends` constraint on TEntry. Rationale provided: "CacheMap never calls any method on TEntry." ADR-19 ref present. |
| 42 | All machines accept \<TArgs, TData\> | PASS | §3: `MachineIdle<TArgs, TData>`, `MachinePending<TArgs, TData>`, `MachineSuccess<TArgs, TData>`, `MachineError<TArgs, TData>`, `MachineRefreshing<TArgs, TData>`. `IMachineStatic`: `idle<TArgs, TData>()`, `fromSnapshot<TArgs, TData>()`. |
| 43 | All machines contain args: TArgs | PASS | §2: `TIdleState.args: null`, `TPendingState<TArgs>.args: TArgs`, `TSuccessState<TArgs, TData>.args: TArgs`, `TErrorState<TArgs>.args: TArgs`, `TRefreshingState<TArgs, TData>.args: TArgs`. All non-idle states carry typed args. |
| 44 | All function calls show argument types | PASS | `TQueryFn(args: TArgs, tools: {...})`, `getOrCreate(args: TArgs)`, `start(...args: ArgsOrVoid<TArgs>)`, `query(...args: [...ArgsOrVoid<TArgs>, doForce?])`, `isMyArgs(args: TArgs)`, `createPatch(patchFn: (draft: TData) => void)`, factory `(args: TArgs) => TEntry`. All argument types explicit. |
| 48 | initialSnapshot types correct | PASS | §12.1: `initialSnapshot?: TApiSnapshot \| null`. §10: `TApiSnapshot` has `version`, `keyPrefix`, `resources: Record<string, TResourceSnapshot>`. `TResourceV2SnapshotSlice` has `status: "success"`, `args: unknown`, `data: TData`, `updatedAt: number`. |
| 49 | Snapshot types reflect correct lifecycle | PASS | §12.1 describes 3-phase lifecycle: (1) save as `_savedSnapshot`, (2) consume+delete slice per `createResourceV2`, (3) `resetAll()` deletes entirely. `TResourceV2SnapshotSlice.status` is `"success"` (only success entries serialized). No conditional/selective hydration language. |
| R7-2 | refreshError removed from IResourceV2AgentState | PASS | §8.1 `IResourceV2AgentState` fields: `status`, `data`, `error`, `args`, `isLoading`, `isInitialLoading`, `isRefreshing`, `isSuccess`, `isError`, `entry`. No `refreshError`, `onRefreshError`, or `notifyRefreshError`. |

## Conclusion

All 28 checked issues remain resolved in `03-model.md`. No regressions found.
