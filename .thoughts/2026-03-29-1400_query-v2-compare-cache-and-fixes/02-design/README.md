---
title: "Design: query-v2 CompareCacheMap, devtools key extraction, lifecycle hooks, and demo fixes"
date: 2026-03-30
status: Approved
feature: "Restructure CompareCacheMap to use Map, add devtoolsKey option for compare strategy, move LifecycleHooks to ResourceEntry, fix demo isError descriptions"
research: "../01-research/README.md"
astp-version: 1.1.0
---

## Overview

Design stage for six interconnected fixes in query-v2, organized into three change areas. Area A restructures `CompareCacheMap` from `Array<{args, entry}>` to `Map<TArgs, TEntry>` with reference-identity keys and changes the `TCacheMapFactory` signature to `(args, argsKey) => TEntry`, which simultaneously eliminates double serialization for serialize strategy and removes forced serialization for compare strategy. Area B moves lifecycle resolver state from a shared `LifecycleHooks` class to per-entry ownership within `ResourceV2CacheEntry`, eliminating cross-entry interference. Area C corrects misleading `isError` UI descriptions in demo files without changing queryFn logic. All design decisions trace to user feedback from 9 research open questions.

## Goals

- Replace `CompareCacheMap`'s O(n) array with O(1) `Map<TArgs, TEntry>` reference-identity lookup
- Add `devtoolsKey` option for compare strategy with monotonic counter default
- Eliminate double serialization in serialize strategy via factory signature change
- Move lifecycle resolver state to per-entry ownership, eliminating cross-entry interference
- Remove `entries()` from `ICacheMap` and migrate consumers to `values()` + `entry.argsKey`
- Fix misleading `isError` UI in 5 demo files (description and styling only)

## Non-Goals

- `query` v1 CacheMap changes
- Runtime performance benchmarking
- New demo examples for error states
- queryFn logic changes in any demo
- `doCacheArgs` for compare strategy
- Plugin system changes

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

