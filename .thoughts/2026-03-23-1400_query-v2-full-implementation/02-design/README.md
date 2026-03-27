---
title: "Design: Full implementation of query-v2 module"
date: 2026-03-25
status: Approved
feature: "Full implementation of query-v2 module with tests"
research: "../01-research/README.md"
redraft-round: 14
---

## Note

> **Rename**: The directory `src/query-v2/` has been renamed to `src/query-v2-legacy/` to reduce confusion with the new query-v2 module being designed. All references to `src/query-v2/` in the research and design documents should be understood as referring to `src/query-v2-legacy/`.

## Overview

Comprehensive technical design for the query-v2 module rewrite: a cache-backed asynchronous data management system built on the Signals reactive layer, featuring machine-based state management (Idle → Pending → Success/Error → Refreshing), Immer-based optimistic patches with consistency violation detection (`TPatchState.isConsistencyViolation`), refcount+timer GC via `share({resetOnRefCountZero})`, SSR snapshots, plugin-extensible architecture with generic conditional type augmentation (`PluginAugmentations<TPlugin>`), and thin React integration via `useSyncExternalStore`. The design resolves all 19 research open questions through 19 ADRs and provides full type, data-flow, and test specifications across all five layers (lib → core → api → react → plugins).

## Goals

- Replace the current broken v2 implementation with a precise, fully-tested rewrite matching v0.1 documentation
- Resolve all type system problems (eliminate TError, eliminate `as unknown as` casts)
- Fix SWR previous/current swap so stale-while-revalidate actually works
- Implement missing documented features: `_status$`/`_lastEntry$` signals, consistency violation detection, rich `IResourceV2CacheEntry` with `invalidate()` and `query()` methods
- Provide industry-standard GC (refcount + timer hybrid via `share({resetOnRefCountZero})`) preventing data eviction while components are mounted
- Design plugin API extensible for future entity types via `PluginAugmentations<TPlugin>` generic conditional types (not `declare module` merging)
- Provide `createApi` as the canonical single-instance entry point with plugin registration, shared cache configuration, snapshot coordination, and resetAll

## Non-Goals

- **Additional entity types** — only ResourceV2 designed in this iteration
- **TError generic parameter** — user decision: errors are always `unknown`
- **ResourceDuplicator** — deferred to separate task
- **DevTools UI/formatting** — Signal.state provides DevTools infrastructure; no additional tooling designed
- **Current v2 code as reference** — design is based on v0.1 docs and v1 patterns only
- **Structural sharing on hydration** — deferred; one-time per-resource operation, complexity not justified

## Documents

| # | Document | Description |
|---|----------|-------------|
| 1 | [Architecture](./01-architecture.md) | C4 diagrams (L1–L3 including API & Plugin layer), 5-layer module hierarchy (lib → core → api → react → plugins), component boundaries, signal integration, `createApi` as primary entry point, `ReactHooksPlugin` in plugin layer, public/internal/extension API boundaries, inheritance hierarchy (`ResourceV2CacheEntry extends CacheEntry`), dependency chain: `ResourceV2 → CacheMap → ResourceV2CacheEntry → CacheEntry → Machine`. Agent depends only on RCE (not Resource) per ADR-18 |
| 2 | [Data Flow](./02-dataflow.md) | 15+ sequence/flowchart diagrams: ResourceV2 fetch/SWR/abort(per-entry)/retry/GC via `share({resetOnRefCountZero})`, Snapshot capture/hydrate, `createApi` initialization flow, `ReactHooksPlugin` registration & hook contribution lifecycle, Plugin hook invocation order, Optimistic patches. Full state machine specification for ResourceV2 (5 states). Batcher.run() semantics (optional for single changes). Resource.invalidate delegates to RCE.invalidate |
| 3 | [Domain Model](./03-model.md) | Complete TypeScript type definitions: machine states (with `TPatchState.isConsistencyViolation`), cache entries (`ResourceV2CacheEntry extends CacheEntry`), generic `CacheMap<TArgs, TEntry>` with ICacheMap interface + SerializeCacheMap/CompareCacheMap implementations + factory pattern (getOrCreate), ResourceV2/ResourceV2Agent (Agent depends only on RCE via callbacks), lifecycle hooks, snapshots, plugins (`IPlugin`, `ReactHooksPlugin` class, `PluginAugmentations<TPlugins>` generic conditional types), `createApi`/`IApi`/`ICreateApiOptions` factory signatures, standalone factories, React hook (`useResourceV2Agent`). All types use `<TArgs, TData>` only |
| 4 | [Decisions](./04-decisions.md) | 19 ADRs covering layering, state machines, SWR, CacheEntry boundary (inheritance), GC (`share({resetOnRefCountZero})`), Patcher safety (`TPatchState.isConsistencyViolation`), cache keys, snapshots, plugins (`PluginAugmentations<TPlugin>` over `declare module`), agent behavior, getEntry$ reactivity, hydration sharing, compare+snapshot, CacheEntry.complete(), V2 naming convention, single API instance (ADR-16), abort at RCE level (ADR-17), agent independence from Resource (ADR-18), CacheMap dual implementation with factory (ADR-19) |
| 5 | [Use Cases](./05-usecases.md) | 17 use cases with TypeScript code examples: `createApi` as primary entry point throughout, basic resource, args, SWR, error/retry, optimistic patches, invalidation (delegates to RCE.invalidate), GC, SKIP, dedup, plugins, React hook (`useResourceV2Agent` — standalone and plugin-contributed), SSR with server/client API instances, resetAll, plugin composition with `PluginAugmentations` resolution, lifecycle hooks, compare strategy, CacheMap factory mechanism |
| 6 | [Test Cases](./06-testcases.md) | Testing pyramid (70% unit / 15% component / 15% integration), controllable-promise pattern, 137+ test cases across lib/core/api/react/integration layers, plugin tests (PL01–PL08) including `ReactHooksPlugin` contribution (PL06), ResourceV2CacheEntry tests (RCE01–RCE14) with `invalidate()`, `query()`, consistency violation, CacheMap factory tests (CM-F01–CM-F05), edge cases |
| 7 | [Documentation Impact](./07-docs.md) | v0.1 deprecation banners, v0.2 docs (README + optimistic-updates + ssr), migration guide update, 3 existing demo file updates |
| 8 | [Risks](./08-risks.md) | 22 risks with probability/impact matrix, detailed mitigation plans for 10 highest-severity risks, test case cross-references for all High/Medium risks |

## Key Decisions

