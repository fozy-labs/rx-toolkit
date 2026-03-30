---
title: "Research: query-v2 CompareCacheMap, devtools key extraction, lifecycle hooks, and demo fixes"
date: 2026-03-29
status: Approved
feature: "Fix CompareCacheMap data structure and caching, devtools key extraction for comparison/serialization strategies, move LifecycleHooks to ResourceEntry, fix demo isError examples"
astp-version: 1.1.0
---

## Summary

Research covered all six problems from TASK.md. The codebase analysis traced five areas: CacheMap internals (two strategies with fundamentally different data structures), devtools key derivation (a unified factory closure that unconditionally serializes args), LifecycleHooks ownership (resource-level singleton shared across all entries), demo `isError` behavior (never `true` in any example), and existing test coverage (significant gaps in all problem areas). Three problem-analysis documents provided detailed expected-vs-actual evidence, failure paths, and test gap inventories for each problem pair.

The most critical structural finding is that problems #1–#4 are interconnected through the `ResourceV2` constructor's factory closure and the `createCacheMap` call. The factory signature `(args) => TEntry` is the bottleneck — it doesn't pass the cache key to the entry, forcing a redundant serialization for devtools (problem #4) and requiring serialization even for comparison strategy (problem #3). Solving these together via a factory signature change `(args, argsKey) => TEntry` is a natural approach, but it touches the `TCacheMapFactory` type which is part of the public type surface. Problem #5 (LifecycleHooks ownership) is independent but equally structural — the shared `Map<TArgs, Resolvers>` with `===` identity means concurrent entries can interfere silently, and `fireQueryStarted` overwrites prior unresolved promises. Problem #6 (demo `isError`) is the simplest: SWR semantics mean errors during refreshing produce `MachineSuccess` with `lastError`, not `MachineError`, so `isError` stays `false` whenever the first fetch succeeds.

Open questions identified nine design decisions. The highest-priority ones (Q1–Q4) are tightly coupled: the data structure choice for `CompareCacheMap` determines whether caching is always-on or opt-in, which in turn affects how devtools keys are derived and how the factory signature changes. The design stage should resolve Q1 first, as Q2, Q3, and Q6 all depend on it.

## Documents

- [Codebase Analysis](./01-codebase-analysis.md) — traces CacheMap internals, devtools key flow, LifecycleHooks ownership chain, demo `isError` behavior, and test coverage across five areas.
- [Problem Analysis: Cache](./02-problem-analysis-cache.md) — evidence for problems #1 (Array-based O(n) lookup) and #2 (`doCacheArgs` silently ignored by CompareCacheMap).
- [Problem Analysis: Devtools](./03-problem-analysis-devtools.md) — evidence for problems #3 (serialization used for devtools key in compare strategy) and #4 (double serialization in serialize strategy).
- [Problem Analysis: Lifecycle & Demos](./04-problem-analysis-lifecycle-demos.md) — evidence for problems #5 (LifecycleHooks shared at resource level) and #6 (`isError` always `false` in all 8 demos).
- [Open Questions](./05-open-questions.md) — 9 design decisions (Q1–Q9) with context, options, risks, and researcher recommendations.

## Key Findings

