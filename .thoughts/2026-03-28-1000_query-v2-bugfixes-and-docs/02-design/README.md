---
title: "Design: Query-v2 Bugfixes and Docs"
date: 2026-03-29
status: Approved
feature: "Fix 5 bugs in query-v2 (snapshot fetch bypass, onQueryStarted dead code, SWR error masking, Patcher consistency violation, $cacheDataLoaded hang), add lastError to MachineSuccess, update docs, add interactive examples"
research: "../01-research/README.md"
astp-version: "1.1.0"
---

## Overview

This design addresses five confirmed structural bugs in the `query-v2` module, one enhancement (`lastError` on `MachineSuccess`), and documentation/example gaps. Each fix targets an exact root location identified in research with minimal blast radius. All 12 open questions (Q1–Q12) are resolved with user answers informing every design decision.

## Goals

- Fix 5 bugs with surgical changes at identified root locations (ResourceV2CacheEntry, ResourceV2Agent, Patcher, LifecycleHooks)
- Add `lastError` field to `MachineSuccess` for same-args refetch error visibility
- Correct 3 factual documentation errors and add targeted guides (error handling, lifecycle hooks)
- Create 4–5 interactive examples covering basic query, error/SWR states, SKIP token, snapshot hydration

## Non-Goals

- Structural documentation rewrite (TanStack-style reorganization)
- v1→v2 migration guide (deferred per Q8 — brief note in README only)
- `MachineRefreshing.errorHappened()` refactoring (machine-level SWR preserved; `lastError` is additive)
- New API exports or breaking changes to public API surface
- Performance optimization of `_doFetch` lifecycle
- DevTools integration fixes (outdated options noted but not fixed)

## Documents

- [Short Design](./00-short-design.md)
- [Architecture](./01-architecture.md)
- [Data Flow](./02-dataflow.md)
- [Domain Model](./03-model.md)
- [Decisions](./04-decisions.md)
- [Use Cases](./05-usecases.md)
- [Test Cases](./06-testcases.md)
- [Documentation and Examples](./07-docs.md)
- [Risks](./08-risks.md)
- [Correction Log](./09-corrections.md)

## Key Decisions