| ADR | Decision | Rationale |
|-----|----------|-----------|
| ADR-1 | 4-layer strict hierarchy `lib/ → core/ → api/ → react/` + `plugins/` and `types/` | Proven in v1; prevents circular deps; each layer independently testable |
| ADR-2 | Immutable class-based state machines with `.state` extraction for snapshots | Method-based transitions prevent invalid state changes at the type level; matches v0.1 strong typing requirement |
| ADR-3 | SWR: keep previous entry until current resolves | Fixes the critical bug in current v2; proven pattern from v1 and all major libraries |
| ADR-4 | `ResourceV2CacheEntry extends CacheEntry` (inheritance) | v0.1 docs specify inheritance; single object per entry; clean dependency chain: `ResourceV2 → CacheMap → ResourceV2CacheEntry extends CacheEntry → Machine`; no wrapper overhead |
| ADR-5 | Refcount + timer hybrid GC via `share({resetOnRefCountZero})` | Industry standard (TanStack/RTK/Relay); reuses v1 `ReactiveCache` proven pattern; prevents data GC while components are mounted |
| ADR-6 | Patcher returns `IPatchResolution<TData>` with `TPatchState.isConsistencyViolation`; ResourceV2CacheEntry auto-invalidates | Prevents silent data corruption; structured `TPatchState` groups `originalData`, `patches`, and `isConsistencyViolation`; eliminates `NO_VALUE` sentinel |
| ADR-7 | Minimal stableStringify (plain objects/arrays/primitives only) | User decision; `serializeArgs` override and `compare` strategy cover edge cases |
| ADR-8 | Snapshot via `.state` extraction + `Machine.fromSnapshot()` reconstruction | Clean JSON boundary; no class serialization issues |
| ADR-9 | Synchronous plugin API with Object.assign + `PluginAugmentations<TPlugin>` generic conditional type augmentation | Explicit, composable, scoped to `createApi()` call — replaces legacy `declare module` / declaration merging approach |
| ADR-10 | Agent.start() triggers query (with dedup), not just observes | SWR-compatible; hook users just pass args; matches TanStack/SWR behavior |
| ADR-11 | `_status$` and `_lastEntry$` signals for getEntry$ reactive reset | Exactly matches v0.1 Внутриянка specification; enables correct resetAll() behavior |
| ADR-12 | No structural sharing at hydration; fresh machine instances per resource | One-time per-resource operation at createResourceV2 time (cache is empty); complexity not justified |
| ADR-13 | compare CacheMap throws on snapshot | Documented limitation; compare is for non-serializable in-memory-only scenarios |
| ADR-14 | CacheEntry.complete() = full cleanup (abort patches → idle → onClean$) | Terminal operation; deterministic GC cleanup; matches test expectations |
| ADR-15 | V2 suffix on public-facing entity names (`createResourceV2`, `IResourceV2CacheEntry`, etc.); exception: `createApi`/`IApi`/`ICreateApiOptions` | Avoids naming collisions with v1 exports; API factory name describes action, not versioned entity |
| ADR-16 | Single API instance (`createApi`) as canonical entry point | Unified configuration, plugin install point, snapshot coordination, resetAll tracking; matches v0.1 docs and industry standard |
| ADR-17 | Abort and inflight management at CacheEntry level, no `_inflightMap` on Resource | RCE owns data, state, and abort; clean separation of concerns |
| ADR-18 | Agent independence from Resource — receives callbacks, works only with RCE | Dependency inversion; Agent → RCE, not Agent → Resource |
| ADR-19 | CacheMap dual implementation (Serialize/Compare) with factory pattern for getOrCreate | Structurally different backing stores; factory decouples CacheMap from entry types |

## Issue Resolution History

### Redraft Round 14 (Verification Round 13 — 35 Low-severity issues)

Phases 72–75 addressed all 35 Low-severity issues from the comprehensive Verification Round 13 audit (Phases 48–67). Phase 76 verified all 35 resolved with zero regressions.

#### Phase 72 — 01-architecture.md + 04-decisions.md (6/6 ✅)

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| LOW-A1 | §4 missing `Machines --> Pat` edge | ✅ | §4 line 208: `Machines --> Pat` edge present, consistent with §2 and §3 |
| LOW-A2 | ADR-1 "alongside api/" phrasing | ✅ | ADR-1 Decision: "5-layer strict hierarchy (`lib/ → core/ → api/ → react/ → plugins/`)" — plugins as Layer 5, no ambiguous "alongside" |
| LOW-A3 | `initialSnapshot` in §3a | ✅ | §3a narrative: "accepts an option that may include `initialSnapshot: TApiSnapshot`" with full lazy consumption description |
| LOW-A4 | `_savedSnapshot` in §3a | ✅ | §3a diagram: `SavedSnap["_savedSnapshot: TApiSnapshot | null"]` node with consume/delete arrows |
| LOW-A5 | `createCacheMap()` factory | ✅ | §5.2 post-diagram: "**`createCacheMap()` factory**: A static factory function..." with full signature and ADR-19 reference |
| LOW-A6 | `resetCache()` visibility | ✅ | §7.2: listed as internal. §5.2 post-diagram: rationale for existence. §5.2 class diagram: `-resetCache(): void` (private prefix) |

#### Phase 73 — 02-dataflow.md (7/7 ✅)

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| LOW-D1 | §5.4 LifecycleHooks typed args | ✅ | §5.4: `LifecycleHooks.fireCacheEntryRemoved(args: TArgs): void` — fully typed |
| LOW-D2 | Informal machine notes generics | ✅ | §4.1 transition table: `successHappened(data: TData)`, `errorHappened(error: unknown)`, `start(args: TArgs)` — all formal types |
| LOW-D3 | Agent state `entry` field absent | ✅ | Note after §1.1: "The full agent state shape is `IResourceV2AgentState<TArgs, TData>` (model §8.1) which includes: `status`, `data`, `error`, `args`, `isLoading`, `isInitialLoading`, `isRefreshing`, `isSuccess`, `isError`, `entry`" |
| LOW-D4 | Inconsistent field selection | ✅ | Same note explains: "Each diagram shows only the fields relevant to the scenario... `isLoading` is omitted from some diagrams where a more specific indicator (`isInitialLoading`, `isRefreshing`) conveys the same information" |
| LOW-D5 | `complete()` patch behavior | ✅ | §1.7: "**Abort patches — NO** (not needed in GC context): `complete()` does not explicitly abort pending patches... For `resetAll()`, the machine is reset to idle before `complete()` fires, making any remaining patch state irrelevant" |
| LOW-D6 | `_lastArgs` in §1.3 | ✅ | §1.3: `Note over Agent: a = _lastArgs (previous start() args), b = new args from current start() call` |
| LOW-D7 | `resetAll()` consolidated sequence | ✅ | New §6.4 "resetAll() Consolidated Sequence" with full Mermaid diagram and cross-references to §2.1, §5.4, §6.2 |