1. **`CompareCacheMap` uses `Array.find`/`findIndex` for every lookup — O(n) per access, O(n²) for deletion** — with typical cache sizes of 10–100 entries in list/table UIs, each React render performs up to n comparisons per hook instance (01-codebase-analysis, 02-problem-analysis-cache).
2. **`doCacheArgs: true` is silently ignored when `keyStrategy === "compare"`** — the option is passed through `ResourceV2` to `createCacheMap`, but `CompareCacheMap` constructor never reads it, providing no user feedback (02-problem-analysis-cache).
3. **All devtools keys flow through a single factory closure `serializeFn(args)` in `ResourceV2` constructor** — this causes serialization for compare strategy (problem #3, semantic mismatch for non-serializable args) and double serialization for serialize strategy (problem #4, `SerializeCacheMap._getKey()` + factory closure) (01-codebase-analysis, 03-problem-analysis-devtools).
4. **`LifecycleHooks` uses `Map<TArgs, Resolvers>` with `===` identity** — `fireQueryStarted` silently overwrites unresolved `$queryFulfilled` promises for the same args reference, leaking pending promises; `void`-args resources collapse all operations to a single Map key (04-problem-analysis-lifecycle-demos).
5. **`isError` is `true` only when `originalStatus === "error"` which requires `MachineError` from `MachinePending`** — once an entry succeeds, all subsequent errors during `refreshing` produce `MachineSuccess` with `lastError` (SWR semantics), keeping `isError: false` (04-problem-analysis-lifecycle-demos).
6. **None of the 8 query-v2 demo examples can reliably produce `isError: true`** — `error-swr-states.tsx` succeeds on first fetch (fetchCount=1), so all errors hit the SWR path; `lifecycle-hooks.tsx` has an unreliable path via `resetAll` + specific queryCount (04-problem-analysis-lifecycle-demos).
7. **Test coverage gaps span all 6 problems** — no tests for: CompareCacheMap O(n) behavior or `doCacheArgs` handling, devtools key format or serialization call counting, LifecycleHooks with multiple concurrent entries, or demo `isError` state reachability (01-codebase-analysis, all problem analyses).

## Contradictions and Gaps

1. ~~**Line number discrepancy for `serializeFn` definition**~~ — **Resolved (Redraft Round 1)**. Both documents now consistently cite `ResourceV2.ts:47` for `serializeFn` and line 51 for the factory closure, matching the actual source.
2. **No runtime performance data**: Problem analysis #1 assesses O(n) degradation theoretically (cache size × hooks × renders) but no benchmarks were executed. The actual performance impact depends on application usage patterns that aren't documented.
3. ~~**Plugin interaction with LifecycleHooks unverified**~~ — **Resolved (Redraft Round 1)**. Codebase analysis §Area C now includes a full plugin directory audit, and problem analysis #5 Scope Boundaries reflects the audit results with a cross-reference.
4. **`entries()` return type impact underexplored**: If `CompareCacheMap`'s internal data structure changes (Q1), the `entries()` iterator behavior may change. The codebase analysis documents the current union return type `[string | TArgs, TEntry]`, and Q9 raises this, but no analysis traces downstream consumers (e.g., `Snapshot.getSnapshot()`).

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | All phases produced output files | PASS | 5 output files present: 01-codebase-analysis.md, 02-problem-analysis-cache.md, 03-problem-analysis-devtools.md, 04-problem-analysis-lifecycle-demos.md, 05-open-questions.md. All match PHASES.md. |
| 2 | Codebase analysis has exact file:line references | PASS | All 5 areas have file paths with line numbers. Code References section at the end provides a consolidated index. |
| 3 | External research has source + confidence annotations | N/A | No external research phase — PHASES.md does not include one. All 6 problems are internal codebase issues requiring no external API/library research. |
| 4 | Problem analysis is evidence-based and test-aware | PASS | All 3 problem analysis documents have: expected vs actual sections, reproduction status, failure paths with exact code traces, and test evidence sections listing relevant tests + coverage gaps. |
| 5 | Open questions are actionable (context, options, risks) | PASS | All 9 questions have context paragraph, numbered options with pros/cons, risks section, and researcher recommendation. |
| 6 | No solutions or design proposals in research | PASS | Problem analyses stay evidence-only. Devtools analysis §"Type System Locations Requiring Changes" identifies where types would need updating (factual tracing, not a design proposal). Open questions' "Researcher recommendation" sections provide evidence-based leanings — acceptable per rules. |
| 7 | YAML frontmatter present on all files | PASS | All 5 output files have YAML frontmatter with title, date, stage, and role fields. |
| 8 | Cross-references consistent between documents | PASS | All structural claims are consistent across documents. `serializeFn`/factory line references now match between codebase analysis and devtools problem analysis (both: line 47, line 51) and agree with the actual source. Plugin audit cross-references are consistent between §Area C and problem analysis #5 Scope Boundaries. No contradictions. |

### Issues Found

1. ~~**Line reference offset**~~ — **Resolved (Redraft Round 1)**. Both documents now cite line 47 (`serializeFn`) and line 51 (factory closure), matching the actual source.
2. ~~**Plugin directory not audited**~~ — **Resolved (Redraft Round 1)**. Codebase analysis §Area C now contains a full plugin audit subsection; problem analysis #5 Scope Boundaries references the audit.

No remaining issues.

## Next Steps

Proceeds to Design stage after human review. The design stage should address:
- Q1 first (CompareCacheMap data structure), as Q2, Q3, and Q6 depend on it.
- Q3 and Q6 together (devtools key derivation via factory signature change).
- Q4 (LifecycleHooks ownership) independently.
- Q8 (demo `isError` fixes) as a straightforward low-risk change.
- Q7 (plugin audit) as a prerequisite before finalizing the LifecycleHooks design.