- **ADR-1**: Lazy fetch with `initialMachine` constructor option for snapshot hydration — skip `_doFetch` when hydrating, eliminating wasted network requests (Q3).
- **ADR-2**: Wire `fireQueryStarted`/`resolveQueryFulfilled` into `_doFetch` — fulfills documented API contract for `onQueryStarted` lifecycle hook (Q1).
- **ADR-3**: Error-transparent SWR — derive `isError` from `currentMachine.status` before SWR override; clear `previous$` using original status. Matches all major query libraries (Q2).
- **ADR-5**: Reject pending `$cacheDataLoaded` in `fireCacheEntryRemoved` before deleting resolver — covers both `resetCache` and GC paths (Q5, Q12).
- **ADR-6**: Add optional `lastError?: unknown` to `MachineSuccess` — set by `errorHappened()`, cleared on next successful fetch. Additive, non-breaking (Q10).

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Design decisions trace to research findings | PASS | Every ADR (1–10) includes `[ref: ...]` links to research documents. `00-short-design.md` traces all key decisions to open questions and research sections. Architecture fix areas reference specific problem analysis sections. |
| 2 | ADRs have Status, Context, Options, Decision, Consequences | PASS | All 10 ADRs (ADR-1 through ADR-10) in `04-decisions.md` have all required sections. Each includes 2–3 options with pros/cons. |
| 3 | Mermaid diagrams present and conformant | FAIL | Architecture has 6 diagrams, dataflow has 12+, model has 6. All titled, ≤20 elements. However, three `02-dataflow.md` diagrams have potential parse errors: (a) state diagram "Machine States with lastError Extension" uses `<br/>` in stateDiagram-v2 transition labels and `✨` emoji — not supported by all Mermaid renderers; (b) promise settlement state diagram may hit parser issues with `()` in transition labels; (c) summary flowchart and other flowcharts use unescaped `$` in node/link labels (e.g., `state$`, `machine$()`, `_deriveState$`) which triggers KaTeX math mode in Mermaid, causing "unexpected PS token" errors. Recommend escaping `$` as `#36;` or restructuring labels. |
| 4 | Test strategy covers identified risks | PASS | R3 (SWR semantics change) covered by T13–T17. R5 ($cacheDataLoaded rejection) covered by T22–T25. R1 (lastError type broadening) covered by T26–T31 + type-level test. R8 (initialMachine misuse) mitigated by internal-only exposure — not a test target. |
| 5 | docs.md is concise and proportional to existing docs/demos | PASS | Existing docs: 4 files (`README.md`, `devtools.md`, `optimistic-updates.md`, `ssr.md`). Existing demos: 3 examples. `07-docs.md` proposes: fix 3 errors, add 2 sections to README (~½ page each), add 4–5 minimal examples. Proportional to a 4-file doc set and 3-example demo app. |
| 6 | docs.md describes WHAT not HOW (no JSDoc, no full drafts) | PASS | `07-docs.md` specifies what to fix (line numbers, specific references) and what to add (section topics, placement) without providing full text or JSDoc. Code examples in use cases are design-level illustrations, not doc drafts. |
| 7 | No implementation details or code | PASS | All TypeScript snippets are illustrative type definitions or API surface changes showing the delta from current state. No function body implementations beyond constructor-level behavior descriptions. Consistent with design-level detail for type-driven changes. |
| 8 | Research problem-analysis findings are addressed when present | PASS | Bug #1 (03-problem-analysis-part1) → ADR-1 + Fix Area 1. Bug #2 → ADR-2 + Fix Area 1. Bug #3 (both sub-issues) → ADR-3 + Fix Area 2. Bug #4 (04-problem-analysis-part2) → ADR-4 + Fix Area 3. Bug #5 → ADR-5 + Fix Area 4. All failure paths from research are addressed in architecture component boundaries and dataflow scenarios. |
| 9 | Research open questions addressed or deferred | PASS | Q1–Q12 all resolved: Q1 (wire onQueryStarted) → ADR-2. Q2 (SWR semantics) → ADR-3. Q3 (snapshot fix) → ADR-1. Q4 (Patcher catch) → ADR-4. Q5 (cacheDataLoaded) → ADR-5. Q6 (interconnections) → ADR-10. Q7 (doc scope) → ADR-7. Q8 (migration) → deferred per ADR-7. Q9 (examples) → ADR-8. Q10 (lastError) → ADR-6. Q11 (regression tests) → ADR-9. Q12 (GC removal) → auto-covered by Q5/ADR-5. |
| 10 | Risk analysis has actionable mitigations for high-impact risks | PASS | R3 (High impact: SWR semantics change) has 5-step mitigation plan including doc updates, migration guidance, integration test, demo example, and responsible party. R5 (High impact: $cacheDataLoaded rejection) has 5-step mitigation with mandatory try/catch pattern documentation, descriptive error message, integration tests, and visual example. |
| 11 | Internal consistency (arch/dataflow/model/usecases) | PASS | Architecture component boundaries align with dataflow sequence diagrams. Model type changes (`MachineSuccess.lastError`, `IResourceV2CacheEntryOptions.initialMachine`, `TResourceV2AgentState.lastError`) are consistent across all documents. Dataflow abort branch (no `resolveQueryFulfilled`) is consistent with architecture §5 (post-correction). Use case patterns match the state combinations defined in model §5. |
| 12 | `00-short-design.md` exists, within 1–2 pages, aligns with architecture | PASS | Present. Covers direction, key decisions (D1–D7), scope boundaries (in/out), and research references. ~60 lines — within 1–2 page limit. Direction and decisions align with architecture fix areas and ADRs. |
| 13 | Correction log entries (if any) are factual, not stylistic | PASS | Single entry: abort branch in architecture §5 sequence diagram incorrectly showed `resolveQueryFulfilled` being called for aborted fetches. This is a factual correction — the stale check causes early return, so no lifecycle settlement should occur. Not a style preference. |
| 14 | Corrected documents reflect logged corrections accurately | PASS | Architecture §5 abort branch shows "No state change, no resolveQueryFulfilled." Dataflow §2 introductory text now correctly says "on completion (success or error)" — matching the correction applied to architecture. Cross-document consistency verified. |

### Correction Log Review

`09-corrections.md` contains one entry:

