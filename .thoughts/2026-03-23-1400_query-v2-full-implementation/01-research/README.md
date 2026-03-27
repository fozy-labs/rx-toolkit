---
title: "Research: Full implementation of query-v2 module"
date: 2026-03-23
status: Approved
feature: "Full implementation of query-v2 module with tests, replacing the current hacky attempt with a precise implementation matching v0.1 docs"
---

## Note

> **Rename**: The directory `src/query-v2/` has been renamed to `src/query-v2-legacy/` to reduce confusion with the new query-v2 module being designed. All references to `src/query-v2/` in the research documents should be understood as referring to `src/query-v2-legacy/`.

## Summary

Research covered four areas: the existing query-v2 implementation and its v0.1 documentation, the mature query v1 module as a reference architecture, external best practices from five major query/cache libraries (TanStack Query, RTK Query, SWR, Apollo Client, Relay), and a synthesis of open questions and trade-offs. The current v2 codebase is structurally complete in machine states, caching, API factory, plugins, snapshots, and React hooks — but contains pervasive type inconsistencies (`TError` undeclared as generic, `state$` vs `machine$()` naming mismatch, ~30+ `as unknown as` casts), several critical behavioral bugs (SWR previous data immediately cleared, `CacheEntry.complete()` not aborting patches), and multiple documented features that remain unimplemented (resource-level status signals, consistency violation detection, Commands). The v1 module provides a proven reference for patterns like controllable-promise testing, link-based Command invalidation, and reference-counted cache lifetime. External research confirms that v2's architectural direction (document cache, SWR, Immer-based optimistic updates, plugin system) aligns with industry standards, while highlighting a GC strategy gap (timer-only vs the universal refcount+timer hybrid).

## Documents

| # | Document | Description |
|---|----------|-------------|
| 1 | [Codebase Analysis — query-v2](./01-codebase-query-v2.md) | Full analysis of `src/query-v2/`, v0.1 docs, signals system, common utilities. Covers module structure, machine states, cache layer, agent, snapshot, plugins, React hooks, type system, test coverage, and gaps vs documentation. |
| 2 | [Codebase Analysis — query v1](./02-codebase-query-v1.md) | Reference analysis of `src/query/`. Covers Resource, Command, ResourceDuplicator, QueriesCache, QueriesLifetimeHooks, ResetAllQueriesSignal, React hooks, testing patterns, and type system. |
| 3 | [External Research](./03-external-research.md) | Comparative analysis of TanStack Query, RTK Query, SWR, Apollo Client, and Relay. Covers cache architecture, invalidation, optimistic updates, GC, plugin/middleware patterns, and pitfalls. |
| 4 | [Open Questions](./04-open-questions.md) | 19 actionable questions organized by priority (9 High, 8 Medium, 2 Low). Covers TError generics, SWR semantics, Command scope, CacheEntry API, GC strategy, plugin types, testing approach, and more. |

## Key Findings

1. **Type system is broken at the core**: `ResourceV2` class declares `<TArgs, TData>` but uses `TError` in `_refreshErrorListeners` — a compile-time error that propagates through Agent, API, and plugin types. ~30+ `as unknown as` casts throughout `ResourceV2.ts` indicate the types don't compose cleanly. (Source: 01 §5.5, §16.3)

2. **SWR behavior is defeated by immediate previous-clearing**: `ResourceV2Agent.start()` sets `previous` then immediately clears it, so stale data is never shown during loading. V1's `ResourceAgent` keeps `previous$` alive until `current` resolves — a proven pattern all five external libraries implement. (Source: 01 §6.3, 02 §2.2, 03 §2.2)

3. **Optimistic patching lacks consistency violation detection**: Patcher calls `applyPatches` from Immer without try/catch. V0.1 docs specify that `applyPatches` failure during abort should trigger auto-invalidation. Without this, stale patched data can persist indefinitely — silent data corruption. (Source: 01 §16.1, 04 Q6)

4. **Command/mutation support is absent in v2**: V1's Command system (~30% of codebase) includes link-based invalidation, optimistic updates, and lock mechanisms. V2 has zero Command infrastructure. The scope decision (Q3) is the single largest factor in implementation effort. (Source: 01 §16.1, 02 §2.5, 04 Q3)

5. **GC strategy gap**: V2 uses timer-only GC (`cacheLifetime` + `setTimeout`). All five external libraries use refcount + timer (GC timer starts only when subscriber count reaches 0). Timer-only can delete data while a component is still mounted. (Source: 01 §5.3, 03 §2.5, 04 Q11)

6. **Several documented features are not implemented**: Resource-level `_status$`/`_lastEntry$` signals (needed for `entry$` to react to `resetAll()`), `IResourceV2CacheEntry` rich entry interface, `refreshError` on agent state, TypeScript overloads for void-args and non-nullable `getEntry`. (Source: 01 §16.1)

7. **V1 provides transferable testing patterns**: Controllable-promise pattern (externally resolvable promises), `flushMicrotasks()` for async chains, `cacheLifetime: false` to eliminate TTL interference, `devtoolsName: false` to disable DevTools hooks. These are well-tested and directly portable. (Source: 02 §6.3)