#### Phase 74 — 03-model.md (6/6 ✅)

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| LOW-M1 | `CacheEntry.obs` property | ✅ | §5 `ICacheEntry`: `readonly obs: Observable<TState>;` with JSDoc: "RxJS Observable bridge — exposes state$ as an Observable<TState> for share({resetOnRefCountZero}) GC integration". Also on concrete class §5a. |
| LOW-M2 | `Batcher` type | ✅ | §16.2 "Batcher": full `IBatcher` interface with `run<T>(fn: () => T): T` method. Listed in §15 as Internal/lib. |
| LOW-M3 | `LifecycleHooks` class | ✅ | §9.1: Complete class definition with `fireCacheEntryAdded`, `fireQueryStarted`, `resolveDataLoaded`, `fireCacheEntryRemoved`, `resolveQueryFulfilled`, `clearAll` methods. |
| LOW-M4 | `stableStringify` signature | ✅ | §16.1: `declare function stableStringify(value: unknown): string;` — handles plain objects, arrays, primitives per ADR-7 |
| LOW-M5 | Machine transition methods | ✅ | §3.1: All 5 machine classes with complete transition methods and typed return values. `MachineIdle.start(args) → MachinePending`. `MachinePending.successHappened(data) → MachineSuccess`. Etc. |
| LOW-M6 | `getSnapshot()` throw spec | ✅ | §12.1 `IApi.getSnapshot()` JSDoc: "Throws if the API uses `keyStrategy: "compare"`" with rationale about non-serializable keys |

#### Phase 75 — 05-usecases.md (4/4 ✅)

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| LOW-U1 | UC-4 `resource.query()` → `entry.query()` | ✅ | UC-4 comment: `entry.query() sees error state → fetches again` |
| LOW-U2 | UC-4 ADR-2 cross-ref | ✅ | Ref updated to `03-model.md#3 — MachineRefreshing.errorHappened()` and `02-dataflow.md#4.1` — no longer references incorrect ADR-2 |
| LOW-U3 | Shared setup `as const` | ✅ | Shared Setup line 50: `plugins: [new ReactHooksPlugin()] as const` — consistent with ADR-9 and UC-10/UC-14 |
| LOW-U4 | UC-3 ref to 04-decisions.md | ✅ | UC-3 line 178: `[ref: 04-decisions.md ADR-3 — SWR: keep previous until current resolves]` — correct file |

#### Phase 75 — 06-testcases.md (14/14 ✅)

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| LOW-T1 | Snapshot section heading | ✅ | "Test Cases — core Layer: Snapshot" — matches architecture Layer 2 |
| LOW-T2 | RE17/AP07 gaps | ✅ | Note: "RE17 and AP07 are reserved IDs (removed during prior design iterations). Remaining IDs are intentionally not renumbered to preserve cross-document reference stability." |
| LOW-T3 | Plugins section heading | ✅ | "Test Cases — plugins Layer: ReactHooksPlugin" — matches architecture Layer 5 |
| LOW-T4 | Type-level plugin test IDs | ✅ | PL09: `PluginAugmentations` type resolution (`.test-d.ts`). PL10: rejects invalid access (`@ts-expect-error`) |
| LOW-T5 | Cross-plugin visibility test | ✅ | PL11: "Later plugin's `augmentResource` can access earlier plugin's contributions on the resource object" |
| LOW-T6 | SM06 `data=null` assertion | ✅ | SM06 expected output: "data=null" explicitly listed |
| LOW-T7 | `getEntry$` binding optimization test | ✅ | Note: "binding is a performance implementation detail — observable behavior is fully covered by RE08 and RE23 without a dedicated binding-memo test" |
| LOW-T8 | `ICacheMap.values()` test | ✅ | CM19: "`values()` iterates all entry values" |
| LOW-T9 | Agent state field tests | ✅ | AG15 (isRefreshing), AG16 (isError + error), AG17 (args), AG18 (args null on SKIP) |
| LOW-T10 | PluginAugmentations type tests | ✅ | Covered by PL09/PL10 type-level test IDs |
| LOW-T11 | Standalone `createResourceV2` test | ✅ | AP11: "Standalone `createResourceV2` accepts standalone-level options (`keyStrategy`, `keyPrefix`)" |
| LOW-T12 | `beforeDevtoolsPush` test | ✅ | CE10: "`beforeDevtoolsPush` callback invoked before devtools state push" |
| LOW-T13 | RE20-RE23 header | ✅ | Header: "ResourceV2 — _status$ Signal (ADR-11)". Note: `_lastEntry$` tested indirectly via RE08/RE23 |
| LOW-T14 | RE08 description | ✅ | RE08: "`resource.getEntry$(args)` is reactive to resetAll" — correctly describes behavior without mixing internal `resetCache` |

### Redraft Round 13 (Verification Round 13 — 24 issues: 2 CRI + 10 High + 12 Medium)

Phases 68–70 addressed all 24 issues from the comprehensive per-file and cross-file audit (Verification Round 13, Phases 48–67: 8 individual file audits + 12 cross-file consistency audits). Phase 71 verified all 24 resolved with zero regressions.

#### Critical (2/2 ✅)

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| CRI-1 | `createPatch` return type mismatch: arch §5.1 showed `IPatchHandle \| null`, tests expected `{ machine, patchHandle }` | ✅ | Arch §5.1: `+createPatch(patchFn): CreatePatchResult~TArgs_TData~ | null`. Post-diagram text: `CreatePatchResult<TArgs, TData> = { machine: MachineWithData<TArgs, TData>, patchHandle: IPatchHandle }`. Model §3: matching `CreatePatchResult` type definition + `MachineWithData.createPatch(): CreatePatchResult<TArgs, TData> | null`. Model §7.3 RCE: `createPatch(): IPatchHandle | null` (consumer-facing — returns only handle). Patch ownership boundary documented in both arch §5.1 and model §3.1. |
| CRI-2 | Args-change abort contradiction: RE11/INT12 asserted abort, dataflow §1.5 said "continues independently" | ✅ | Tests RE11: "First request continues (not aborted); second entry starts its own fetch". INT12: "args1 queryFn continues independently; agent tracks args2 entry; args1 data available to other consumers". Aligned with dataflow §1.5. |