**Entry 1** — Architecture §5 abort branch:
- **Original claim**: Aborted fetches call `resolveQueryFulfilled(args, { error: AbortError, meta: "rejected" })`.
- **Corrected state**: Aborted (stale) fetches return early after stale check — no `resolveQueryFulfilled` call, no state change.
- **Verification**: `01-architecture.md` §5 sequence diagram abort branch confirmed to show "No state change, no resolveQueryFulfilled" with explanatory note. ✓
- **Cross-document consistency**: `02-dataflow.md` §2 diagram independently shows the same abort behavior ("resolveQueryFulfilled NOT called for stale/aborted fetches"). `02-dataflow.md` §2 introductory text now correctly says "on completion (success or error)" — the previously reported "or abort" contradiction has been fixed (Phase 10). ✓
- **No new inconsistencies introduced**: Architecture, dataflow diagram, and dataflow prose all consistently state that aborted/stale fetches do not call `resolveQueryFulfilled` and the newer `_doFetch` owns the lifecycle. ✓
- **Rationale grounded**: Rationale cites dataflow §2 as the authoritative source, which is itself grounded in RTK Query behavior research (02-external-research §2). ✓

**Previously reported residual inconsistency**: The `02-dataflow.md` §2 introductory text previously said "success, error, or abort" — this has been corrected to "success or error" and now matches the diagram, the architecture, and the correction log. **Resolved.**

### Documentation Proportionality

**Existing documentation scale**: 4 files in `docs/query-v2/` (README.md, devtools.md, optimistic-updates.md, ssr.md). 3 interactive examples in `apps/demos/src/examples/query-v2/` (simple-resource, optimistic-patches, ssr-snapshot).

**Proposed changes in `07-docs.md`**:
- Fix 3 factual errors in existing files (MachineIdle, devtools options, onQueryStarted accuracy) — minimal, blocking corrections.
- Add 2 sections to README (~½ page each: error handling, lifecycle hooks) — proportional to a README that already covers machine states, API reference, and basic usage.
- Add 4–5 minimal interactive examples — roughly doubles the existing 3 examples, proportional to the scope of 5 bug fixes + 1 enhancement.
- 1–2 sentence migration note — minimal.

**Assessment**: Proportional. The documentation changes match the feature scope: 5 bug fixes and 1 enhancement warrant error corrections + 2 focused guide sections + visual examples. Not over-specified (no full doc rewrite, no JSDoc proposals) and not under-specified (addresses all factual errors and key new behaviors like `lastError` and SWR error transparency).

### Issues Found

1. ~~**`02-dataflow.md` §2 introductory text contradicts its own diagram on abort handling**~~ — **RESOLVED** (Phase 10). Text now correctly says "on completion (success or error)."

2. **`02-dataflow.md` — Multiple Mermaid flowcharts use unescaped `$` in node/link labels**
   - **What's wrong**: Mermaid flowcharts interpret `$` as KaTeX inline math delimiter. Labels like `CacheEntry.state$`, `machine$()`, `_deriveState$`, `agent.state$`, `previous$?.()` trigger math mode parsing, causing "unexpected PS token" or similar errors. Affected diagrams: "Signal Propagation — Hydrated Entry" (§1), "$queryFulfilled Promise Timing" (§2), "Signal Propagation — Error State" (§3), "Summary of Signal/Observable Propagation" (§5), and potentially others.
   - **Where**: `02-dataflow.md`, all flowchart diagrams containing `$` in node definitions or link labels.
   - **What's expected**: Escape `$` as `#36;` (Mermaid HTML entity) or restructure labels to avoid `$` (e.g., use `state signal` instead of `state$`).
   - **Severity**: Medium — diagrams are conceptually correct but fail to render in standard Mermaid parsers.

3. **`02-dataflow.md` — State diagram "Machine States with lastError Extension" uses `<br/>` in stateDiagram-v2 transition labels**
   - **What's wrong**: `<br/>` HTML breaks are supported in flowchart labels but may not be supported in stateDiagram-v2 transition labels (text after `:`). Also uses `✨` emoji which some Mermaid lexers reject.
   - **Where**: `02-dataflow.md`, §3B state diagram, transitions from `MachinePending`, `MachineRefreshing`.
   - **What's expected**: Replace `<br/>` with `\n` (if supported) or split into separate transitions. Remove or replace emoji with text marker.
   - **Severity**: Medium — same as above, conceptually correct but may fail to render.

## Next Steps

Proceeds to Plan stage after human review.
