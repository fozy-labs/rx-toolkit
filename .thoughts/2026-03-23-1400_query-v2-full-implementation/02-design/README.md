---
title: "Design: Full implementation of query-v2 module"
date: 2026-03-23
status: In Progress
feature: "Full implementation of query-v2 module with tests — architecture, state machines, snapshots, cache, plugins, React integration"
research: "../01-research/README.md"
---

## Overview

Comprehensive technical design for the query-v2 module rewrite: a cache-backed asynchronous data management system built on the Signals reactive layer, featuring machine-based state management (Idle → Pending → Success/Error → Refreshing), Immer-based optimistic patches, refcount+timer GC, SSR snapshots, plugin-extensible architecture, and thin React integration via `useSyncExternalStore`. The design resolves all 19 research open questions through 17 ADRs and provides full type, data-flow, and test specifications across all five layers (lib → core → api → react → plugins).

## Goals

- Replace the current broken v2 implementation with a precise, fully-tested rewrite matching v0.1 documentation
- Resolve all type system problems (eliminate TError, eliminate `as unknown as` casts)
- Fix SWR previous/current swap so stale-while-revalidate actually works
- Implement missing documented features: `_status$`/`_lastEntry$` signals, consistency violation detection, `refreshError`, rich `IResourceV2CacheEntry`
- Provide industry-standard GC (refcount + timer hybrid) preventing data eviction while components are mounted
- Design plugin API that accommodates future Command support without current implementation
- Provide `createApi` as the canonical single-instance entry point with plugin registration, shared cache configuration, snapshot coordination, and resetAll

## Non-Goals

- **Command / mutation type** — explicitly deferred; only Resource and Operation designed
- **TError generic parameter** — user decision: errors are always `unknown`
- **ResourceDuplicator** — deferred to separate task
- **DevTools UI/formatting** — Signal.state provides DevTools infrastructure; no additional tooling designed
- **Current v2 code as reference** — design is based on v0.1 docs and v1 patterns only
- **Structural sharing on hydration** — deferred; skip-if-exists is sufficient

## Documents

| # | Document | Description |
|---|----------|-------------|
| 1 | [Architecture](./01-architecture.md) | C4 diagrams (L1–L3 including API & Plugin layer), 5-layer module hierarchy (lib → core → api → react → plugins), component boundaries, signal integration, `createApi` as primary entry point, `ReactHooksPlugin` in plugin layer, public/internal/extension API boundaries, key constraints |
| 2 | [Data Flow](./02-dataflow.md) | 18+ sequence/flowchart diagrams: Resource fetch/SWR/abort/retry/GC, Operation execute/concurrent, Snapshot capture/hydrate, `createApi` initialization flow, `ReactHooksPlugin` registration & hook contribution lifecycle, Plugin hook invocation order, Optimistic patches. Full state machine specifications for Resource (5 states) and Operation (4 states) |
| 3 | [Domain Model](./03-model.md) | Complete TypeScript type definitions: machine states, cache entries, CacheMap, Resource/Agent/Operation, lifecycle hooks, snapshots, plugins (`IPlugin`, `ReactHooksPlugin` class, `PluginContributionMap`), `createApi`/`IApi`/`ICreateApiOptions` factory signatures, standalone factories, React hooks. All types use `<TArgs, TData>` only |
| 4 | [Decisions](./04-decisions.md) | 17 ADRs covering layering, state machines, SWR, CacheEntry boundary, GC, Patcher safety, cache keys, snapshots, plugins, agent behavior, getEntry$ reactivity, hydration sharing, compare+snapshot, operation concurrency, CacheEntry.complete(), V2 naming convention, single API instance as entry point (ADR-17) |
| 5 | [Use Cases](./05-usecases.md) | 21 use cases with TypeScript code examples: `createApi` as primary entry point throughout, `ReactHooksPlugin` in shared setup and UC-10, basic resource, args, SWR, error/retry, optimistic patches, invalidation, GC, SKIP, dedup, plugins, operations, React hooks (`useResourceV2`, `useOperationV2`), SSR with server/client API instances, resetAll, lifecycle hooks |
| 6 | [Test Cases](./06-testcases.md) | Testing pyramid (70% unit / 15% component / 15% integration), controllable-promise pattern, 150+ test cases across lib/core/api/react/integration layers, plugin tests (PL01–PL08) including `ReactHooksPlugin` contribution (PL06), edge cases, performance criteria |
| 7 | [Documentation Impact](./07-docs.md) | v0.1 deprecation banners, v0.2 docs (README + optimistic-updates + ssr), migration guide update, 3 existing demo file updates |
| 8 | [Risks](./08-risks.md) | 23 risks with probability/impact matrix, detailed mitigation plans for 10 highest-severity risks, test case cross-references for all High/Medium risks |

