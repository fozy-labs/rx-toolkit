---
title: "Design: Query v2 Implementation Fixes"
date: 2026-03-18
status: Approved
feature: "7 targeted fixes/improvements to the query-v2 module: React hooks independence, folder restructuring, core split, devtools filtering, snapshot error handling, JSDoc, and optimistic update docs"
research: "../01-research/README.md"
rdpi-version: b0.2
---

## Overview

Technical design for 7 targeted fixes to the query-v2 module: standalone React hooks in `react/` with preserved plugin delegation, `core/` split into `common/machines/resource`, agent signal devtools isolation via `isDisabled: true`, snapshot hydration error throwing, public API JSDoc, and optimistic update snapshot documentation in `docs/query-v2/ssr.md`. All design decisions are constrained by user answers from the research stage (Q1–Q12).

## Goals

- Decouple React hooks from `ReactHooksPlugin` — support both standalone `useResourceV2Agent(resource, args)` and plugin `resource.useResourceV2Agent(args)` paths
- Organize `core/` into `common/`, `machines/`, `resource/` sub-folders without changing public API
- Prevent `ResourceV2Agent` signals from leaking to Redux DevTools
- Make `hydrateSnapshot` throw on version/prefix mismatch instead of silently skipping
- Add JSDoc to public API surface and inline comments at non-obvious code locations
- Document optimistic update snapshot behavior in existing `docs/query-v2/ssr.md`

## Non-Goals

- Removing or deprecating the plugin system (Q2: preserve as-is)
- Exposing `core/` sub-paths as public imports (Q9: barrel-only)
- Adding per-resource devtools opt-out (Q10: no changes to opt-out mechanism)
- Writing JSDoc for internal machine classes or private helpers
- Creating new documentation files or demo pages

## Documents

- [Architecture](./01-architecture.md) — C4 module boundaries, component boundaries per fix, dependency diagrams, signal/devtools boundary
- [Data Flow](./02-dataflow.md) — Standalone/plugin hook lifecycle, snapshot hydration with error handling, devtools flow before/after, args change flow
- [Domain Model](./03-model.md) — Class/interface hierarchy, machine state hierarchy, standalone hooks relationship, snapshot domain, module layout
- [Decisions](./04-decisions.md) — ADR-1 through ADR-5 covering hooks dual-path, core split, devtools filtering, snapshot errors, JSDoc scope
- [Use Cases](./05-usecases.md) — 6 use case groups (hooks, core split, devtools, snapshot, JSDoc, docs) with code examples and edge cases
- [Test Cases](./06-testcases.md) — 38 test cases (T1–T38) across unit/integration/regression, edge case analysis, existing test update plan
- [Documentation and Examples](./07-docs.md) — Minimal doc additions to 3 existing files
- [Risks](./08-risks.md) — 10 risks (R1–R10) with detailed mitigations for high-impact items

## Key Decisions

- **ADR-1**: Standalone hooks in `react/` + `ReactHooksPlugin` as thin wrapper delegating to them — both call paths produce identical behavior
- **ADR-2**: Internal-only core split with `core/index.ts` barrel re-exporting from `common/`, `machines/`, `resource/` — zero public API change
- **ADR-3**: Pass `{ isDisabled: true }` to all 3 agent signal constructors in `ResourceV2Agent` — uses existing signal mechanism, no infra changes
- **ADR-4**: Throw on snapshot version/prefix mismatch, `console.warn` on unknown resource key — balances strictness with tolerance for expected evolution
- **ADR-5**: JSDoc on public API classes/methods + inline comments at "magic" locations (devtools push, signal disabling, declaration merging) + `@see` links

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Design decisions trace to research findings | PASS | All 5 ADRs and architecture sections include `[ref: ...]` links to codebase analysis (§1–§7) and open questions (Q1–Q12). Every design choice maps to a specific research finding or user decision. |
| 2 | ADRs have Status, Context, Options, Decision, Consequences | PASS | All 5 ADRs (ADR-1 through ADR-5) contain all required sections. Options range from 2–4 per ADR with pros/cons analysis. |
| 3 | Mermaid diagrams present and conformant | PASS | 14 diagrams across architecture (4), dataflow (6), model (4). All are syntactically valid Mermaid (`graph TB/LR`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`). Element counts range 3–14, within the ≤20 limit. Titles provided by section headings. |
| 4 | Test strategy covers identified risks | PASS | All 10 risks (R1–R10) have corresponding test cases or explicit acceptance rationale. R1→T29/T30/T37, R2→T14–T22, R3→T8–T13, R5→T37/T38, R6→T26, R7→new hook tests + full suite. |
| 5 | docs.md is concise and proportional to existing docs/demos | PASS | 07-docs.md is 35 lines total, proposing ~15 lines of additions across 3 existing files (`ssr.md`, `api-reference.md`, `README.md`). Existing `docs/query-v2/` has 4 files. No new files, no demo changes. Proportional to the feature scope. |
| 6 | docs.md describes WHAT not HOW (no JSDoc, no full drafts) | PASS | 07-docs.md lists target files, sections, and bullet-point content descriptions with scope estimates ("3–5 bullet points", "~5 lines"). No JSDoc proposals, no full-text doc drafts. JSDoc examples appear in 05-usecases.md as illustrative API snippets, which is appropriate for use cases. |
| 7 | No implementation details or code | PASS | Code snippets in architecture and decisions are API-level illustrations (function signatures, plugin delegation pattern, signal constructor options). No function bodies, no algorithm implementations. Use case code examples show consumer-facing usage, not internal implementation. |
| 8 | Research open questions addressed or deferred | PASS | All 12 questions (Q1–Q12) are addressed: Q1→ADR-1, Q2→ADR-1 (plugin preserved), Q3→ADR-2, Q4→ADR-4, Q5→ADR-3, Q6→ADR-5, Q7→07-docs.md + UC-6.1, Q8→R4 mitigation (order: #3→#1/#2), Q9→ADR-2, Q10→ADR-3 context, Q11→ADR-5, Q12→R7 + test strategy §"Existing Test Files". |
| 9 | Risk analysis has actionable mitigations for high-impact risks | PASS | R1 (High/High) and R5 (High/High) have 4-step mitigations with specific test case references, documentation targets, and error message requirements. R3 (Low/High) has 4-step mitigation including delegation transparency analysis and specific test verification. |
| 10 | Internal consistency (arch/dataflow/model/usecases) | PASS | Verified across all documents: hook signatures match (resource as 1st param), plugin delegation is consistent (single-line pass-through), core split structure aligns, `isDisabled: true` appears in all relevant contexts, snapshot error semantics are uniform. No contradictions found. |

### Documentation Proportionality

The existing `docs/query-v2/` directory has 4 files: `README.md`, `api-reference.md`, `optimistic-updates.md`, `ssr.md`. The `apps/demos/src/examples/` directory has `query-v2/` with interactive demos.

The design proposes:
- **Fix #7**: 3–5 bullet points appended to the existing "Ограничения" list in `ssr.md`
- **Fix #1+#2**: ~5 lines each in `api-reference.md` and `README.md` noting standalone import availability
- **Fix #5**: 3–4 bullet points in `ssr.md` noting new throw behavior

Total: ~25 lines of additions across 3 existing files. No new documentation files. No demo changes. This is proportional — small targeted additions matching the scope of the underlying code changes. No over-specification.

### Issues Found

No issues found.

## Next Steps

Proceeds to Plan stage after human review.
