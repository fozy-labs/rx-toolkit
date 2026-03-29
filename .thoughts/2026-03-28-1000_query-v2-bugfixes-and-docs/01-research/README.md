---
title: "Research: Query-v2 Bugfixes and Docs"
date: 2026-03-29
status: Approved
feature: "Fix 5 bugs in query-v2 (snapshot, lifecycle hooks, SWR error masking, Patcher commit, cache reset), update outdated docs, add interactive examples"
astp-version: 1.1.0
---

## Summary

Research investigated five bugs in the `query-v2` module, surveyed comparable query library patterns (RTK Query, TanStack Query, SWR, Apollo Client), and audited the documentation and demo state. Codebase analysis mapped ~25 source files across `api/`, `core/`, `lib/`, `react/`, `plugins/`, and `types/`, identifying the exact code paths responsible for each bug. External research established that all major libraries expose `isError: true` alongside stale data on refetch failure, reject pending promises on cache reset, and provide age-aware initial data semantics — confirming that all five reported behaviors are genuine bugs, not design choices.

All five bugs have clearly identified root locations with no ambiguity: (1) `ResourceV2CacheEntry` constructor unconditionally fires `_doFetch()`, causing wasted network requests on snapshot hydration; (2) `fireQueryStarted`/`resolveQueryFulfilled` are never called from production code despite being fully implemented, documented, and typed; (3) `ResourceV2Agent._deriveState$` overrides `status` to `"refreshing"` on error+previous, masking `isError` and preventing `previous$` cleanup; (4) `Patcher.resolvePatches` catch block sets `isConsistencyViolation` locally but never includes it in the return value; (5) `fireCacheEntryRemoved` deletes resolvers from `_entryResolvers` before `clearAll()` can reject `$cacheDataLoaded`.

Documentation audit revealed specific inaccuracies: `MachineIdle` referenced in API docs but doesn't exist, `devtools.md` references options absent from the type system, and `onQueryStarted` is documented as functional but never fires. The open questions document captures 12 decision points (5 high, 4 medium, 3 low priority) that must be resolved in the design stage, with researcher recommendations provided for each.

## Documents