## Key Decisions

| ADR | Decision | Rationale |
|-----|----------|-----------|
| ADR-1 | 4-layer strict hierarchy `lib/ → core/ → api/ → react/` + `plugins/` and `types/` | Proven in v1; prevents circular deps; each layer independently testable |
| ADR-2 | Immutable class-based state machines with `.state` extraction for snapshots | Method-based transitions prevent invalid state changes at the type level; matches v0.1 strong typing requirement |
| ADR-3 | SWR: keep previous entry until current resolves | Fixes the critical bug in current v2; proven pattern from v1 and all major libraries |
| ADR-4 | Internal CacheEntry + consumer-facing IResourceV2CacheEntry wrapper | Clean separation; internal entry reusable by Resource and Operation; consumer API matches v0.1 docs |
| ADR-5 | Refcount + timer hybrid GC | Industry standard (TanStack/RTK/Relay); prevents data GC while components are mounted |
| ADR-6 | Patcher returns `{data, isConsistencyViolation}`, Resource auto-invalidates | Prevents silent data corruption from out-of-order patch aborts |
| ADR-7 | Minimal stableStringify (plain objects/arrays/primitives only) | User decision; `serializeArgs` override and `compare` strategy cover edge cases |
| ADR-8 | Snapshot via `.state` extraction + `Machine.fromSnapshot()` reconstruction | Clean JSON boundary; no class serialization issues |
| ADR-9 | Synchronous plugin API with Object.assign + declaration merging | Established pattern; runtime collision detection adds safety |
| ADR-10 | Agent.start() triggers query (with dedup), not just observes | SWR-compatible; hook users just pass args; matches TanStack/SWR behavior |
| ADR-11 | `_status$` and `_lastEntry$` signals for getEntry$ reactive reset | Exactly matches v0.1 Внутриянка specification; enables correct resetAll() behavior |
| ADR-12 | No structural sharing at hydration; skip-if-exists sufficient | One-time operation; complexity not justified |
| ADR-13 | compare CacheMap throws on snapshot | Documented limitation; compare is for non-serializable in-memory-only scenarios |
| ADR-14 | Operation concurrent execution: latest-wins, no abort | Operations are mutations with side effects; aborting may cause server-side inconsistency |
| ADR-15 | CacheEntry.complete() = full cleanup (abort patches → idle → onClean$) | Terminal operation; deterministic GC cleanup; matches test expectations |
| ADR-16 | V2 suffix on public-facing entity names (`createResourceV2`, `IResourceV2CacheEntry`, etc.); exception: `createApi`/`IApi`/`ICreateApiOptions` | Avoids naming collisions with v1 exports; API factory name describes action, not versioned entity |
| ADR-17 | Single API instance (`createApi`) as canonical entry point | Unified configuration, plugin install point, snapshot coordination, resetAll tracking; matches v0.1 docs and industry standard (RTK `createApi`, Apollo `ApolloClient`); standalone factories available for simple cases |

## Quality Review