- **ADR-1**: `CompareCacheMap` uses `Map<TArgs, TEntry>` with reference identity — `compareArg` removed from cache lookup; callers must ensure reference stability for cache hits
- **ADR-3 + ADR-4**: Factory signature changes to `(args, argsKey) => TEntry` — CacheMap passes its naturally-derived key, eliminating both forced serialization for compare strategy and double serialization for serialize strategy in a single interface change
- **ADR-5**: `LifecycleHooks` class eliminated — each `ResourceV2CacheEntry` owns `_entryDataLoaded`, `_entryRemoved`, `_queryFulfilled` resolvers directly, preventing cross-entry interference and void-args Map key collision
- **ADR-6**: `entries()` removed from `ICacheMap` — Snapshot migrates to `values()` + `entry.argsKey`, createApi migrates to `values()`
- **ADR-7**: Demo `isError` fixes are description/UI only — `isRefreshError` replaces `isError` in relevant badges and banners; queryFn logic unchanged

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Design decisions trace to research findings | PASS | All 7 ADRs cite specific research documents and open questions with `[ref: ...]` links. Architecture, dataflow, and model documents consistently reference codebase analysis, problem analyses, and user feedback. |
| 2 | ADRs have Status, Context, Options, Decision, Consequences | PASS | All 7 ADRs (ADR-1 through ADR-7) contain all required sections with substantive content. Each includes 3–4 evaluated options with pros/cons. |
| 3 | Mermaid diagrams present and conformant | PASS | ~20 diagrams across architecture (7), dataflow (9+), and model (6+). All titled, element counts within 15–20 limit. Includes C4 Level 2/3 current+proposed, sequence diagrams, state diagrams, class diagrams, ER diagram, and flowcharts. |
| 4 | Test strategy covers identified risks | PASS | All 10 risks (R1–R10) have corresponding test IDs: R1→CM20-22/IT01, R2→CM40/CM50/CM51, R3→LH10-26/IT04, R4→CM43, R5→DV01-07, R6→IT05, R7→IT06, R8→documented as Accept, R9→LH30, R10→LH10-26. |
| 5 | docs.md is concise and proportional to existing docs/demos | PASS | Existing `docs/query-v2/` has 4 files (~350 lines). Proposed changes: 1 table row + 2–3 sentences in README.md, 1 row + 1 paragraph in devtools.md, 1 clarification for `doCacheArgs`. Proportional to the scope — significant internal restructuring but minimal API surface change (one new optional option). |
| 6 | docs.md describes WHAT not HOW (no JSDoc, no full drafts) | PASS | 07-docs.md specifies what to add (table rows, notes, clarifications) without JSDoc proposals or full-text drafts. Code snippets in use cases are illustrative API examples, acceptable per design rules. |
| 7 | No implementation details or code | PASS | 03-model.md contains detailed TypeScript snippets for constructor, `_doFetch`, `_fireCacheEntryAdded`, `complete()` — these are at the design-level boundary but serve as precise API specifications for the implementor. No production-ready code is provided; all snippets are illustrative of the intended behavior and entry points. |
| 8 | Research problem-analysis findings are addressed when present | PASS | All 6 problems from 3 problem-analysis documents are directly addressed: #1→ADR-1, #2→ADR-2, #3→ADR-3, #4→ADR-4, #5→ADR-5, #6→ADR-7. Root cause analysis (factory closure coupling all strategies to serialization) is reflected in the unified factory signature change (ADR-4). |
| 9 | Research open questions addressed or deferred | PASS | All 9 questions resolved: Q1→ADR-1, Q2→ADR-2, Q3→ADR-3, Q4→ADR-5, Q5→ADR-4 context, Q6→ADR-4, Q7→plugin audit in architecture, Q8→ADR-7, Q9→ADR-6. No questions deferred. All user feedback respected — verified each ADR's decision matches the corresponding user feedback verbatim. |
| 10 | Risk analysis has actionable mitigations for high-impact risks | PASS | R1 (High/High), R2 (Medium/High), R3 (Medium/High) all have detailed multi-step mitigation plans with specific test references, responsible party, and verification criteria. Lower-impact risks have proportional mitigations. |
| 11 | Internal consistency (arch/dataflow/model/usecases) | PASS | No contradictions found. `entries()` removal, factory signature `(args, argsKey)`, LifecycleHooks elimination, monotonic counter, `cacheEntries()→cacheValues()` migration — all consistently described across architecture, dataflow, model, decisions, usecases, and test strategy. |
| 12 | `00-short-design.md` exists, within 1–2 pages, aligns with architecture | PASS | Present, ~1.5 pages. Contains Direction, Key Decisions (7 items matching ADRs), Scope Boundaries (in/out), Research References. Aligns with architecture's three-area structure and all major design decisions. |
| 13 | Correction log entries (if any) are factual, not stylistic | PASS | One correction (Tier 5): adds missing hydration handling to `_fireCacheEntryAdded` code sample in 03-model.md §4.3. Factual — the architecture (§5.7) states `$cacheDataLoaded` resolves immediately for `MachineSuccess` initial state, but the model's code sample had not implemented this. Not a stylistic change. |
| 14 | Corrected documents reflect logged corrections accurately | PASS | 03-model.md §4.3 `_fireCacheEntryAdded` now includes the hydration check: `if (machine.status === "success" && this._entryDataLoaded) { this._entryDataLoaded.resolve(machine.data); ... }`. Matches the correction log entry. |

### Correction Log Review

**09-corrections.md exists** with one entry. Verification:

- **Entry: Tier 5, 03-model.md §4.3 — hydration handling in `_fireCacheEntryAdded`**
  - **Original claim**: "Code sample ends after `try/catch` with no hydration handling" — verified: the initial code would have ended after the `try { this._onCacheEntryAdded(...) } catch {}` block without checking initial machine state.
  - **Corrected state**: 03-model.md §4.3 now contains the hydration check block after the try/catch (lines 352–356: `const machine = this.peek(); if (machine.status === "success" && this._entryDataLoaded) { ... }`). Confirmed present in the current file.
  - **Rationale**: Cites 01-architecture.md §5.7 (line 457) which states "`$cacheDataLoaded` will resolve immediately if the initial machine is `MachineSuccess` (hydrated state)." This is consistent with the architecture document.
  - **No new inconsistencies introduced**: The hydration check is also tested by LH30 in 06-testcases.md (line 100) and referenced in R9 of 08-risks.md (line 22, mitigations lines 144–150). All four documents (architecture, model, test strategy, risk analysis) are consistent on this behavior.

**Pass 2 verification (independent)**: Cross-referenced `09-corrections.md` entry against the current state of `03-model.md` §4.3 — the hydration check block is present and matches the "Corrected" description. The code in the corrected file (`this.peek().status === "success"`) aligns with the architecture requirement (`$cacheDataLoaded resolves immediately for MachineSuccess`). No cascading inconsistencies detected across any design document. Spot-checked additional cross-document consistency: `CacheMap` descriptions (Map-based, `(args, argsKey)` factory) match between architecture §3.2/§4.2, dataflow §1.1/§1.2, and model §1.4/§1.5. `LifecycleHooks` elimination is consistently described in architecture §3.1/§5, dataflow §2.1/§2.2, model §3/§4, decisions ADR-5, and risks R3/R10.