- [Codebase Analysis](./01-codebase-analysis.md) — Architecture map of query-v2 module (~25 files), data flow, state machines, lifecycle hooks, test inventory, documentation audit
- [External Research](./02-external-research.md) — Comparative analysis of RTK Query, TanStack Query, SWR, Apollo Client across 6 topic areas with source citations and confidence levels
- [Problem Analysis: Bugs #1–#3](./03-problem-analysis-part1.md) — Detailed failure path analysis for snapshot fetch bypass, onQueryStarted dead code, and SWR error masking
- [Problem Analysis: Bugs #4–#5](./04-problem-analysis-part2.md) — Detailed failure path analysis for Patcher consistency violation loss and $cacheDataLoaded hang on resetCache
- [Open Questions](./05-open-questions.md) — 12 decision points (Q1–Q12) with context, options, risks, and researcher recommendations

## Key Findings

1. **All 5 bugs are confirmed structural issues with identified root locations** — none are configuration errors or misunderstandings. Each has an exact file:line root cause traced through the codebase analysis and validated in problem analysis documents.
2. **`onQueryStarted` is fully implemented dead code** — the hook is defined, typed, documented, and unit-tested in isolation, but zero production code calls `fireQueryStarted` or `resolveQueryFulfilled`. The `optimistic-updates.md` guide describes patterns that depend on this non-functional hook (01-codebase-analysis §9, 03-problem-analysis-part1 §Bug #2).
3. **The SWR error masking in `ResourceV2Agent` has a secondary bug**: overriding `status` before the `previous$`-clearing check means `previous$` is never cleared when the current entry errors with previous data present, causing the stale override to persist indefinitely (03-problem-analysis-part1 §Bug #3).
4. **Industry consensus on SWR error handling is unanimous**: all four surveyed libraries (RTK Query, TanStack Query, SWR, Apollo Client) expose `isError: true` alongside stale data when a refetch fails. No library masks errors when stale data exists (02-external-research §3).
5. **RTK Query's `cacheDataLoaded` rejection pattern is the canonical solution for Bug #5**: RTK Query explicitly rejects `cacheDataLoaded` with `Error("Promise never resolved before cacheEntryRemoved.")` when cache entries are removed before data loads (02-external-research §5).
6. **Bugs #1 and #2 share overlapping code in `ResourceV2CacheEntry`** and can be addressed together, while Bugs #3, #4, #5 are isolated in separate components with no cross-dependencies (05-open-questions §Q6).
7. **Documentation has 3 factual errors**: `MachineIdle` referenced but doesn't exist, `devtools.md` references non-existent options, and `onQueryStarted` documented as functional (01-codebase-analysis §Documentation Structure).

## Contradictions and Gaps

1. **Missing coverage**: No document explicitly verifies whether the existing test E07 in `edge-cases.test.ts` would need to be updated (not just that a new test is needed, but that the existing assertion `expect(queryFn).toHaveBeenCalledTimes(1)` documents the bug as expected behavior and must be changed).

2. **GC-triggered removal gap**: Bug #5 analysis notes GC-triggered entry removal follows the same `onClean$` → `fireCacheEntryRemoved` path and likely has the same hanging promise issue, but this was explicitly not analyzed. Q12 in open questions addresses this but only contingent on Q5's resolution.

3. **Minor line granularity difference within problem analysis part 2**: Bug #4 failure path references `_finishPatch` detection at "lines 243–248" while the Root Location section cites "L246–L248". Both refer to the same violation detection block (the `hasViolation` check through `invalidate()`) at different zoom levels — not a logical inconsistency.

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | All phases produced output files | PASS | 5 output files present matching PHASES.md (phases 1–5). Phase 3 output is `03-problem-analysis-part1.md` and phase 4 is `04-problem-analysis-part2.md`, matching the split problem analysis design. |
| 2 | Codebase analysis has exact file:line references | PASS | All 13 sections include `@/` paths with line ranges (e.g., `createApi.ts:23-149`, `ResourceV2CacheEntry.ts:47-57`). Code References section lists 30+ specific file:line entries. |
| 3 | External research has source + confidence annotations | PASS | Every factual claim annotated with source URL and confidence level (High/Medium/Low). 15+ source URLs cited. All comparative tables include Confidence column. |
| 4 | Problem analysis is evidence-based and test-aware | PASS | All 5 bugs include: expected vs actual behavior, reproduction status, numbered failure path with file:line references, root location, test evidence with specific test IDs (E07, AG16, LH05, PA10, INT09, INT13, etc.), and explicit gap statements for missing coverage. |
| 5 | Open questions are actionable (context, options, risks) | PASS | All 12 questions include Context, Options (2–3 per question), Risks, and Researcher recommendation. Options have explicit Pros/Cons. |
| 6 | No solutions or design proposals in research | PASS | Codebase analysis and problem analysis contain only facts and code traces. Open questions present options with trade-offs but do not prescribe solutions (researcher recommendations are leanings, not prescriptions). External research reports patterns from other libraries without proposing adoption. |
| 7 | YAML frontmatter present on all files | PASS | All 5 output files have YAML frontmatter with title, date, stage, and role fields. Dates are consistent (2026-03-28 for phases 1–2, 2026-03-29 for phases 3–5). |
| 8 | Cross-references consistent between documents | PASS | `_finishPatch` line references now consistent: codebase analysis §5 cites lines 230–252 (method) and 243–248 (detection), problem analysis part 2 cites lines 243–248 (detection heuristic). §9 `$cacheDataLoaded` narrative rewritten as coherent step-by-step trace. Minor granularity difference in problem analysis Root Location (L246–L248 vs 243–248) is zoom-level, not a contradiction. |

### Issues Found

No issues found.

## Next Steps

Proceeds to Design stage after human review.