> **Review round**: Fifth review cycle — Phase 12 Redraft Round 4 verification (CacheEntry composition, no machine refs, Mermaid §6 fixes, IResourceV2 trimmed, TResourceV2SnapshotSlice consistency)
>
> **Previous reviews**:
> - Phase 4: 3 reviewer + 3 user issues = 6 total → Redraft Round 1 (Phases 5–6)
> - Phase 7 re-review: 1 Low (PL06) + user-identified gaps (createApi missing, ReactHooksPlugin missing, analysis insufficiently thorough) → Redraft Round 2 (Phase 8)
> - Phase 8 re-review: All PASS. User identified `createApiV2` naming error + missing `hydrateSnapshot()` signature → Redraft Round 3 (Phase 10)
> - Phase 11 re-review: 1 Low issue (§16 `TResourceSnapshotSlice` naming) → Redraft Round 4 (Phase 12) fixing 5 design improvements

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Design decisions trace to research findings | **PASS** | All 17 ADRs have `[ref: ...]` links. Spot-checked ADR-3 (3 refs: v2 SWR bug, v1 approach, external libraries), ADR-5 (3 refs: v2 timer-only, v1 ReactiveCache, external libs), ADR-6 (3 refs: v0.1 docs, current missing try/catch, research finding). All references verified accurate. |
| 2 | ADRs have Status, Context, Options, Decision, Consequences | **PASS** | All 17 ADRs verified: each has all 5 required sections. Options include pros/cons. Consequences have positive/negative/risks subsections. No empty or hand-waving sections. |
| 3 | Mermaid diagrams present and conformant | **PASS** | 25+ diagrams across architecture (8), dataflow (20+), model (1). §6 flowcharts use `---` YAML frontmatter title format (Phase 12 fix). sequenceDiagram, classDiagram, stateDiagram-v2, graph, flowchart types all present and titled. Element counts within 15–20 range. |
| 4 | Test strategy covers identified risks | **PASS** | All 23 risks (R01–R23) mapped to test cases. Key: R01→SM01–SM36, R02→RE02/RE03/RE11/AG12/AG13/E06, R03→RH04/GC01–GC05/CE05, R05→PA10/PA11/INT10, R08→RH10, R09→RH05, R13→controllable-promise pattern, R17→INT06/INT07/RE15, R19→AG03/AG04/INT02. |
| 5 | docs.md is concise and proportional to existing docs/demos | **PASS** | Existing v0.1: 4 files. Proposed v0.2: 3 files (mirrors v0.1 minus Внутриянка). Existing demos: 3 files; proposal updates all 3, adds 0. Proportional. |
| 6 | docs.md describes WHAT not HOW (no JSDoc, no full drafts) | **PASS** | Lists files to update/create, concepts to document, migration scope, demo files. No JSDoc specifications, no full-text drafts. |
| 7 | No implementation details or code | **PASS** | Model: TypeScript interface/type API specifications. Use cases: illustrative API examples. Test cases: ID/input/output tables. No class implementations or function bodies. |
| 8 | Research open questions addressed or deferred | **PASS** | All 19 questions resolved: Q1→no TError, Q2→ADR-3, Q3→deferred, Q4→ADR-4, Q5→ADR-15, Q6→ADR-6, Q7→generic CacheEntry\<TState\>, Q8→ADR-11, Q9→model §8.2, Q10→ADR-7, Q11→ADR-5, Q12→ADR-12, Q13→model §8.1 refreshError, Q14→model §12, Q15→06-testcases, Q17→ADR-10, Q18→ADR-13, Q19→arch §6.1. |
| 9 | Risk analysis has actionable mitigations for high-impact risks | **PASS** | 11 detailed mitigation plans (R01, R02, R03, R05, R08, R09, R10, R13, R17, R19, R20) with numbered steps, specific test case IDs, and verification criteria. |
| 10 | Internal consistency (arch/dataflow/model/usecases) | **PASS** | Verified: (a) CacheEntry uses `state$()` — arch §5.2, model §5, CE01–CE04; (b) IResourceV2CacheEntry uses `machine$()` delegating to CacheEntry.state$() — model §7.3, arch §5.2, arch §7.1 reactive chain, RCE01; (c) IResourceV2 has exactly 5 methods — model §7.2, arch §5.2; (d) TResourceV2SnapshotSlice consistent — model §11, §16, ADR-16; (e) ResourceV2CacheEntry composition — model §7.3, arch §3/§5.2, ADR-4; (f) MachineRefreshing.errorHappened()→MachineSuccess — dataflow §1.4/§5.1, ADR-2, SM21. |

### Phase 12 (Redraft Round 4) — Fix Verification

| # | Fix | Verification | Status |
|---|-----|-------------|--------|
| 1 | ResourceV2CacheEntry uses composition (contains CacheEntry), not inheritance | Model §7.3: "Composes an internal ICacheEntry...via private `_entry` field". ADR-4: "wrapper". Arch §5.2 classDiagram: `IResourceV2CacheEntry --> CacheEntry : wraps`. Arch §3: `RCE -.-> wraps CE`. No `extends`/inheritance keywords in any document. | ✅ |
| 2 | CacheEntry no longer has `machine$()` — uses generic `state$` signal instead | Model §5 `ICacheEntry<TState>`: only `state$()`, `peek()`, `set()`, `complete()`, `onClean$` — zero machine references. Arch §5.2: `CacheEntry~TState~` with `+state$(): TState`. Tests CE01–CE04 use `state$()`. Grep `ICacheEntry.*machine` across design docs: 0 matches. | ✅ |
| 3 | Mermaid diagrams in §6 syntax errors fixed | Dataflow §6: all 5 flowcharts (Write Path, Read Path, Invalidation Flow, GC Trigger Flow, Optimistic Patch Flow) use `---` YAML frontmatter title format instead of inline title nodes. | ✅ |
| 4 | IResourceV2 trimmed to match v0.1 docs (only createAgent, query, getEntry/getEntry$, invalidate) | Model §7.2 `IResourceV2` has exactly: `createAgent()`, `query()`, `getEntry()` (2 overloads), `getEntry$()` (2 overloads), `invalidate()`. No internal methods exposed on public interface. Arch §5.2 class diagram matches. | ✅ |
| 5 | `TResourceSnapshotSlice` → `TResourceV2SnapshotSlice` | Model §11 definition: `TResourceV2SnapshotSlice`. Model §16 summary table: `TResourceV2SnapshotSlice`. ADR-16 naming table: `TResourceV2SnapshotSlice`. All 3 locations consistent. Previous Low issue resolved. | ✅ |

