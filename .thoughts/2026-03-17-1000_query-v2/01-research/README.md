---
title: "Research: Query v2 Module"
date: 2026-03-17
status: Approved
feature: "New query-v2 module with createApi, ResourceV2, agents, caching, patches, machines, snapshots, plugins, SSR support"
rdpi-version: b0.2
---

## Summary

Research covered four areas: the existing query v1 module architecture, the signals and common infrastructure that v2 will build upon, external patterns from major data-fetching libraries (RTK Query, TanStack Query, XState), and open questions synthesized from the first three phases. Query v1 was fully documented — its flat boolean-flag state model, ReactiveCache/IndirectMap caching layer, ResourceAgent stale-while-revalidate pattern, and Command link/patch system. The signals layer (State, Computed, Effect with Batcher-based glitch-free execution and devtools integration) is confirmed as a solid foundation for v2's reactive caching.

External research validated the RFC's key design decisions: `createApi` grouping (analogous to RTK Query but more modular), agent/observer pattern (analogous to TanStack Query's QueryObserver), class-based state machines for compile-time transition safety, and explicit snapshot versioning for SSR (more robust than any existing library). The most challenging open areas are the plugin type system (risk of TS2589 with deep generics), machine serialization for SSR/devtools, the undefined `Patcher` API, and the ambiguous scope of commands/operations in v2.

Critical decisions for the design stage: plugin type strategy selection (Q1), machine serialization approach (Q2), Patcher API definition (Q3), v1/v2 coexistence boundaries (Q4), and MachineRefreshing transition semantics (Q5).

## Documents

- [Codebase Analysis — Query v1 Module](./01-codebase-query-v1.md) — Full documentation of v1 public API, core internals (Resource, Command, Agent, Ref, Duplicator), caching layer (ReactiveCache, IndirectMap, QueriesCache), lifecycle hooks, types, tests, and data flow.
- [Codebase Analysis — Signals & Common Infrastructure](./02-codebase-signals-common.md) — Signal primitives (State, Computed, Effect), base layer (Batcher, DependencyTracker, ComputeCache), devtools bridge (Redux DevTools integration with batch strategies), common utilities (shallowEqual, deepEqual, PromiseResolver), SharedOptions/DefaultOptions, React hooks (useSignal, useConstant, useEventHandler).
- [External Research](./03-external-research.md) — Comparative analysis of RTK Query, TanStack Query, XState; cache key serialization strategies; SSR hydration/dehydration patterns; plugin system approaches in TypeScript; state machine patterns for data fetching; established practices, opinions, pitfalls, and performance data.
- [Open Questions](./04-open-questions.md) — 17 prioritized questions (6 High, 6 Medium, 5 Low) covering plugin type system, machine serialization, Patcher API, v1/v2 coexistence, MachineRefreshing semantics, NO_VALUE implementation, key strategy scope, lifecycle hook integration, ResourceDuplicator scope, doCacheArgs mechanism, devtools integration, hanging patch fix, commands scope, entry/query distinction, select transform, staleTime, and snapshot versioning.

## Key Findings

1. **Query v1 uses a flat boolean-flag state model** with 14+ flags (`isLoading`, `isDone`, `isSuccess`, `isError`, `isReloading`, `isLocked`, `isInitiated`, etc.) that the RFC replaces with class-based state machines enforcing valid transitions at compile time. ([01-codebase-query-v1.md](./01-codebase-query-v1.md), Section 2.1)

2. **The signals system provides all primitives needed for v2's reactive caching** — `State` for mutable cache entries, `Computed` for derived state (agent's stale-while-revalidate), `Effect` for subscriptions, `Batcher` for glitch-free atomic updates, and `signalize()` to bridge RxJS observables into the signal graph. ([02-codebase-signals-common.md](./02-codebase-signals-common.md), Sections 1–6)

3. **Devtools integration has an established pattern** via `Devtools.createState()` and `beforeDevtoolsPush` that v2 can reuse directly, but machine class instances must be projected to plain `.state` objects before pushing — Redux DevTools expects JSON-serializable data. ([02-codebase-signals-common.md](./02-codebase-signals-common.md), Section 3; [04-open-questions.md](./04-open-questions.md), Q11)

4. **No major library offers both `serialize` and `compare` key strategies** — the RFC's dual approach is unique. RTK Query and TanStack Query both serialize-only. The `compare` strategy (v1's IndirectMap with O(n) lookup) has a practical ceiling around 50–100 entries before serialized keys outperform it. ([03-external-research.md](./03-external-research.md), Section 5.2; Performance section)

5. **The plugin type system is the highest-risk design area** — three viable TypeScript approaches exist (declaration merging, generic accumulation, plugin interface with augment), but all have significant trade-offs. Generic accumulation (tRPC-style) best fits the RFC's scoping requirements but risks TS2589 at >2–3 plugins with deep generics. ([03-external-research.md](./03-external-research.md), Section 4; [04-open-questions.md](./04-open-questions.md), Q1)