#### High (10/10 ✅)

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| 3 | plugins/ layer contradiction: ADR-1 said Layer 3, arch said Layer 5 | ✅ | ADR-1: "5-layer strict hierarchy (`lib/ → core/ → api/ → react/ → plugins/`)" — plugins as Layer 5. Arch §2: Layer 5 subgraph. Consistent. |
| 4 | `_lastEntry$` type mismatch: arch said `ResourceV2CacheEntry`, ADR-11 said `CacheEntry` | ✅ | ADR-11 Option 1: `_lastEntry$: SignalFn<ResourceV2CacheEntry<TArgs, TData> | null>`. Arch §5.2: `-_lastEntry$: SignalFn~ResourceV2CacheEntry_or_null~`. Arch §6.1 table: `Signal.state<ResourceV2CacheEntry<TArgs, TData> | null>`. Consistent. |
| 5 | patchState double ownership between MachineWithData and RCE | ✅ | Arch §5.1: "Patch ownership boundary" paragraph. Model §3.1: matching boundary explanation. MachineWithData = pure immutable transition (returns `CreatePatchResult`). RCE = orchestrator (manages `_patchState`, returns `IPatchHandle`). |
| 6 | ResourceV2 missing `resetCache`/`cacheEntries`/`hydrateEntry`/`hasEntry` | ✅ | Arch §5.2 class diagram: all 4 methods present on ResourceV2 (`-resetCache(): void`, `-cacheEntries(): IterableIterator`, `-hydrateEntry(args, machine): void`, `-hasEntry(args): boolean`). Rationale section below diagram. |
| 7 | `createCacheMap()` factory absent from architecture | ✅ | Arch §5.2 post-diagram: "**`createCacheMap()` factory**: A static factory function..." documented with signature and ADR-19 reference. |
| 8 | `IResourceV2CacheEntry` interface absent from architecture | ✅ | Arch §5.2 post-diagram: "**`IResourceV2CacheEntry<TArgs, TData>` — consumer-facing interface**" paragraph. |
| 9 | `initialSnapshot` mechanism unmodeled in architecture §3a | ✅ | Arch §3a: `SavedSnap["_savedSnapshot: TApiSnapshot | null"]` node. `CRV2 -->|"consume snapshot slice"| SavedSnap` and `Reset -->|"delete"| SavedSnap` arrows. |
| 10 | LifecycleHooks lacks method specifications | ✅ | Arch §5.2 post-diagram: "**`LifecycleHooks<TArgs, TData>` method signatures**" with `notifyCacheEntryAdded` and `notifyQueryStarted` full signatures. |
| 11 | Machine transition methods missing from model | ✅ | Model §3.1: All 5 machine classes have explicit transition methods (`start`, `successHappened`, `errorHappened`, `invalidate`, `retry`, `reset`). Return types specified per class. |
| 12 | Success→Pending at entry level incorrect (should be agent-level SWR) | ✅ | Dataflow §4.1 post-diagram: "**Entry-level vs agent-level transitions**: All transitions above are **machine-level** (entry-level)... SWR... is an **agent-level** concept." Clear separation. |

#### Medium (12/12 ✅)

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| 13 | "4-layer" in text but diagrams show 5 layers | ✅ | Arch §2: "strict 5-layer architecture". ADR-1: "5-layer strict hierarchy". Consistent. |
| 14 | `_signal$` vs `_state$`/`_value$` naming inconsistency | ✅ | Arch §5.2: CacheEntry uses `-_signal$: SignalFn~TState~`. Consistent with `state$()` as public getter that reads `_signal$`. No `_state$` or `_value$`. |
| 15 | SKIP vs SKIP_TOKEN naming inconsistency | ✅ | `SKIP` = runtime value (const). `SKIP_TOKEN` = type (`typeof SKIP`). Consistent across all docs. |
| 16 | Missing RxJS dependency in formal dependency diagram §4 | ✅ | Arch §4: `RxJS["RxJS<br/>(share, finalize, Subject, ReplaySubject)"]` in External subgraph. `CE --> RxJS` edge. |
| 17 | ResourceV2 concrete class not in model | ✅ | Model §7.2a: `class ResourceV2<TArgs, TData> implements IResourceV2<TArgs, TData>` with all fields. |
| 18 | `hydrateEntry()` not in model | ✅ | Model §7.2a: `hydrateEntry(args: TArgs, machine: TMachineInstance<TArgs, TData>): void;`. |
| 19 | resetAll "abort patches" contradiction | ✅ | Dataflow §1.7: "Abort patches — NO" with reasoning (refcount=0 ⇒ no consumers hold handles). `complete()` (ADR-14) does abort patches for its own path. No contradiction: GC vs complete() are different paths. |
| 20 | SM24 test references `refreshing.patches` but model uses `patchState.patches` | ✅ | SM24: "refreshing.patchState.patches same as success". Correct `patchState.patches` path. |
| 21 | AG12 test references `state$.obs` not defined on ComputeFn | ✅ | AG12: "`effect(() => state$())` → resolve query". Uses `effect()` + `state$()` Signal primitives, not `state$.obs`. |
| 22 | LH06 test says "resolves with data" but type is `Promise<{data: TData}>` | ✅ | LH06: "Promise resolves with `{ data: TData }`". Correct wrapped type. |
| 23 | UC-5 patchState on machine state vs RCE comment | ✅ | UC-5 edge case: "isConsistencyViolation is tracked in TPatchState on the ResourceV2CacheEntry (_patchState)". Correctly references RCE, not machine. |
| 24 | `compareArg` typing `(a: unknown, b: unknown)` vs typed at API level | ✅ | Model §12.1 `ICreateApiOptions`: `compareArg?: TCompareArgsFn;` (untyped — shared across resources with different TArgs). Model §7.1 `IResourceV2Options`: `compareArg?: TCompareArgsFn<TArgs>;` (typed — resource-level). Deliberate distinction documented. |

### Redraft Round 11 (#41–#48 + 2 Reviewer Issues)

Phases 42–44 addressed 8 user issues and 2 reviewer issues. Phase 45 verified all 10 resolved with zero regressions.

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| 41 | "ResourceV2 Registry" removed | ✅ | Grep: zero matches in design docs 01–08. Concept replaced by `createApi`-level `_resources: Set<ResourceV2>` and `CacheMap` (existing entities). |
| 42 | All machines accept `<TArgs, TData>` | ✅ | Arch §5.1: all 6 machine classes show `~TArgs_TData~`. Model §3: `TMachineInstance<TArgs, TData>`. Dataflow: all diagrams show `Machine*<TArgs, TData>`. |
| 43 | All machines contain `args: TArgs` | ✅ | Model §2: `TIdleState.args: null`, `TPendingState.args: TArgs`, `TSuccessState.args: TArgs`, `TErrorState.args: TArgs`, `TRefreshingState.args: TArgs`. Testcases SM08: "Pending preserves args from start". |
| 44 | All function calls show argument types | ✅ | Dataflow §1.1–§1.7: every arrow/call shows typed arguments. §5.1–§5.5: flowcharts show typed parameters. Model: all method signatures complete. |
| 45 | §1.6 shows RCE data return on retry | ✅ | Dataflow §1.6: `QFn-->>RCE: data: TData` → `RCE-->>Agent: state$ signal fires` → `Agent-->>App: state$: {status:"success", data: TData}`. Full return chain. |
| 46 | `NO_VALUE` removed from ADRs | ✅ | Grep: zero matches in design docs 01–08. ADR-6 uses `TPatchState.isConsistencyViolation` throughout. |
| 47 | ADR-12 reasoning corrected | ✅ | ADR-12 Context now accurately describes: snapshot saved at `createApi()` time, consumed per-resource at `createResource()` time. |
| 48 | `initialSnapshot` save/consume-delete/delete | ✅ | Dataflow §2.1: three-phase lifecycle. Model §12.1: `_savedSnapshot` in IApi. UC-12: step-by-step. Testcases: SN08, SN11, SN12, AP08, AP08a–c. |
| R-1 | `useEventHandler` removed from C4 L1 and ADR-19 | ✅ | Grep: zero matches in design docs 01–08. C4 L1 edge labels: only `PromiseResolver, shallowEqual, useConstant`. |
| R-2 | §5.2 Read Path node connectivity fixed | ✅ | §5.2: `F --> G` connected, `G --> H` and `G --> H2` distinct nodes, no disconnected nodes. |