### V0.1 Completeness Audit

| V0.1 Concept | Design Location | Status |
|--------------|-----------------|--------|
| `createApi` factory + all 9 parameters | model §13.1 `ICreateApiOptions`, arch §3a, ADR-17, UC shared setup | ✅ |
| `api.createResource()` + all 10 options | `api.createResourceV2()` — model §7.1 `IResourceV2Options`, model §13.1 `IApi` | ✅ |
| Resource methods: createAgent, query, getEntry, getEntry$ | `IResourceV2` — model §7.2, arch §5.2 (+ invalidate) | ✅ |
| `IResourceV2CacheEntry` (isMyArgs, createPatch, machine$, peek) | model §7.3 (machine$/peek delegate to internal CacheEntry.state$), arch §5.2, UC-5 | ✅ |
| Agent state (status, data, error, args, isLoading, isInitialLoading, isRefreshing, isSuccess, isError) | `IResourceV2AgentState` — model §8.1 (+ refreshError, entry) | ✅ |
| Machine states: idle, pending, success, error, refreshing | model §2, arch §5.1, dataflow §5 | ✅ |
| `SKIP` token | model §1, UC-8 | ✅ |
| Cache strategies: serialize, compare | model §6, ADR-7, ADR-13 | ✅ |
| `ReactHooksPlugin` + `useResourceV2Agent` | model §12.1, arch §3a, dataflow §4.4, UC-10, PL06 | ✅ |
| `onCacheEntryAdded` + tools ($cacheDataLoaded, $cacheEntryRemoved) | model §10, LH01–LH04, UC-20 | ✅ |
| `onQueryStarted` + tools ($queryFulfilled, getCacheEntry) | model §10, LH05–LH07, UC-21 | ✅ |
| SSR: getSnapshot, initialSnapshot, TApiSnapshot, maxSnapshotDataAge | model §11/§13.1, dataflow §3, ADR-8, UC-17, SN01–SN10 | ✅ |
| SSR: only success entries, keyPrefix matching, version validation | dataflow §3.1, SN01–SN05 | ✅ |
| SSR: compare strategy limitation | ADR-13, SN10 | ✅ |
| Optimistic updates: createPatch/commit/abort | model §3/§7.3, UC-5, RCE05–RCE07, INT08/INT09 | ✅ |
| Consistency violation → auto-invalidation | ADR-6, dataflow §6.5, PA10/PA11, INT10 | ✅ |
| Внутриянка: _status$/_lastEntry$ signals | ADR-11, arch §6.1, dataflow §7.2, RE24–RE27 | ✅ |
| Внутриянка: Strong typing (void args, doInitiate non-nullable, SKIP, machines) | model §8.2, model §7.2 overloads, model §8.1, arch §5.1 | ✅ |

### Redraft Round 2 — Resolution Verification

