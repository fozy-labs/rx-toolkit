---
title: "Research: Query v2 Implementation Fixes"
date: 2026-03-18
status: Approved
feature: "7 targeted fixes/improvements to the query-v2 module: React hooks independence, folder restructuring, core split, devtools filtering, snapshot error handling, JSDoc, and optimistic update docs"
rdpi-version: b0.2
---

## Summary

The research stage mapped the current query-v2 module across all 7 fix areas. The codebase analysis reveals a plugin-based architecture where React hooks are tightly coupled to `ReactHooksPlugin` — the only plugin in the system — with no standalone export path. The core module has a flat structure ripe for splitting, devtools integration flows through `CacheEntry` signals rather than agents, and snapshot hydration silently discards mismatches without any error reporting. JSDoc coverage is comprehensive on type definitions (~100%) but nearly absent from implementation classes and the main `createApi` entry point.

Key design decisions ahead include whether React hooks become standalone functions (breaking change) or retain backward-compatible resource methods, whether the plugin system survives the decoupling, what error semantics `hydrateSnapshot` should adopt for different failure modes, and confirming whether task #4 (devtools agent state) requires any code change at all — since the analysis found agents already do not push to devtools.

## Documents

- [Codebase Analysis](./01-codebase-analysis.md) — Detailed source-level analysis of all 7 fix areas with file paths and line numbers
- [Open Questions](./02-open-questions.md) — 12 open questions covering technical constraints, API compatibility, scope, risks, and inter-fix dependencies

## Key Findings

1. **React hooks are plugin-locked**: `useResourceV2Agent` and `useResourceV2Ref` are only accessible as resource methods after `ReactHooksPlugin.augmentResource()` — they cannot be imported or used independently ([codebase analysis §1](./01-codebase-analysis.md)).
2. **Agent state is NOT sent to devtools**: `ResourceV2Agent` has zero devtools references; only `CacheEntry` machine state transitions are pushed via `beforeDevtoolsPush`. Task #4 may already be satisfied or is preventative ([codebase analysis §4](./01-codebase-analysis.md), [open questions Q5](./02-open-questions.md)).
3. **Snapshot hydration fails silently**: Version mismatch, key prefix mismatch, and unknown resource keys are all silently skipped. Only `Machine.fromSnapshot` on corrupt status throws — and that throw is uncaught by `hydrateSnapshot` ([codebase analysis §5](./01-codebase-analysis.md)).
4. **JSDoc gap in implementation classes**: Types have ~100% coverage, but `createApi()`, `ResourceV2`, `CacheEntry`, `ResourceV2Agent`, and all 7 machine classes lack class-level or method-level JSDoc. The most critical undocumented methods are `createAgent`, `query`, `query$`, and `entry` on `ResourceV2` ([codebase analysis §6](./01-codebase-analysis.md)).
5. **Snapshots capture optimistic data without warning**: During active patches, `getSnapshot()` serializes the optimistic `data` but excludes `originalData` and `patches`. None of the three doc files describe this behavior or its implications for hydration ([codebase analysis §7](./01-codebase-analysis.md)).
6. **Core split is straightforward**: `machines/` is already isolated; `CacheEntry`, `CacheMap`, `LifecycleHooks` map to `common/`, and `ResourceV2`, `ResourceV2Agent` map to `resource/`. The barrel re-export pattern means this can be an internal-only restructure with no public API change ([codebase analysis §3](./01-codebase-analysis.md), [open questions Q3](./02-open-questions.md)).
7. **Fixes #1 and #2 are tightly coupled**: Moving hooks to `react/` and making them plugin-independent are interrelated changes that also determine the plugin system's future. Implementation order matters ([open questions Q1, Q2, Q8](./02-open-questions.md)).

## Contradictions and Gaps

- **Task #4 vs. codebase reality**: The task states "DevTools must not receive agent state logs," but the analysis found agents already do NOT push to devtools. Either this is preventative, refers to a runtime behavior not visible in static analysis, or there is a misunderstanding in the task description. This needs clarification from the task author before design ([open questions Q5](./02-open-questions.md)).
- **Integration test coverage incomplete in analysis**: The codebase analysis catalogued unit tests but did not exhaustively map integration tests. Three integration test files exist (`plugin-augmentation.test.ts`, `query-flow.test.ts`, `ssr-hydration.test.ts`) and are relevant to fixes #1, #2, and #5 respectively ([open questions Q12](./02-open-questions.md)).

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | All phases produced output files | PASS | `01-codebase-analysis.md` and `02-open-questions.md` both present; external research phase was not defined in PHASES.md |
| 2 | Codebase analysis has exact file:line references | PASS | All 7 sections include `@/` paths with line numbers; spot-checked `hydrateSnapshot` (lines 68-70 version check), `core/index.ts` (6 lines), `ResourceV2Agent.ts` (no devtools refs) — all verified against source |
| 3 | External research has source + confidence annotations | N/A | No external research phase defined in PHASES.md — only Codebase Analysis and Open Questions |
| 4 | Open questions are actionable (context, options, risks) | PASS | All 12 questions have Context, Options (2-4 each), Risks, and Researcher recommendation |
| 5 | No solutions or design proposals in research | PASS | Codebase analysis §3 table includes a "Proposed Split" column that categorizes files — this is factual mapping, not prescriptive design. Open questions' "Researcher recommendation" fields provide evidence-based leanings, which are acceptable per review guidelines |
| 6 | YAML frontmatter present on all files | PASS | Both files have correct `title`, `date`, `stage`, `role` fields |
| 7 | Cross-references consistent between documents | PASS | Open questions Q1-Q8 all reference findings from matching codebase analysis sections without contradictions |

### Issues Found

No issues found.

## Next Steps

The design stage should prioritize:

1. **Resolve task #4 ambiguity first** — Confirm with the task author whether "DevTools must not receive agent state logs" requires a code change given agents already don't push to devtools. This determines if fix #4 is a no-op verification or requires defensive guards.
2. **Design hooks decoupling + folder move as a single unit** — Fixes #1 and #2 are interdependent and should be designed together, including the decision on standalone vs. resource-method API and the plugin system's fate (Q1, Q2, Q8).
3. **Define error semantics for snapshot hydration** — Choose between throwing, warning, or returning a result object for different failure modes in `hydrateSnapshot` (Q4). Consider that version mismatch is expected during upgrades.
4. **Scope JSDoc coverage** — Decide whether to target public API only or also core class internals (Q6). The analysis provides a complete inventory of undocumented locations.
5. **Core split and documentation fixes are low-risk** — Fixes #3, #6, and #7 are largely independent and can be designed in parallel with the higher-risk items above.