### Redraft Round 12 (#49)

Phase 46 addressed Issue #49 (ADR-12 snapshot hydration reasoning + comprehensive contamination audit across all 8 design documents). Phase 47 verified with elevated thoroughness (x10).

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| 49 | ADR-12 snapshot hydration correctness + cross-document contamination | ✅ | **ADR-12**: Context correctly describes three-phase lifecycle: (1) save at createApi, (2) consume+delete per resource at createResourceV2, (3) delete at resetAll. Explicitly states "no resources exist yet" and "CacheMap is always empty". No "if exists", "skip", "already created" language. **Contamination audit**: grep across all 8 design docs (01–08) for "already exists"/"if exists"/"skip" in snapshot context — zero contamination. 3 occurrences of "already exists" in 04-decisions.md are all in non-snapshot contexts (ADR-7 serializeArgs, ADR-8 Machine.fromSnapshot, ADR-9 plugin key collision). **Cross-document consistency**: Dataflow §2.1, Model §12.1, ADR-8, ADR-12, UC-12, UC-13, SN07–SN12, AP08–AP08c, INT04, E07 — all describe identical save→consume+delete→delete lifecycle. Dataflow §3.3 explicitly states "Snapshot is saved, NOT hydrated yet. Per-resource consumption happens in createResourceV2." |

### Redraft Rounds 1–5 (#1–#16)

All 16 user-reported issues resolved across Phases 5–19 (5 redraft rounds). No regressions detected in Phase 25 re-review.

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| 1 | V2 suffix consistently applied | ✅ | All entity names carry V2 suffix. Exceptions per ADR-15 correct. |
| 2 | Commands removed completely | ✅ | Zero Command content in any design doc. Only `[ref:]` to v1 research anchors remain. |
| 3 | Dependency chain explicit | ✅ | `ResourceV2 → CacheMap → ResourceV2CacheEntry extends CacheEntry → Machine` in arch §3, §5.2, model §7.3, ADR-4. |
| 3.1 | No direct ResourceV2 → CacheEntry dependency | ✅ | Architecture §4: no `Res → CE` arrow. ResourceV2 accesses entries only through CacheMap. |
| 4 | useOperationV2 / useResourceV2 removed | ✅ | Zero occurrences. Only `useResourceV2Agent` exists. |
| 5 | Design differentiated from legacy | ✅ | Architecture §9 with 8 subsections. ADRs have "Legacy anti-pattern resolved" boxes. |
| 6 | ResourceV2CacheEntry inherits CacheEntry | ✅ | `extends CacheEntry<TMachineInstance<TData>>` in model, ADR-4, arch classDiagram. |
| 7 | Private fields in class diagrams | ✅ | ResourceV2: `-_cache`, `-_status$`, `-_lastEntry$`. CacheEntry: `-_signal$`, `-_isCompleted`, `-_onClean$`. RCE: `-_patchState`, `-_args`, `-_queryFn`, `-_abortController`, `-_inflightPromise`. |
| 8 | Batcher.run() optional for single changes | ✅ | Architecture §6.1, Dataflow §7.3 dedicated section. |
| 9 | CacheMap has no knowledge of CacheEntry | ✅ | `ICacheMap<TArgs, TEntry>` fully generic. Factory callback pattern. |
| 10 | GC timer uses share({resetOnRefCountZero}) | ✅ | Dataflow §1.7, ADR-5 with code example and config table. |
| 11 | RCE has invalidate(), query() | ✅ | Model §7.3, test cases RCE08/RCE10–RCE12, arch §5.2. |
| 12 | Patcher output with isConsistencyViolation | ✅ | Model §2 TPatchState, §4 IPatchResolution, ADR-6, PA10/PA11/RCE14. |
| 13 | "snapshot" variable renamed | ✅ | `const state = agent.state$()` in UC-1. Only legitimate `snapshot` in SSR contexts. |
| 14 | PluginAugmentations\<TPlugin\> | ✅ | Model §11, ADR-9 Option 2, UC-10, UC-14. |
| 15 | data: TData \| null | ✅ | Model §8.1, UC-11 design note. |
| 16 | Generic inference noted | ✅ | UC-1, UC-2, UC-14 inference notes. |

### Redraft Round 6 (#17–#26)

