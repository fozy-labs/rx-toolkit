---
title: "Design: Query v2 Module"
date: 2026-03-18
status: Approved
feature: "New query-v2 module with createApi, ResourceV2, agents, caching, patches, machines, snapshots, plugins, SSR support"
research: "../01-research/README.md"
rdpi-version: b0.2
---

## Overview

Complete architecture design for the query-v2 module — a ground-up reimplementation of the data-fetching and caching layer in rx-toolkit. Replaces v1's boolean-flag state model with class-based state machines (5 classes, 12 transitions), introduces API-level grouping via `createApi`, a dual-strategy cache (serialize/compare), a type-safe plugin system, Patcher with hanging-patch fix, and SSR snapshot protocol. All design decisions trace to research findings and incorporate user decisions on all 17 open questions.

## Goals

- Define all public API surfaces: `createApi`, `api.createResource`, `IResourceV2`, `IResourceV2Agent`, machine classes, `Patcher`, `SKIP_TOKEN`, `NO_VALUE`
- Specify the plugin type system with TS2589 mitigations (ADR-1)
- Design dual-strategy cache (`serialize` + `compare`) with `ICacheMap` abstraction (ADR-3)
- Define MachineRefreshing error semantics — preserve stale data on transient errors (ADR-2)
- Fix v1's "hanging patch" bug via three-layer defense: AbortController + machine transitions + CacheEntry eviction (ADR-4)
- Design SSR snapshot protocol with versioned `TApiSnapshot`, `Machine.fromSnapshot()`, `maxSnapshotDataAge`-based invalidation
- Provide comprehensive test strategy (97 test cases) and risk analysis (12 risks with mitigations)

## Non-Goals

- Commands / operations — explicitly out of scope for v2 MVP (ADR-6 reserves API extensibility)
- `ResourceDuplicator` — not in RFC, out of scope (Q9)
- `select` transform — not in RFC, out of scope (Q15)
- `staleTime` separate from `cacheLifetime` — follow RFC, only `cacheLifetime` (Q16)
- Any imports from `src/query/` — full isolation (Q4)

## Documents

- [Architecture](./01-architecture.md) — C4 diagrams (L2/L3), module dependency graph, machine state hierarchy, component responsibilities, public API surface, integration points
- [Data Flow](./02-dataflow.md) — 9 sequence diagrams: cache miss, SWR, invalidation/refreshing, optimistic update, SSR lifecycle, plugin init, lifecycle hooks, SKIP_TOKEN, reactive query$
- [Domain Model](./03-model.md) — 16 type/interface definitions, entity relationship diagram, generic type propagation, state machine invariants and transition rules
- [Decisions](./04-decisions.md) — 9 ADRs: plugin type system, refreshing error handling, cache key strategy, patch lifecycle, agent subscription, createApi extensibility, CacheEntry implementation, devtools integration via Signal.state() beforeDevtoolsPush, hook naming split
- [Use Cases](./05-usecases.md) — 11 use cases with TypeScript examples: basic query, SWR, optimistic updates, SSR, plugins, lifecycle hooks, SKIP_TOKEN, invalidation, dual key strategies, devtools, error handling
- [Test Cases](./06-testcases.md) — 97 test cases across 11 categories (machines, cache, patcher, resource, agent, createApi, SSR, plugins, lifecycle, devtools, edge cases), with coverage targets and performance criteria
- [Documentation and Examples](./07-docs.md) — 4 new doc pages, 2 existing page updates, 1 migration guide, 2–3 new demos
- [Risks](./08-risks.md) — 12 risks with probability/impact matrix and detailed mitigations for 6 high-impact risks

## Key Decisions

- **ADR-1 (Plugin Types)**: Generic type accumulation (tRPC-style) with `PluginAugmentations<TPlugins>` using `UnionToIntersection` — scopes plugins per API instance, mitigates TS2589 by keeping contribution types flat and using `Prettify<T>`.
- **ADR-2 (Refreshing Errors)**: `MachineRefreshing.errorHappened()` transitions back to `MachineSuccess` preserving stale data — error flows through lifecycle hooks and Agent's `refreshError` field. Matches TanStack Query behavior.
- **ADR-3 (Cache Strategy)**: Abstract `ICacheMap` interface with `SerializedCacheMap` (Map-based, O(1)) and `CompareCacheMap` (array-scan, O(n)) implementations. SSR snapshots require `serialize` strategy.
- **ADR-4 (Patch Lifecycle)**: Three-layer defense against hanging patches — AbortController binding, machine transition cleanup (`abortAllPendingPatches`), CacheEntry eviction. Eliminates v1 bug.
- **ADR-7 (CacheEntry)**: Pure `Signal.state<TMachine>` — no RxJS BehaviorSubject indirection. Cache lifetime via setTimeout/clearTimeout managed by ResourceV2.
- **ADR-8 (Devtools)**: No separate devtools module — query-v2 leverages `Signal.state()`'s built-in `beforeDevtoolsPush` callback for Redux DevTools integration. Machine instances projected to `.state` plain objects automatically.
- **ADR-9 (Hook Naming)**: RFC's single `useResource` split into `useResourceV2Agent` (reactive data consumption) and `useResourceV2Ref` (imperative cache manipulation), following v1's `useResourceAgent`/`useResourceRef` convention with `V2` suffix.