| Gap | Description | Resolution | Verified |
|-----|-------------|------------|----------|
| **A** | `createApi` absent from architecture diagrams, data flows, domain model, decisions, and use cases | Now present in: arch §2 Module Layering (Layer 3: api/), arch §3a C4 L3 API & Plugin Layers (full diagram with factory, registry, config, returned API instance), arch §4a API Layer Dependencies, dataflow §4.3 createApi Initialization sequence, model §13.1 `ICreateApiOptions`+`IApi` complete signatures, ADR-17 (new, full ADR with 3 options), UC shared setup + UC-17 SSR server/client instances | ✅ |
| **B** | `ReactHooksPlugin` absent from architecture diagrams, data flows, domain model, and use cases | Now present in: arch §2 Module Layering (Layer 5: plugins/), arch §3a C4 L3 API & Plugin Layers (with install/augment flows), arch §4a API Layer Dependencies (dependency arrows), dataflow §4.1 Plugin Hook Invocation Order sequence, dataflow §4.4 ReactHooksPlugin Registration & Hook Contribution sequence (3-phase lifecycle), model §12.1 ReactHooksPlugin class with `augmentResource` return type + declaration merging, UC-10 Plugin usage, UC shared setup (`new ReactHooksPlugin()`), PL06 test case, INT04 integration test | ✅ |
| **C** | PL06 wording inaccurate — previously mentioned `useOperationV2` as plugin contribution | PL06 now reads: "ReactHooksPlugin contributes `useResourceV2Agent` method to resource instances via `augmentResource()`" with expected output "Resource instance has `.useResourceV2Agent()` method; operation instances are not augmented by this plugin". Aligns with v0.1 docs which only show `useResourceV2Agent` as a resource-level plugin contribution. | ✅ |

### Redraft Round 1 — Issue Resolution Verification (prior round, for completeness)

| # | Original Issue | Resolution | Verified |
|---|---------------|------------|----------|
| 1 | V2 suffix missing on public API names; no naming ADR | ADR-16 added. All public names carry V2 suffix across all 8 docs. | ✅ |
| 2 | `ArgsOrVoid` not applied to `IResourceV2` methods | All methods now use `...args: ArgsOrVoid<TArgs>`. UC-16 confirms. | ✅ |
| 3 | `MachinePending~TData~` diagram showed `args: TArgs` | Now shows `+args: unknown`. | ✅ |
| 4 | Snapshot → Resource dependency incorrect | Corrected to Snapshot → CacheEntry. | ✅ |
| 5 | `ResourceV2CacheEntry` absent from diagrams | Added to C4 L3 and Core Abstractions diagrams. | ✅ |
| 6 | V2 suffix not preserved (same as #1) | Resolved with #1. | ✅ |

### Redraft Round 3 — Resolution Verification (Phase 10)

| Change | Description | Resolution | Verified |
|--------|-------------|------------|----------|
| **`createApiV2` → `createApi` rename** | All occurrences of `createApiV2`, `ICreateApiV2Options`, `IApiV2` removed from design docs | Zero occurrences across all 8 design docs except 3 in ADR-16 historical context (Option 1 description, exception clause "NOT createApiV2", user quote verbatim) — the ONLY acceptable location | ✅ |
| **ADR-16 exception clause** | `createApi`/`IApi`/`ICreateApiOptions` explicitly documented as not carrying V2 suffix | Exception clause present with rationale ("action, not versioned entity") and user verbatim quote. Complete naming table includes `TResourceV2SnapshotSlice`. | ✅ |
| **ADR-17 added** | Single API instance (`createApi`) as canonical entry point | Full ADR with Status/Context (3 refs)/Options (3 with pros/cons)/Decision/Consequences. Cross-referenced from architecture §3a and §4a. | ✅ |
| **`hydrateSnapshot()` signature** | Standalone function signature added to model | Model §13.3: `declare function hydrateSnapshot(api: IApi, snapshot: TApiSnapshot): void;` with refs to dataflow §3.1 and ADR-8. Consistent with SSR flow and snapshot types. | ✅ |

### Documentation Proportionality

**Existing docs**: `docs/query-v2/` has 1 README + `v0.1/` (4 files: README.md, optimistic-updates.md, ssr.md, Внутриянка.md). `apps/demos/src/examples/query-v2/` has 3 demo files + index.ts.

**Proposed in 07-docs.md**: 3 new v0.2 files (mirroring v0.1 structure), deprecation banners on existing v0.1 files, migration guide update, 3 existing demo file updates (no new demos).

**Assessment**: Proportional. The v0.2 doc set mirrors v0.1 structure (minus Внутриянка, which is an internal design doc). Demo updates are in-place, not additive. Documentation scope matches the feature scope — a full rewrite warrants parallel v0.2 docs while keeping v0.1 accessible with deprecation banners.

### Issues Found

No issues found. All 5 Phase 12 fixes verified. All 10 review criteria pass. V0.1 completeness audit passes (18/18 concepts covered). The previous Low-severity issue (§16 `TResourceSnapshotSlice` → `TResourceV2SnapshotSlice`) was resolved in Redraft Round 4.

## Next Steps

Proceeds to Plan stage after human review.