All 10 issues fully resolved (Issue #17 completed in Redraft Round 7).

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| 17 | Operations/OperationV2 completely removed | ✅ | Zero OperationV2 mentions in any design doc. `01-architecture.md` §8: "Only ResourceV2". `07-docs.md`: "ResourceV2 only (additional entity types are out of scope)". `08-risks.md` R11: "Stay within ResourceV2 scope; additional entity types are out of scope". Matches Commands removal pattern (zero mentions). |
| 18 | No `_inflightMap`; abort at RCE level | ✅ | ADR-17: "ResourceV2 has no `_inflightMap`". Each RCE holds `_abortController` and `_inflightPromise`. Architecture §5.2: ResourceV2 class has no `_inflightMap` field. Dataflow §1.5: abort sequence at entry level. |
| 19 | CacheMap: serialize vs compare different implementations | ✅ | Model §6.3: `SerializeCacheMap` (Map<string, TEntry>) vs `CompareCacheMap` (Array<{args, entry}>). Architecture §5.2: both shown. ADR-7, ADR-13, ADR-19. |
| 20 | Boolean "is" prefix | ✅ | All state booleans: `_isCompleted`, `isConsistencyViolation`, `isLoading`, `isInitialLoading`, `isRefreshing`, `isSuccess`, `isError`, `isMyArgs()`. Action parameters use "do" prefix per separate convention (`doCacheArgs`, `doInitiate`, `doForce`). |
| 21 | `machine$` is a signal, not a method | ✅ | Model §7.3: `readonly machine$: ReadableSignalFnLike<TMachineInstance<TData>>` — signal property. Architecture §5.2: `+machine$ : ReadableSignalFnLike~TMachineInstance~`. |
| 22 | No SharedOptions/DefaultOptions | ✅ | Zero dependency. Only explicit "no dependency" statements exist (ADR-19, test isolation notes). |
| 23 | getOrCreate with factory | ✅ | Model §6.2: `TCacheMapFactory<TArgs, TEntry>`. §6.4: full getOrCreate mechanism. ADR-19. UC-17. |
| 24 | Agent works with RCE, queryFn executed by RCE | ✅ | ADR-18: Agent → `entry.query()`. ADR-17: queryFn at RCE level. Dataflow §1.1: `Agent → RCE → queryFn`. Model §8.1: `_getEntry` callback. |
| 25 | Agent does NOT depend on Resource | ✅ | ADR-18: "no reference to ResourceV2". Model §8.1: Agent has `_getEntry` + `_compareArgs` callbacks only. Architecture §2: `Agent --> RCE` (no Agent → Resource arrow). RCE has no `_resource` field. |
| 26 | Resource.invalidate delegates to RCE.invalidate | ✅ | Model §7.2: "delegates to entry.invalidate()". Dataflow §5.3 Invalidation Cascade flowchart. Dataflow §1.4: `Res->>RCE: invalidate()`. |

### Redraft Round 7 (Phase 25 Issues #1–#3)

Phase 25 found 4 issues (2 Medium, 2 Low). Phase 26 fixed 3 of them (Low #4 skipped — ref anchors are acceptable). Phase 27 verified all 3 fixes.

| # | Issue | Severity | Fix | Verified |
|---|-------|----------|-----|----------|
| 1 | 3 OperationV2 scope-exclusion mentions in arch/docs/risks | Medium | Rephrased to "Only ResourceV2" / "additional entity types are out of scope" without naming OperationV2 | ✅ `01-architecture.md` §8, `07-docs.md` line 33, `08-risks.md` R11 — zero OperationV2 matches |
| 2 | `refreshError` missing from `IResourceV2AgentState` interface | Medium | Added `readonly refreshError: unknown;` to the interface in `03-model.md` §8.1 | ✅ (Later removed entirely per Issue #31) |
| 3 | "declaration merging" in plugin test strategy | Low | Changed to "PluginAugmentations" | ✅ `06-testcases.md` line 102: "Verify PluginAugmentations types compile correctly" |
| 4 | Research ref anchors contain "Command" | Low | Skipped — acceptable as research traceability | N/A |

### Redraft Round 8 (#27–#36)

Phase 28–30 addressed 10 issues: removal of `resetAllCacheV2()`, removal of `refreshError`/`onRefreshError`/`notifyRefreshError`, C4 diagram revisions, dataflow return values, GC justifications, and diagram connectivity. Phase 31 re-review results below.

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| 27 | No standalone `resetAllCacheV2()` | ✅ | Zero matches in any design doc. Only `api.resetAll()` exists (model §12.1, UC-13, AP05). |
| 28 | Snapshot dependency clarified | ✅ | Architecture §3: `Snap --> Res` in C4 Level 3 Core Layer. §3a: `GetSnap --> Reg` in API layer. |
| 29 | All C4 diagrams verified | ✅ | 8 Mermaid diagrams in architecture verified (§1, §2, §3, §3a, §4, §4a, §5.1, §5.2). Chains correct, arrows directional (→ for dependencies), labels describe what flows. No orphaned nodes in §3, §3a. |
| 30 | `useEventHandler` removed/connected in Module Dependency Diagram | ✅ | Module Dependency Diagram (§4): `useEventHandler` absent from External subgraph — only `useConstant`, `shallowEqual`, `PromiseResolver`. Integration table (§6.2): no `useEventHandler` row. |
| 31 | `refreshError`/`onRefreshError`/`notifyRefreshError` removed | ✅ | Zero matches in design docs (01–08). `IResourceV2AgentState` in model §8.1 has no `refreshError` field. Terms only in REVIEW.md/PHASES.md (historical records). |
| 32 | Dataflow shows return values | ✅ | All sequence diagrams have return arrows: §1.1 `QFn-->>RCE: data`, §1.2 `QFn-->>NewRCE: new data`, §1.4 `QFn-->>RCE: freshData` / `QFn-->>RCE: error`, §1.5 `QFn-->>RCE: data`, §1.6 `QFn-->>RCE: data`. Agent→App notifications use `-->>` dashed arrows. |
| 33 | §1.3 simplified | ✅ | §1.3 Cache Hit: 2 participants, 3 interactions. Minimal — just `start(args) → compareArgs → no action`. |
| 34 | GC abort patches removed/justified | ✅ | §1.7 "Abort patches — NO" with reasoning: refcount=0 means no consumers hold `IPatchHandle` references, so pending patches are impossible. |
| 35 | GC abort decision reasoned | ✅ | §1.7 "Abort inflight fetch — YES" with explanation: `queryFn` runs as a Promise independent of RxJS subscription chain; `share()` unsubscribing doesn't cancel it; `_abortController.abort()` prevents wasted network. |
| 36 | §3.4 graph connected | ✅ | §3.4 ReactHooksPlugin Lifecycle: all 5 participants (App, API, RHP, Res, Hook) connected. Three phases cover registration → augmentation → usage. No orphaned participants. |

### Redraft Round 10 (Phases 39–41 → Phase 42 Re-Review)

Phases 39–41 addressed all 22 issues from Redraft Round 9 (14 Must-Fix + 8 Can-Defer/Low) across 3 fix phases. Phase 42 re-review verified each fix individually.

#### Must-Fix Resolution (14/14 ✅)

| # | Issue | Status | Verification |
|---|-------|--------|--------------|
| 1 | §5.1/§5.2 class diagrams: all 16 generic annotations match `03-model.md` | ✅ | §5.1: All machine method return types have `~TData~` generics. §5.2: RCE fields (`_patchState: TPatchState~TData~`, `_queryFn: TQueryFn~TArgs_TData~`, `_inflightPromise: Promise~TData~`), public members (`machine$: ReadableSignalFnLike~TMachineInstance_TData~`, `peek(): TMachineInstance~TData~`, `query(doForce?): Promise~TData~`), ResourceV2 return types (`createAgent(): ResourceV2Agent~TArgs_TData~`, `query(...): Promise~TData~`, `getEntry/getEntry$: ResourceV2CacheEntry~TArgs_TData~`) — all present and matching model. |
| 2 | `PatchHandle` → `IPatchHandle` in §5.1 | ✅ | §5.1 MachineWithData: `+createPatch(patchFn): IPatchHandle \| null` — matches model §3 interface name. |
| 3 | No `createApi --> CacheMap` arrow in §2 L2 | ✅ | §2 L2: `createApi` node exists in Layer 3 subgraph but has no outgoing dependency arrows to `CacheMap`. Only `createResource --> ResourceV2` in api layer. |
| 4 | `useResAgent` arrow targets `Agent`, not `createResource` | ✅ | §2 L2: `useResAgent --> Agent` — correct per model §13 and arch §4. |
| 5 | New RCE test case for ADR-14 `complete()` with active patches exists | ✅ | RCE15: "entry.complete() is terminal: aborts patches → idle → onClean$ → completed (ADR-14)" — P0 priority, tests full cleanup sequence with active patches. |
| 6 | `doForce?` (not `force?`) in §5.2 ResourceV2 | ✅ | §5.2: `+query(args, doForce?): Promise~TData~` — matches model §7.2 "do" prefix convention. |
| 7 | `_lastArgs` field present on ResourceV2Agent in §5.2 | ✅ | §5.2: `-_lastArgs: TArgs \| SKIP_TOKEN \| null` — present, matches model §8.1. |
| 8 | `IResourceV2AgentState~TArgs_TData~` (not `AgentState`) in §5.2 | ✅ | §5.2: `+state$: ComputeFn~IResourceV2AgentState_TArgs_TData~` — correct interface name with generics. |
| 9 | `RCE --> Machines` edge exists in §4 | ✅ | §4 Module Dependency Diagram: `RCE --> Machines` arrow present. Also consistent with §2 (`RCE --> Machines`) and §3 (`RCE -.-> MachSub`). |
| 10 | Patcher call-site consistent between arch §4, ADR-6, and model | ✅ | §4 shows both `RCE --> Pat` and `Machines --> Pat`. Model confirms both paths: MachineWithData delegates patch creation to Patcher (§3), RCE manages `_patchState` via Patcher and checks `isConsistencyViolation` (§7.3). ADR-6 "3-4 call sites in RCE" refers to RCE checking Patcher results. No contradiction. |
| 11 | §3.1 `install()` uses only `IPluginContext` fields (no `api`) | ✅ | §3.1: `API->>P1: install({keyStrategy})` — only `keyStrategy` passed, no `api` parameter. Consistent with model §11 `IPluginContext`. |
| 12 | R17 references only existing test IDs | ✅ | R17 verification line: "INT05, INT06, RE14, RCE15, GC04 pass" — all test IDs verified present in `06-testcases.md`. Zero mentions of stale RE20/RE21. |
| 13 | LH01 tools match `ICacheEntryAddedTools` exactly | ✅ | LH01 expected output: `(args, { $cacheDataLoaded, $cacheEntryRemoved })` — matches model §9 `ICacheEntryAddedTools<TData>`. No phantom `cacheEntry` field. |
| 14 | LH05 uses `getCacheEntry` (function), not `cacheEntry` | ✅ | LH05 expected output: `(args, { getCacheEntry, $queryFulfilled })` — matches model §9 `IQueryStartedTools<TArgs, TData>`. |

#### Can-Defer / Low Resolution (7/8 ✅, 1 SKIP)

| # | Issue | Status | Verification |
|---|-------|--------|--------------|
| 15 | `_compareArgs` has specific signature (not `Function`) | ✅ | §5.2: `-_compareArgs: (TArgs, TArgs) => boolean` — specific typed signature. |
| 16 | `_status$`/`_lastEntry$` have generic params in §5.2 | ✅ | §5.2: `-_status$: SignalFn~idle_or_ready~`, `-_lastEntry$: SignalFn~ResourceV2CacheEntry_or_null~` — Mermaid-compatible generic notation present. |
| 17 | Non-nullable overload for `getEntry`/`getEntry$` | SKIP | Acceptable class diagram simplification — model §7.2 has overloads, class diagrams show simplified signature. |
| 18 | `RCE` dotted arrow targets entire machine subsystem in §3 | ✅ | §3: `RCE -.->\|"machines as TState"\| MachSub` — targets `MachSub` subgraph (entire machine subsystem), not individual `MachineIdle`. |
| 19 | Node E in §5.2 Read Path has outgoing edge for `doInitiate=true` | ✅ | §5.2 Read Path: `E -->\|"doInitiate=true"\| D` — outgoing edge from "null / create if doInitiate" to `ResourceV2CacheEntry`. |
| 20 | PA12: `patchState: null` (not `patches: null`) | ✅ | PA12 expected output: `{ data: orig, patchState: null }` — matches `IPatchResolution<TData>` field name. |
| 21 | AG01: no `resource.query(args)` reference | ✅ | AG01 description: "agent.start(args) obtains entry via `_getEntry` callback and calls `entry.query()`" — no Resource dependency, consistent with ADR-18. |
| 22 | Test ID gaps closed, cross-references updated | ✅ | Verified: RE01–RE23 continuous, AG01–AG14 continuous, RH01–RH10 continuous, INT01–INT14 continuous. Minor AP07 gap persists (not part of tracked gaps). |

#### Regression Spot-Checks (all clear)

| Prior Issue | Check | Status |
|-------------|-------|--------|
| #2 (Commands removed) | Zero Command content in design docs 01–08 | ✅ |
| #17 (OperationV2 removed) | Zero OperationV2 references in design docs 01–08 | ✅ |
| #27 (no resetAllCacheV2) | Only `api.resetAll()` exists; zero `resetAllCacheV2` matches | ✅ |
| #31 (no refreshError) | `IResourceV2AgentState` in model §8.1 has no `refreshError` field; zero matches in 01–08 | ✅ |
| #3 (dependency chain explicit) | `ResourceV2 → CacheMap → RCE extends CacheEntry → Machine` in arch §3, §5.2, model §7.3, ADR-4 | ✅ |
| #25 (Agent independence from Resource) | Agent has `_getEntry`/`_compareArgs` callbacks only — no Resource reference in model §8.1 or arch §5.2 | ✅ |
| #29 (C4 diagrams correct) | Phase 39/41 edits to arch §2/§4/§5.1/§5.2 preserved all C4 diagram chains; no orphaned nodes or broken arrows | ✅ |

## Quality Review

> **Review round**: Fifteenth review cycle (Phase 76) — re-review after Redraft Round 14 (Phases 72–75). Verified all 35 Low-severity issues from Verification Round 13.
>
> **Previous reviews**:
> - Phase 4: 3 reviewer + 3 user issues = 6 total → Redraft Round 1 (Phases 5–6)
> - Phase 7: 1 Low + user gaps (createApi/ReactHooksPlugin missing) → Redraft Round 2 (Phase 8)
> - Phase 9: All PASS. User: `createApiV2` naming + missing `hydrateSnapshot()` → Redraft Round 3 (Phase 10)
> - Phase 11: 1 Low → Redraft Round 4 (Phase 12)
> - Phase 13: 0 issues. User: 16 issues → Redraft Round 5 (Phases 14–19)
> - Phase 20: 0 issues. User: 10 new issues (#17–#26) → Redraft Round 6 (Phases 21–24)
> - Phase 25: 4 issues (2 Medium, 2 Low) → Redraft Round 7 (Phase 26)
> - Phase 27: All fixes verified. User: 10 new issues (#27–#36) → Redraft Round 8 (Phases 28–30)
> - Phase 31: 2 issues (1 Medium, 1 Low) → Redraft Round 9 (Phases 32–34)
> - Phase 38: 3 parallel review passes → 22 unique issues → Redraft Round 10 (Phases 39–41)
> - Phase 42: Re-review after Round 10 — all 22 issues verified resolved. User: 8 new issues (#41–#48) + 2 reviewer issues → Redraft Round 11 (Phases 42–44)
> - Phase 45: Re-review after Redraft Round 11 — all 10 issues verified resolved. User: 1 critical issue (#49) → Redraft Round 12 (Phase 46)
> - Phase 47: Critical re-review with x10 depth after Phase 46 — Issue #49 verified resolved, zero contamination
> - Phase 71: Re-review after Redraft Round 13 — all 24 issues (2 CRI + 10 High + 12 Medium) verified resolved
> - **Phase 76 (current)**: Re-review after Redraft Round 14 — all 35 Low-severity issues verified resolved

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Design decisions trace to research findings | **PASS** | All 19 ADRs have `[ref: ...]` links to research documents. Verified: ADR-1→02-codebase-query-v1.md#1, ADR-3→01-codebase-query-v2.md#63/02-codebase-query-v1.md#22, ADR-5→03-external-research.md#25, ADR-12→04-open-questions.md#q12. |
| 2 | ADRs have Status, Context, Options, Decision, Consequences | **PASS** | All 19 ADRs verified complete. ADR-1 Decision section updated to "5-layer" — correct and consistent with architecture §2. |
| 3 | Mermaid diagrams present and conformant | **PASS** | All diagrams verified. §4 now includes `Machines --> Pat` edge (Round 14 fix). §3a shows `_savedSnapshot` node. New §6.4 `resetAll()` consolidated sequence diagram added. All diagrams ≤20 elements, titled. |
| 4 | Test strategy covers identified risks | **PASS** | 137+ test cases across all layers. New tests from Round 14: CM19 (values), AG15-AG18 (state fields), PL09-PL11 (type-level + cross-plugin), AP11 (standalone), CE10 (beforeDevtoolsPush). All R01-R22 risks have test cross-references. |
| 5 | docs.md proportional to existing docs/demos | **PASS** | 3 new v0.2 files mirroring v0.1 structure, deprecation banners, migration guide update, 3 demo file updates. Proportional to existing `docs/query-v2/v0.1/` (4 files) and `apps/demos/src/examples/query-v2/` (3 files). |
| 6 | docs.md describes WHAT not HOW | **PASS** | Lists what needs documentation without JSDoc proposals or full-text drafts. |
| 7 | No implementation details or code | **PASS** | Design-level only; illustrative TypeScript snippets for API surface are appropriate. Model §16 (stableStringify, Batcher) provides signatures without implementation. |
| 8 | Research open questions addressed or deferred | **PASS** | All 19 open questions from research resolved through ADRs. |
| 9 | Risk analysis has actionable mitigations | **PASS** | All 22 risks have mitigation plans with valid test case cross-references. New test IDs from Round 14 (CM19, AG15-AG18, PL09-PL11, AP11, CE10) strengthen coverage. |
| 10 | Internal consistency (arch/dataflow/model/usecases) | **PASS** | **Round 14 focus (35 Low issues)**: All resolved. Key improvements: §4 dependency diagram now complete (Machines→Pat edge). Dataflow diagrams reference full agent state shape. Model now includes CacheEntry.obs, Batcher, LifecycleHooks class, stableStringify signature, machine transition methods, getSnapshot throw spec. Cross-document references corrected (UC-3→04-decisions.md, UC-4→model/dataflow). Test sections correctly labeled per architecture layers. **All prior fixes preserved**: Zero regressions from prior 14 redraft rounds. |

### Documentation Proportionality

**Existing docs**: `docs/query-v2/` has 1 README + `v0.1/` (4 files: README.md, optimistic-updates.md, ssr.md, Внутриянка.md). `apps/demos/src/examples/` has query/ and query-v2/ demo dirs + index.ts.

**Proposed in 07-docs.md**: 3 new v0.2 files (mirroring v0.1 minus Внутриянка), deprecation banners on existing v0.1, migration guide update, 3 existing demo file updates (no new demos).

**Assessment**: Proportional. No over-specification or under-specification.

### Issues Found

No issues found.

**Redraft Round 14 verification (Phase 76 — 35 Low-severity issues from Verification Round 13):**

All 35 Low-severity issues verified resolved across 5 documents:
- 01-architecture.md + 04-decisions.md: 6/6 ✅
- 02-dataflow.md: 7/7 ✅
- 03-model.md: 6/6 ✅
- 05-usecases.md: 4/4 ✅
- 06-testcases.md: 14/14 ✅

See Redraft Round 14 table in Issue Resolution History above for per-issue evidence.

#### Regression Spot-Checks (all clear)

| Prior Issue | Check | Status |
|-------------|-------|--------|
| #2 (Commands removed) | Zero Command content in design docs 01–08 | ✅ |
| #17 (OperationV2 removed) | Zero OperationV2 references in 01–08 | ✅ |
| #25 (Agent independence) | Agent model §8.1: `_getEntry`/`_compareArgs` callbacks only | ✅ |
| #27 (no resetAllCacheV2) | Only `api.resetAll()` exists | ✅ |
| #31 (no refreshError) | `IResourceV2AgentState` has no `refreshError` | ✅ |
| #41 (ResourceV2 Registry) | Zero matches in 01–08 | ✅ |
| #46 (NO_VALUE) | Zero matches in 01–08 | ✅ |
| #48 (initialSnapshot lifecycle) | save→consume+delete→delete consistent across all docs | ✅ |
| #49 (ADR-12 hydration) | ADR-12 still says "no resources exist yet", "CacheMap is always empty" | ✅ |
| CRI-1 (createPatch return type) | `CreatePatchResult` in arch §5.1, model §3, consistent ownership boundary | ✅ |
| CRI-2 (args-change abort) | RE11/INT12 correctly state old entry continues independently | ✅ |

#### Type Consistency Check

All generics use `<TArgs, TData>` across all documents. Machine classes: `~TArgs_TData~`. Interfaces: `<TArgs, TData>`. No `TError` anywhere. ✅

## Next Steps

Design stage **approved** (Phase 76 — fifteenth review cycle). All 35 Low-severity issues from Verification Round 13 resolved across Redraft Round 14 (Phases 72–75). Previously, all 24 issues (2 CRI + 10 High + 12 Medium) were resolved in Redraft Round 13 (Phases 68–70). Combined with 49 prior user issues and all reviewer issues resolved across 12 earlier redraft rounds, the design is comprehensive and internally consistent. Zero regressions across all 15 review cycles. Proceeds to Plan stage after human review.