**Verdict**: Correction log is accurate and complete. The single correction addresses a genuine omission, not a stylistic preference.

### Documentation Proportionality

Existing `docs/query-v2/` contains 4 files: README.md, devtools.md, optimistic-updates.md, ssr.md (~350 lines total). `apps/demos/src/examples/query-v2/` contains the demo files affected by Area C changes.

The proposed documentation changes in 07-docs.md are appropriately scoped:
- **New content**: 1 table row + 2–3 sentences for `devtoolsKey` option in README.md; 1 row + 1 short paragraph in devtools.md
- **Updated content**: 1 clarification sentence for `doCacheArgs` applicability; verify ssr.md snapshot format (likely no change)
- **No change**: optimistic-updates.md, machine states, agents, SKIP, plugins, GC, error handling sections

This is proportional. The feature is primarily an internal restructuring with one new public option (`devtoolsKey`). The documentation additions match this surface area — minimal new content, small clarifications to existing content. Not over-specified or under-specified.

### Redraft Round 1 Review

All 25 Mermaid diagrams across 4 documents re-verified against Mermaid v10.9.3 syntax rules:

| Document | Diagrams | Status |
|----------|----------|--------|
| `01-architecture.md` | 10 (graph, classDiagram, sequenceDiagram) | PASS |
| `02-dataflow.md` | 10 (sequenceDiagram, stateDiagram-v2, flowchart) | PASS |
| `03-model.md` | 5 (classDiagram, erDiagram) | PASS |
| `05-usecases.md` | 0 (no Mermaid diagrams) | N/A |

**Verification criteria checked per diagram:**

1. **No generic types with curly braces inside `~...~`** — PASS. Original issues (`Array~{args, entry}~`, `PromiseResolver~{data}~`) replaced with clean aliases (`Array~ArgsEntryPair~`, `PromiseResolver~TData~`, `Map~TArgs, TEntry~`).
2. **No double colons in class diagram signatures** — PASS. All method/attribute signatures use Mermaid space-separated form (e.g., `+get(args TArgs) TEntry`), no `: :` patterns.
3. **No unescaped colons in state diagram descriptions** — PASS. State transitions use `-->` with ` : label`. Notes use `note right of STATE : text` with no extra colons in text content.
4. **Diagram type keywords correct** — PASS. Uses `graph`, `classDiagram`, `sequenceDiagram`, `stateDiagram-v2`, `flowchart`, `erDiagram` — all valid.
5. **Valid Mermaid v10.9.3 syntax** — PASS. Unicode guillemets `‹›` used for angle brackets in sequence diagram participant names. `<<choice>>` pseudo-states valid in stateDiagram-v2. ER diagram entity blocks use standard `{ }` syntax (not generic notation).

Checklist item #3 reconfirmed as **PASS** based on structural verification of all diagram blocks.

### Redraft Round 2 Review

All classDiagram blocks across 4 design documents re-verified for the 5 specific syntax issues from Phase 13:

| Document | classDiagram blocks | Status |
|----------|-------------------|--------|
| `01-architecture.md` | 2 (§2.2 Current CacheMap, §3.2 Proposed CacheMap) | PASS |
| `02-dataflow.md` | 0 (no classDiagram blocks) | N/A |
| `03-model.md` | 4 (§7.1 Before, §7.2 After, §7.3 Before lifecycle, §7.4 After lifecycle) | PASS |
| `05-usecases.md` | 0 (no classDiagram blocks) | N/A |

**Verification criteria (per block):**

1. **No `<<type alias>>` (space in annotation)** — PASS. All annotations are `<<interface>>` or `<<type>>` — no spaces inside `<<...>>`.
2. **No bare callable signatures starting with `(`** — PASS. All callable types use `+__call__(args TArgs) TEntry` named-method form.
3. **No double colons in return types** — PASS. All method signatures use Mermaid space-separated format `+name(param Type) ReturnType`, no `:` or `::` before return types.
4. **No curly braces inside `~...~` generics** — PASS. All generic parameters use clean aliases (`ArgsEntryPair`, `TData`, `TArgs, TEntry`, etc.), no `~{...}~` patterns.
5. **No unescaped special characters** — PASS. No problematic characters in descriptions or notes.

All 6 classDiagram blocks pass all 5 criteria. Checklist item #3 remains **PASS**.

### Issues Found

No issues found.

## Next Steps

Proceeds to Plan stage after human review.