## Quality Review

> Re-review after Redraft Round 1 (Phase 7). Original review found 2 Low-severity issues and user provided 3 feedback items. All addressed in Phases 5–6.

### Redraft Resolution Verification

| ID | Source | Description | Status | Verification |
|----|--------|-------------|--------|--------------|
| UF#1 | User Feedback | Folder structure: SKIP_TOKEN/NO_VALUE at module root | RESOLVED | Architecture §4 folder structure now places them in `lib/SKIP_TOKEN.ts` and `lib/NO_VALUE.ts` subfolder. Model paths updated consistently. |
| UF#2 | User Feedback | Machine State Hierarchy diagram incorrect | RESOLVED | Architecture §5 stateDiagram-v2 corrected. Shows all 12 transitions including MachineRefreshing error → MachineSuccess (stale data preserved). Class hierarchy with MachineWithData base documented. |
| UF#3 | User Feedback | Separate devtools module unnecessary; use Signal.state() `beforeDevtoolsPush` | RESOLVED | ADR-8 rewritten: decision is Option B (reuse Signal.state() built-in `beforeDevtoolsPush`). No `devtools/` folder in architecture §4. Model §1.14 defines `TBeforeDevtoolsPushFn`. UC-10 demonstrates usage. Test cases D1–D4 verify Signal.state() mechanism. Consistent across all 6 modified documents. |
| #1 | Reviewer | `TApiSnapshot` type placement late in model (§1.11) | RESOLVED | Cross-reference note added at the top of model §1.11 linking to architecture §6.9, dataflow §5, and model §1.3 `Machine.fromSnapshot()`. |
| #2 | Reviewer | No ADR for hook naming split (`useResource` → Agent/Ref) | RESOLVED | ADR-9 added to 04-decisions.md with full Status, Context, Options Considered, Decision, Consequences sections. References v1 pattern [01-codebase-query-v1.md#4]. |

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Design decisions trace to research findings | PASS | All 9 ADRs (ADR-1 through ADR-9) cite specific research documents with `[ref: ...]` links. New ADRs verified: ADR-8 → `02-codebase-signals-common.md#2.6` (Devtools.ts beforeDevtoolsPush) + Q11; ADR-9 → `01-codebase-query-v1.md#4` (v1 React hooks pattern). Previously verified: ADR-1 → external research §4 + Q1; ADR-2 → external research §2.2 + Q5; ADR-3 → external research §5.2; ADR-4 → codebase analysis §2.3 + Q12; ADR-7 → codebase analysis signals §1.1. |
| 2 | ADRs have Status, Context, Options, Decision, Consequences | PASS | All 9 ADRs contain all required sections. ADR-8 fully rewritten with two options (separate module vs. reuse Signal.state()). ADR-9 has two options (single hook vs. Agent/Ref split). |
| 3 | Mermaid diagrams present and conformant | PASS | 21 Mermaid diagrams across architecture (5: C4 L2, C4 L3 ×2, module dependency, state machine), dataflow (9 sequence diagrams), model (3: ER diagram, generic type flow, transition table). All titled via `title:` in YAML frontmatter. Largest diagram ~16 elements. Syntax verified: stateDiagram-v2, graph TB/LR, sequenceDiagram, erDiagram all used correctly. |
| 4 | Test strategy covers identified risks | PASS | High-impact risk → test mapping verified: R1 (TS2589) → PL6 type test; R2 (instanceof SSR) → S7, S8; R3 (hanging patch) → E9, E10, E11, P12; R5 (signals integration) → A1, A2, E8, E12; R7 (test complexity) → controllable promises + fake timers strategy; R11 (refreshing confusion) → M8, A7; R12 (GC edge cases) → E6, E7. Devtools test cases D1–D4 now correctly test Signal.state() `beforeDevtoolsPush` mechanism (updated per UF#3). |
| 5 | docs.md is concise and proportional to existing docs/demos | PASS | Existing: `docs/query/README.md` (~100 lines), 5 demo files in `apps/demos/src/examples/query/` (duplicator, shopping-cart, simple-list, todo-patches, user-profile). Proposed: 4 new doc pages (SSR, plugins, optimistic updates, API reference — justified; SSR/plugins have no v1 equivalent), 2 minor existing page updates, 1 migration guide, 2–3 new demos. Proportional to feature scope. |
| 6 | docs.md describes WHAT not HOW (no JSDoc, no full drafts) | PASS | Each documentation page listed with a one-sentence topic description. No JSDoc proposals, no full-text drafts. Migration guide references existing format (`docs/migrations/0.5.0.md`). |
| 7 | No implementation details or code | PASS | Architecture uses component-level descriptions and diagrams. Model contains type definitions and API signatures (appropriate for design). ADR-1/ADR-8 have illustrative TS snippets (allowed per rules). Use cases contain API usage examples. MachineWithData methods show comments-only pseudocode. No algorithm implementations or runnable logic. |
| 8 | Research open questions addressed or deferred | PASS | All 17 questions resolved (unchanged from original review): Q1→ADR-1; Q2→model Machine.fromSnapshot + dataflow SSR; Q3→model §1.4 + §1.8; Q4→architecture §1-2; Q5→ADR-2; Q6→model §1.12; Q7→ADR-3; Q8→architecture §6.10; Q9→out of scope; Q10→model §1.6; Q11→ADR-8 (now revised); Q12→ADR-4; Q13→ADR-6; Q14→model §1.2; Q15→out of scope; Q16→RFC; Q17→model §1.11. |
| 9 | Risk analysis has actionable mitigations for high-impact risks | PASS | 6 high-impact risks (R1, R2, R3, R5, R7, R8) all have detailed multi-step mitigation plans. Unchanged from original review — redraft did not modify risk analysis. |
| 10 | Internal consistency (arch/dataflow/model/usecases) | PASS | Post-redraft consistency verified: (a) ADR-8 (beforeDevtoolsPush) consistent across architecture (no devtools/ folder), model (§1.14 TBeforeDevtoolsPushFn, §1.2 IResourceV2Options.beforeDevtoolsPush), usecases (UC-10), test cases (D1–D4). (b) ADR-9 (hook naming) consistent across model §1.10 ReactHooksPlugin, usecases UC-1/UC-5, test cases PL1–PL6. (c) Folder structure (lib/SKIP_TOKEN, lib/NO_VALUE) consistent between architecture §4 and component diagrams. (d) Machine transitions in state diagram (§5, 11 unique arrows + initial) align with model class definitions (§1.3). See Issue #1 below for one pre-existing discrepancy in the transition rules table. |

### Documentation Proportionality

Existing documentation: `docs/query/README.md` (~100 lines), plus docs for signals, options, devtools, migrations (0.5.0). Demo directory: 5 query examples (duplicator, shopping-cart, simple-list, todo-patches, user-profile), plus signals examples. Proposed v2 additions: 4 new pages, 2 existing page updates, 1 migration guide, 2–3 new demos. This is proportional — v2 introduces SSR snapshots, plugin system, and machine states, none of which have v1 equivalents. Demo count (2–3) is appropriately smaller than v1's (5) for the experimental phase.

### Issues Found

No critical, high, or medium issues found. All Redraft Round 1 items resolved.

1. **Low — Pre-existing: `MachineSuccess.start(args)` inconsistency between transition rules table and class definition** — The model's transition rules table (§4.2, row 6) lists `success → pending` via `start(args)`, and test case M5 expects `success.start({ id: 2 })` → `MachinePending`. However, the `MachineSuccess` class definition (model §1.3) only declares `invalidate()` and `reset()` — no `start()` method. The architecture state diagram (§5) also omits this transition. Either `start(args)` should be added to the `MachineSuccess` class definition and state diagram, or the transition table row and test M5 should be removed. This is a pre-existing inconsistency (present before Redraft Round 1), not a regression.
   - Where: `03-model.md` §1.3 (class definition) vs. §4.2 (transition table row 6); `01-architecture.md` §5 (state diagram); `06-testcases.md` test M5
   - Expected: All four locations agree on whether `MachineSuccess` has a `start(args)` transition
   - Severity: Low
   - Source: Re-review (Phase 7)

## Next Steps

Proceeds to Plan stage after human review.