6. **The RFC's SSR snapshot approach is more explicit and robust than any existing library** — explicit version field, `keyPrefix` namespacing, and `maxSnapshotDataAge` exceed what TanStack Query (`dehydrate`/`hydrate` without versioning) or RTK Query (`extractRehydrationInfo` coupled to Redux) offer. Key challenge: class-based machines break `instanceof` after deserialization and need a factory/registry for rehydration. ([03-external-research.md](./03-external-research.md), Section 6; [04-open-questions.md](./04-open-questions.md), Q2)

7. **The v1 patch system has a known "hanging patch" bug** where pending transactions that are never committed or aborted block cleanup of `originalData` indefinitely. The RFC explicitly calls this out. The fix requires binding patch lifecycle to machine transitions and/or request abort signals. ([01-codebase-query-v1.md](./01-codebase-query-v1.md), Section 2.3; [04-open-questions.md](./04-open-questions.md), Q12)

## Contradictions and Gaps

1. **MachineRefreshing not fully specified** — The RFC mentions `MachineRefreshing` (via `MachineSuccess.invalidate()`) but provides no implementation, transition list, or error-handling semantics. Open question Q5 covers this but the design stage must define: what happens on error during refresh (return to stale data vs. MachineError), and how patches interact with refreshing state.

2. **Patcher API undefined** — The RFC references `Patcher.resolvePatches()`, `Patcher.finishPatch()`, and `Patcher.createPatch()` without defining `Patcher` as a class or module. The v1 inline implementation (ResourceRef lines 42–131) is the only concrete reference. Open question Q3 recommends a static utility class + shared base class for MachineSuccess/MachineRefreshing.

3. **Commands/operations scope ambiguous** — The RFC says "в дальнейшем и операций" which is ambiguous between "later in this document" and "in the future". TASK.md does not mention commands. Open question Q13 recommends resources-only for MVP but designing `createApi` to accommodate future `createCommand`. The `link` mechanism (v1 Command → Resource optimistic updates) cannot work cross-version without breaking isolation.

4. **`entry` vs `query` distinction unclear** — RFC lists both `entry(args, doInitiate)` and `query(args, doForce)` but doesn't specify what `entry` returns or how it differs from `query` beyond the `doInitiate` flag. Open question Q14 infers `entry` returns `ICacheEntry` (the reactive cache unit holding a Machine).

5. **`select` transform not mentioned in RFC** — v1 supports `select` (Result → Selected transform with `FallbackOnNever`), but RFC omits it. Open question Q15 notes this. If out of scope, the `Selected` generic parameter from v1 types can be dropped, simplifying the type system.

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | All phases produced output files | PASS | All 4 phase outputs present: 01-codebase-query-v1.md, 02-codebase-signals-common.md, 03-external-research.md, 04-open-questions.md |
| 2 | Codebase analysis has exact file:line references | PASS | Both codebase analyses use `@/path/file.ts:line-line` format consistently with specific line ranges. Code References sections at the end of each document list all referenced locations. |
| 3 | External research has source + confidence annotations | PASS | Every section in 03-external-research.md ends with a Confidence level (High/Medium/Low). Sources section at the end lists all URLs. Opinions section explicitly labeled with confidence levels. |
| 4 | Open questions are actionable (context, options, risks) | PASS | All 17 questions in 04-open-questions.md have Context, Options (numbered with pros/cons), Risks, and Researcher recommendation. Questions organized by priority (High/Medium/Low). |
| 5 | No solutions or design proposals in research | PASS | Codebase analyses are pure facts. External research presents comparisons and relevance notes without prescribing solutions. Open questions' "Researcher recommendation" sections provide evidence-based leanings, which is acceptable per workflow rules. |
| 6 | YAML frontmatter present on all files | PASS | All 4 output files have YAML frontmatter with title, date, stage, and role fields. |
| 7 | Cross-references consistent between documents | PASS | Verified: Q1→external research §4, Q2→external research §3.3, Q3→codebase analysis 01 ResourceRef:42-131, Q7→external research Performance, Q11→codebase analysis 02 Devtools.ts:35-37, Q12→codebase analysis 01 ResourceRef:42-131. All references resolve correctly, no contradictions found. |

### Issues Found

No issues found.

## Next Steps

Proceeds to Design stage after human review. The design stage should prioritize:

1. **Machine state hierarchy** — Define all machine classes (Idle, Pending, Success, Error, Refreshing), their transitions, and the shared base class for patch-capable machines (Q3, Q5).
2. **Plugin type system prototype** — Build a minimal prototype with `ReactHooksPlugin` to validate the chosen type strategy against TS2589 limits (Q1).
3. **Cache abstraction** — Design the `CacheMap` interface supporting both `serialize` and `compare` strategies (Q7).
4. **v1/v2 isolation boundaries** — Define module structure, export paths, and SharedOptions scoping (Q4).
5. **SSR snapshot format** — Define `TApiSnapshot` schema, machine serialization/deserialization protocol, and `maxSnapshotDataAge` checking (Q2, Q17).
