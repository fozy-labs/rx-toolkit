---
title: "Short Design: Query-v2 Bugfixes and Docs"
date: 2026-03-29
stage: 02-design
role: rdpi-architect
---

## Direction

The design addresses five confirmed structural bugs in the `query-v2` module, one enhancement (`lastError` on `MachineSuccess`), and documentation/example gaps. All five bugs have isolated root locations with minimal cross-dependencies, enabling surgical fixes that preserve the existing architecture. The guiding principle is **minimal blast radius**: each fix targets the exact root location identified in research, avoids refactoring surrounding code, and aligns with industry-standard semantics confirmed by external research (RTK Query, TanStack Query, SWR, Apollo Client). [ref: ../01-research/README.md#Key Findings]

Bugs #1 and #2 share overlapping code in `ResourceV2CacheEntry` (constructor and `_doFetch`) and will be designed as complementary changes to the same component. Bugs #3, #4, #5 are isolated in `ResourceV2Agent`, `Patcher`, and `LifecycleHooks` respectively — each is a self-contained fix. The `lastError` enhancement extends `MachineSuccess` to carry an optional error field for same-args refetch failures, matching the error-transparency principle established by all major query libraries. [ref: ../01-research/02-external-research.md#3. SWR Error State Management]

Documentation follows an incremental-fix-plus-targeted-additions strategy: correct 3 factual errors, add focused guides for error handling and lifecycle hooks, and build 4–5 minimal interactive examples that double as visual regression tests for the fixed behaviors. [ref: ../01-research/01-codebase-analysis.md#Documentation Structure]

## Key Decisions

- **D1**: Wire `fireQueryStarted`/`resolveQueryFulfilled` into `_doFetch` rather than removing the hook — fulfils the documented API contract. [ref: Q1, ../01-research/05-open-questions.md#Q1]
- **D2**: Error-transparent SWR — derive `isError` from `currentMachine.status` before override, use `currentMachine.status` for `previous$` clearing. [ref: Q2, ../01-research/05-open-questions.md#Q2]
- **D3**: Add `initialMachine` constructor option to `ResourceV2CacheEntry` to skip `_doFetch` on snapshot hydration. [ref: Q3, ../01-research/05-open-questions.md#Q3]
- **D4**: Fix `Patcher.resolvePatches` catch return to include `isConsistencyViolation: true` in `patchState`. [ref: Q4, ../01-research/05-open-questions.md#Q4]
- **D5**: Reject pending `$cacheDataLoaded` in `fireCacheEntryRemoved` before deleting the resolver entry — covers both `resetCache` and GC paths. [ref: Q5+Q12, ../01-research/05-open-questions.md#Q5]
- **D6**: Add optional `lastError` field to `MachineSuccess` for same-args refetch error visibility. [ref: Q10, ../01-research/05-open-questions.md#Q10]
- **D7**: Regression tests mandatory for each bug fix; existing test E07 must be updated to assert zero `queryFn` calls on fresh hydration. [ref: Q11, ../01-research/05-open-questions.md#Q11]

## Scope Boundaries

### In Scope
- 5 bug fixes in `core/` (ResourceV2CacheEntry, ResourceV2Agent, Patcher, LifecycleHooks)
- `MachineSuccess.lastError` enhancement in `core/machines/`
- `_entryFactory` update to pass `initialMachine` during hydration
- Regression tests for all 5 bugs + `lastError`
- Fix 3 doc errors (MachineIdle, devtools, onQueryStarted)
- 2–3 targeted doc additions (error handling, lifecycle hooks)
- 4–5 minimal interactive examples (basic query, error/SWR states, SKIP token, snapshot hydration)

### Out of Scope
- Structural doc rewrite (TanStack-style reorganization)
- v1→v2 migration guide (deferred per Q8)
- `MachineRefreshing.errorHappened()` refactoring (machine-level SWR is preserved; `lastError` is additive)
- New API exports or breaking changes to public API surface
- Performance optimization of `_doFetch` lifecycle
- DevTools integration fixes (devtools.md references non-existent options — noted but not fixed in this scope)

## Research References

- [Research Summary](../01-research/README.md) — All 5 bugs confirmed structural with exact root locations; industry consensus on SWR error handling
- [Codebase Analysis §5](../01-research/01-codebase-analysis.md#5. ResourceV2CacheEntry) — Constructor auto-fetch, `_doFetch` lifecycle, missing `fireQueryStarted` calls
- [External Research §3](../01-research/02-external-research.md#3. SWR Error State Management) — Unanimous industry pattern: `isError: true` alongside stale data on refetch failure
- [Problem Analysis Bugs #1–#3](../01-research/03-problem-analysis-part1.md) — Failure paths for snapshot fetch bypass, dead lifecycle hook, SWR error masking
- [Open Questions](../01-research/05-open-questions.md) — Q1–Q12 resolutions informing all design decisions