## Contradictions and Gaps

1. **Line number discrepancy in 01**: §6.3 references `ResourceV2Agent.ts:115–121` for the SWR previous-clearing bug, but the actual clearing logic is at ~lines 131–136. The described behavior is accurate; only the line range is slightly off.

2. **`machine$()` vs `state$` — consistent documentation of inconsistency**: Both 01 and 04 (Q4) correctly identify that tests and Agent code call `machine$()` while `CacheEntry` exposes `state$` getter. Verified in code: `CacheEntry.test.ts:26` expects `machine$()`, `CacheEntry.ts:31` implements `state$`. No contradiction between documents — both consistently report the same mismatch.

3. **Missing coverage: DevTools integration depth**: 01 mentions DevTools hooks exist (`beforeDevtoolsPush`, `keyParts`) but does not deeply analyze how v2's machine-state-based DevTools differ from v1's lifecycle-hook-based DevTools. 04 Q19 acknowledges this but defers it to Low priority. No coverage gap for the core task, but notable for completeness.

4. **No contradictions between external research and codebase findings**: 03's findings about SWR patterns, optimistic update approaches, GC strategies, and plugin architectures are all consistent with what 01 and 02 document about the v1/v2 codebases.

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | All phases produced output files | PASS | All 4 phase outputs present: 01-codebase-query-v2.md, 02-codebase-query-v1.md, 03-external-research.md, 04-open-questions.md |
| 2 | Codebase analysis has exact file:line references | PASS | Extensive references in both 01 and 02 (e.g., `@/query-v2/core/resource/ResourceV2.ts:69`, `@/src/query/core/Resource/Resource.ts:21-36`). Verified key references match actual code. One minor line range inaccuracy in 01 §6.3 (115–121 should be ~131–136). |
| 3 | External research has source + confidence annotations | PASS | Every section in 03 annotated with High/Medium/Low confidence. § 5.1 properly marked Low (community opinions). § 8 provides full source URLs. |
| 4 | Open questions are actionable (context, options, risks) | PASS | All 19 questions have Context, Options (with pros/cons), Risks, and Researcher recommendation. Prioritized by section grouping (High/Medium/Low). |
| 5 | No solutions or design proposals in research | PASS | 01 and 02 are facts-only. Minor prescriptive language in 01 §16.3 table ("Should wait for current to resolve") is documenting expected behavior from tests/docs, not proposing a solution. 04's "Researcher recommendation" fields are evidence-based leanings — acceptable per review guidelines. |
| 6 | YAML frontmatter present on all files | PASS | All 4 files have correct frontmatter with title, date, stage, and role fields. |
| 7 | Cross-references consistent between documents | PASS | 01's gap analysis aligns with 04's open questions. 01's ADR-2 (Refreshing + error → stale data preserved) confirmed by 03's SWR data+error coexistence pattern. No contradictions found between any pair of documents. |
| 8 | Mermaid diagrams present for state machines and architecture | PASS | 01: machine class hierarchy diagram, state machine transitions diagram, signals architecture diagram. 02: module layering diagram, type hierarchy diagram. |
| 9 | Coverage: all areas from TASK.md investigated | PASS | TASK.md specifies "fully, without simplifications, with tests." All areas covered: existing v2 code, v0.1 docs, v1 reference, external practices, testing patterns, gap analysis. |
| 10 | Code paths referenced actually exist in codebase | PASS | Spot-checked: `TError` usage at ResourceV2.ts:66 ✓, `state$` getter at CacheEntry.ts:31 ✓, `machine$` in CacheEntry.test.ts:26 ✓, previous clearing in ResourceV2Agent.ts ✓, no `refreshError` in agent.types.ts ✓, Patcher's unguarded applyPatches ✓ |

### Issues Found

No critical issues found. Two minor observations:

1. **Low severity** — 01 §6.3 references `ResourceV2Agent.ts:115–121` but actual clearing logic is at ~131–136. The behavior description is accurate; only the specific line range drifts by ~15 lines.
2. **Low severity** — 01 §16.3 uses mildly prescriptive language ("Should wait for current to resolve") in the Code Issues table. This is documenting what tests expect, not proposing a solution, so it's acceptable.

## Next Steps

Proceeds to Design stage after human review. Key decisions the design stage must resolve:

1. **Scope**: Whether to include Command/mutation support (Q3) — this is the single largest scope driver.
2. **Type architecture**: How `TError` flows through the generic hierarchy (Q1, Q7) — must be resolved before any implementation.
3. **SWR semantics**: The previous/current swap logic (Q2) — core UX-affecting behavior.
4. **CacheEntry abstraction boundary**: Internal reactive container vs consumer-facing handle (Q4, Q5).
5. **GC strategy**: Timer-only vs refcount+timer hybrid (Q11) — impacts Agent lifecycle design.
6. **Patcher safety**: Consistency violation detection mechanism (Q6) — data integrity concern.
