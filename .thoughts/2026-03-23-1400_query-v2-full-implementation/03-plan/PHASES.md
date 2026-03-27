---
title: "Phases: 03-plan"
date: 2026-03-25
stage: 03-plan
---

# Phases: 03-plan

## Phase 1: Implementation Planning

- **Agent**: `rdpi-planner`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Produce a complete implementation plan for the query-v2 module rewrite.

**Input documents** (read ALL before writing):
- Task: `../TASK.md`
- Design README: `../02-design/README.md`
- Architecture: `../02-design/01-architecture.md` — 5-layer hierarchy (lib → core → api → react → plugins), component boundaries, class diagrams, dependency chain
- Data Flow: `../02-design/02-dataflow.md` — 15+ sequence/flowchart diagrams, state machine spec, all behavioral flows
- Domain Model: `../02-design/03-model.md` — complete TypeScript type definitions, all interfaces and classes
- Decisions: `../02-design/04-decisions.md` — 19 ADRs governing implementation choices
- Use Cases: `../02-design/05-usecases.md` — 17 use cases with TypeScript code examples
- Test Cases: `../02-design/06-testcases.md` — 137+ test cases across all layers
- Documentation Impact: `../02-design/07-docs.md` — v0.2 docs, migration guide, demo updates
- Risks: `../02-design/08-risks.md` — 22 risks with mitigations

**Existing code context**:
- Legacy v2 code (for reference only, NOT a base for modification): `src/query-v2-legacy/`
- V1 query code (patterns to follow): `src/query/`
- Signals layer (dependency): `src/signals/`
- Common utilities: `src/common/`
- V0.1 documentation: `docs/query-v2/v0.1/`
- Demo app: `apps/demos/`
- Package exports: `src/index.ts`

**Before writing the plan**, analyze:
1. Map every design component (from all 8 design documents) to concrete files — create, modify, or delete. Verify ALL file paths against the actual repository using search.
2. Identify dependencies between file changes (e.g., types before implementations, lib before core, core before api).
3. Determine which tasks can run in parallel within a phase.
4. Estimate per-task complexity (Low/Medium/High).
5. Define per-phase verification criteria.

**Output requirements**:

Produce a `README.md` (overwrite the stage-creator's initial version) with:
- Frontmatter: `title`, `date`, `status: Draft`, `feature`, `research: ../01-research/README.md`, `design: ../02-design/README.md`
- `## Overview` — brief summary of the plan scope
- `## Phase Map` — Mermaid dependency graph showing phases and their dependencies
- `## Phase Summary` — table with columns: Phase #, Name, Layer(s), Key Deliverables, Depends On, Parallelizable Tasks, Estimated Complexity
- `## Execution Rules` — constraints: every phase must leave the project compilable (`npm run ts-check`), testing per phase, etc.
- `## Next Steps`

Produce individual `NN-phase.md` files for each implementation phase. Each file must contain:
- Frontmatter: `title`, `date`, `stage: 03-plan`, `role: rdpi-planner`
- `## Goal` — what this phase accomplishes
- `## Dependencies` — Requires (prior phases) / Blocks (subsequent phases)
- `## Execution` — Sequential or Parallel tasks
- `## Tasks` — numbered list, each task specifying:
  - Exact file path (create/modify/delete)
  - Detailed description of changes
  - Design document reference (section it implements)
  - Complexity (Low/Medium/High)
- `## Verification` — checklist (minimum: `npm run ts-check`, plus relevant test commands)

**Constraints**:
- The 5-layer hierarchy MUST be respected: `lib/` → `core/` → `api/` → `react/` → `plugins/` (plus `types/` as a shared layer). Phases should follow this order bottom-up.
- Every phase must leave the project in a compilable state — no broken imports or missing types.
- No vague tasks — every task specifies exact files and concrete changes.
- Do not split trivial changes into separate tasks; do not cram complex work into too few tasks.
- New code goes into `src/query-v2/` (NOT `src/query-v2-legacy/`).
- Tests go alongside source files or in `__tests__/` subdirectories matching the layer structure.
- Include documentation tasks from `../02-design/07-docs.md` and demo updates.
- Include barrel exports (`index.ts`) and `src/index.ts` package export updates.
- Reference the test verification command: `npm run check:all`.

---

## Phase 2: Plan Review

- **Agent**: `rdpi-plan-reviewer`
- **Depends on**: Phase 1
- **Retry limit**: 2

### Prompt

Review the implementation plan for design traceability, concreteness, and correctness.

**Plan files to review**:
- Plan README: `README.md` (in this stage directory: `03-plan/`)
- All phase files: `03-plan/NN-phase.md` (list all files in the directory matching `*-phase*.md` or `NN-*.md` pattern)

**Design documents for traceability** (cross-reference against these):
- `../02-design/README.md` — overview and key decisions summary
- `../02-design/01-architecture.md` — 5-layer hierarchy, component list, class diagrams
- `../02-design/02-dataflow.md` — all behavioral flows and state machine spec
- `../02-design/03-model.md` — all TypeScript types, interfaces, classes
- `../02-design/04-decisions.md` — 19 ADRs
- `../02-design/05-usecases.md` — 17 use cases
- `../02-design/06-testcases.md` — 137+ test cases
- `../02-design/07-docs.md` — documentation and demo impact
- `../02-design/08-risks.md` — 22 risks

**Review criteria** (check each item):
1. Every design component (types, classes, functions from model §1–§16) is mapped to at least one plan task
2. File paths are concrete and verified — no placeholders like `src/query-v2/core/???`
3. Dependencies between phases are correct — no phase reads output from a not-yet-executed phase
4. Each phase has verification criteria (minimum: `npm run ts-check`)
5. Each phase leaves the project in a compilable state
6. No vague tasks — all tasks specify exact file paths and concrete changes
7. Each task references the design section it implements (e.g., "model §5", "arch §5.2")
8. Parallelizable vs. sequential tasks correctly identified
9. Per-task complexity estimates present (Low/Medium/High)
10. Documentation tasks proportional to `../02-design/07-docs.md` scope
11. Mermaid dependency graph present in README.md
12. Phase summary table complete in README.md
13. The 5-layer hierarchy (lib → core → api → react → plugins) is respected in phase ordering
14. Test cases from `../02-design/06-testcases.md` are assigned to appropriate phases
15. All 19 ADRs from `../02-design/04-decisions.md` are reflected in the plan (no decision ignored)

**Output**: Update `README.md` — add a `## Quality Review` section with pass/fail per criterion, issues found (if any), and set `status` to `Draft` if passing, or `Redraft` if issues found.

---

# Redraft Round 1

## Phase 3: Fix issues #1, #2, #5 — State machines & Patcher API

- **Agent**: `rdpi-redraft`
- **Output**: `02-state-machines.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: #1, #2, #5

### Prompt

Read REVIEW.md at `03-plan/REVIEW.md`.
Your assigned issues: #1, #2, #5.
Affected files: `03-plan/02-state-machines.md`.
Fix only your assigned issues.

Design reference for verification: `02-design/03-model.md` §3 (Machine types, transition methods) and §4 (Patcher static methods). Read these sections to confirm correct names and signatures.

---

## Phase 4: Fix issues #8, #11, #12 — Cache infrastructure

- **Agent**: `rdpi-redraft`
- **Output**: `03-cache-infrastructure.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: #8, #11, #12

### Prompt

Read REVIEW.md at `03-plan/REVIEW.md`.
Your assigned issues: #8, #11, #12.
Affected files: `03-plan/03-cache-infrastructure.md`.
Fix only your assigned issues.

Design reference for verification: `02-design/03-model.md` §5 (ICacheEntry — `state$()`, `peek()`, `set()`, `complete()`, `onClean$`, `obs`) and §6 (ICacheMap — `has()`, `clear()`, `values()`, constructor-level factory in `ICacheMapOptions`). Read these sections to confirm correct interfaces.

---

## Phase 5: Fix issues #3, #4, #10 — API layer & Agent/ResourceV2

- **Agent**: `rdpi-redraft`
- **Output**: `05-resource-agent-snapshot.md`, `06-api-layer.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: #3, #4, #10

### Prompt

Read REVIEW.md at `03-plan/REVIEW.md`.
Your assigned issues: #3, #4, #10.
Affected files: `03-plan/05-resource-agent-snapshot.md`, `03-plan/06-api-layer.md`.
Fix only your assigned issues.

Design reference for verification:
- Issue #3: `02-design/03-model.md` §12 (ICreateApiOptions — no `resources` parameter; IApi has `createResourceV2()`, `resetAll()`, `getSnapshot()`).
- Issue #4: `02-design/03-model.md` §8 (IResourceV2Agent — `state$`, `start()`, `compareArgs()`; no `destroy`/`current`/`signal`).
- Issue #10: `02-design/04-decisions.md` ADR-11 (`_status$` and `_lastEntry$` internal signals; no `ResetAllSignal`).

---

## Phase 6: Fix issues #6, #9, #13 — RCE members & edge cases

- **Agent**: `rdpi-redraft`
- **Output**: `04-rce-and-lifecycle.md`, `08-integration-and-exports.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: #6, #9, #13

### Prompt

Read REVIEW.md at `03-plan/REVIEW.md`.
Your assigned issues: #6, #9, #13.
Affected files: `03-plan/04-rce-and-lifecycle.md`, `03-plan/08-integration-and-exports.md`.
Fix only your assigned issues.

Design reference for verification:
- Issue #6: `02-design/03-model.md` §7.3 (IResourceV2CacheEntry — add `machine$: ReadableSignalFnLike<TMachineInstance>` and `isMyArgs(args): boolean`).
- Issue #9: `02-design/06-testcases.md` edge cases E08–E10 (AbortError no-op, double commit/abort idempotent, createPatch during refreshing).
- Issue #13: `02-design/03-model.md` §7.3 (IResourceV2CacheEntry `query(doForce?: boolean): Promise<TData>` — RCE knows its own args).

---

## Phase 7: Fix issues #7, #14, #15 — Cross-cutting: test descriptions, refs, complexity

- **Agent**: `rdpi-redraft`
- **Output**: All 9 phase files (`01-types-and-lib.md` through `09-docs-and-demos.md`)
- **Depends on**: Phases 3, 4, 5, 6
- **Retry limit**: 2
- **Review issues**: #7, #14, #15

### Prompt

Read REVIEW.md at `03-plan/REVIEW.md`.
Your assigned issues: #7, #14, #15.
Affected files: All 9 phase files in `03-plan/`:
- `03-plan/01-types-and-lib.md`
- `03-plan/02-state-machines.md`
- `03-plan/03-cache-infrastructure.md`
- `03-plan/04-rce-and-lifecycle.md`
- `03-plan/05-resource-agent-snapshot.md`
- `03-plan/06-api-layer.md`
- `03-plan/07-react-and-plugins.md`
- `03-plan/08-integration-and-exports.md`
- `03-plan/09-docs-and-demos.md`

Fix only your assigned issues:

**Issue #7** — Test case descriptions in plan tasks must match or faithfully reproduce the corresponding design test case descriptions from `02-design/06-testcases.md`. Read the design testcases file first, then align every test task description in all phase files with the design's actual test descriptions. Where plan currently references design test IDs (e.g., `[ref: 06-testcases.md#RCE01–RCE15]`), ensure the accompanying descriptions match the design, or remove rewritten descriptions and defer to the design IDs only.

**Issue #14** — Add `[ref: 01-architecture.md#§2]` or `[ref: 01-architecture.md#§5]` annotations to all barrel/export tasks that currently lack `[ref:]`. Affected tasks: 1.9, 1.12, 1.15, 2.9, 3.5, 5.3, 5.5, 5.9, 6.4, 6.6, 7.2, 7.4, 7.8, 8.7.

**Issue #15** — Add per-task `- **Complexity**: Low/Medium/High` annotations to every task in all 9 phase files.

---

## Phase 8: Re-review after Redraft Round 1

- **Agent**: `rdpi-plan-reviewer`
- **Depends on**: Phase 7
- **Retry limit**: 2

### Prompt

Re-review the implementation plan after Redraft Round 1 fixes.

**Plan files to review**:
- Plan README: `03-plan/README.md`
- All phase files in `03-plan/`:
  - `01-types-and-lib.md`
  - `02-state-machines.md`
  - `03-cache-infrastructure.md`
  - `04-rce-and-lifecycle.md`
  - `05-resource-agent-snapshot.md`
  - `06-api-layer.md`
  - `07-react-and-plugins.md`
  - `08-integration-and-exports.md`
  - `09-docs-and-demos.md`

**Design documents for traceability** (cross-reference against these):
- `02-design/README.md`
- `02-design/01-architecture.md`
- `02-design/02-dataflow.md`
- `02-design/03-model.md`
- `02-design/04-decisions.md`
- `02-design/05-usecases.md`
- `02-design/06-testcases.md`
- `02-design/07-docs.md`
- `02-design/08-risks.md`

**Focus on verifying fixes for all 15 issues from Round 1** (see `03-plan/REVIEW.md`):
- Critical #1–#4: Machine transitions, MachineRefreshing error, createApi signature, Agent interface
- High #5–#8: Patcher API, RCE members, test descriptions, CacheEntry interface
- Medium #9–#13: Edge cases, ResetAllSignal, CacheMap methods/factory, RCE.query()
- Low #14–#15: Barrel refs, per-task complexity

Apply the same 15-point review criteria from Phase 2. Update `README.md`: replace the existing `## Quality Review` section with updated results. Set `status` to `Draft` if all issues resolved, or `Redraft` if issues remain.

---

# Redraft Round 2

## Phase 9: Fix issues #1, #2, #3 — Type definitions in 01-types-and-lib.md

- **Agent**: `rdpi-redraft`
- **Output**: `01-types-and-lib.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: #1, #2, #3

### Prompt

Read REVIEW.md at `03-plan/REVIEW.md`.
Your assigned issues: #1, #2, #3.
Affected files: `03-plan/01-types-and-lib.md`.
Fix only your assigned issues.

Design reference for verification:
- Issue #1 (Task 1.4 `agent.types.ts`): `02-design/03-model.md` §8.1 — `IResourceV2Agent` must define `state$: ComputeFn`, `start()`, `compareArgs()`. Remove `signal`, `current`, `setArgs()`, `destroy()`.
- Issue #2 (Task 1.2 `cache.types.ts`): `02-design/03-model.md` §5 — `ICacheEntry<TState>` must define `state$()`, `peek()`, `set()`, `complete()`, `onClean$`, `obs`. Remove `ICacheEntry<TArgs, TData>` with `signal`, `current`, `args`.
- Issue #3 (Task 1.8 `api.types.ts`): `02-design/03-model.md` §12.1 — `IApi<TPlugins>` must define `createResourceV2()`, `resetAll()`, `getSnapshot()`. Remove `resources` map property and `TResources` generic.

Read each referenced design section to confirm exact signatures before editing.

---

## Phase 10: Fix issue #4 — useResourceV2Agent method names in 07-react-and-plugins.md

- **Agent**: `rdpi-redraft`
- **Output**: `07-react-and-plugins.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: #4

### Prompt

Read REVIEW.md at `03-plan/REVIEW.md`.
Your assigned issue: #4.
Affected files: `03-plan/07-react-and-plugins.md`.
Fix only your assigned issue.

Design reference for verification: `02-design/03-model.md` §8.1 — Agent uses `start(args)` not `setArgs(args)`, exposes `state$` not `current`, and has no `destroy()` (lifecycle managed by ResourceV2). Update Task 7.1 `useResourceV2Agent` hook description to use the correct method names.

---

## Phase 11: Re-review after Redraft Round 2

- **Agent**: `rdpi-plan-reviewer`
- **Depends on**: Phases 9, 10
- **Retry limit**: 2

### Prompt

Re-review the implementation plan after Redraft Round 2 fixes.

**Plan files to review** (focus on files modified in this round):
- `03-plan/01-types-and-lib.md` — verify Tasks 1.2, 1.4, 1.8 now match design
- `03-plan/07-react-and-plugins.md` — verify Task 7.1 uses correct Agent method names

**Design documents for traceability**:
- `02-design/03-model.md` §5 (ICacheEntry), §8.1 (IResourceV2Agent), §12.1 (IApi)

**Round 2 issues to verify** (from `03-plan/REVIEW.md`):
1. Task 1.4 `agent.types.ts` — `IResourceV2Agent` must use `state$`, `start()`, `compareArgs()`
2. Task 1.2 `cache.types.ts` — `ICacheEntry<TState>` must use `state$()`, `peek()`, `set()`, `complete()`, `onClean$`, `obs`
3. Task 1.8 `api.types.ts` — `IApi<TPlugins>` must use `createResourceV2()`, `resetAll()`, `getSnapshot()`
4. Task 7.1 `useResourceV2Agent` — must use `agent.start(args)`, `agent.state$`

Also spot-check that Round 1 fixes remain intact (no regressions from Phases 3–7).

Update `README.md`: replace the existing `## Quality Review` section with updated results. Set `status` to `Draft` if all 4 issues resolved, or `Redraft` if issues remain.

---

# Redraft Round 3

## Phase 12: Fix issues #1, #2, #3, #4, #5, #6 — Type definitions in 01-types-and-lib.md

- **Agent**: `rdpi-redraft`
- **Output**: `01-types-and-lib.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: #1, #2, #3, #4, #5, #6

### Prompt

Read REVIEW.md at `03-plan/REVIEW.md` — section "Round 4 — Approval Gate Extended Sanity Check".
Your assigned issues: #1, #2, #3, #4, #5, #6.
Affected file: `03-plan/01-types-and-lib.md`.
Fix only your assigned issues. Do NOT modify any other files.

For each issue, read the referenced design section in `02-design/03-model.md` to confirm the exact signatures before editing. The task descriptions must match the design model exactly.

- **Issue #1** (Task 1.1 `machine.types.ts`): Read design §2 and §3.
  - `TPatch` must have no generic, fields: `{ patches, inversePatches, status }`.
  - `IPatchHandle` must have only `{ commit(): void; abort(): void }`.
  - `CreatePatchResult` must be `<TArgs, TData>` with `{ machine, patchHandle }`.

- **Issue #2** (Task 1.2 `cache.types.ts`): Read design §6.
  - `ICacheMap` must be `<TArgs, TEntry>` (no `TData`). Must include `has`, `clear`, `values` methods.
  - `TCacheMapFactory` must be `type TCacheMapFactory<TArgs, TEntry> = (args: TArgs) => TEntry`.

- **Issue #3** (Task 1.3 `resource.types.ts`): Read design §7.1 and §7.3.
  - `TQueryFn` must return `Promise<TData>`, parameter is `(args, tools: { abortSignal: AbortSignal })`.
  - `IResourceV2CacheEntry` public interface must list `machine$`, `isMyArgs`, `createPatch`, `invalidate`, `query`.

- **Issue #4** (Task 1.5 `lifecycle.types.ts`): Read design §9.
  - `ICacheEntryAddedTools` must use `$cacheDataLoaded: Promise<TData>`, `$cacheEntryRemoved: Promise<void>`.
  - `IQueryStartedTools` must use `$queryFulfilled: Promise<{data}>`, `getCacheEntry: () => IResourceV2CacheEntry`.

- **Issue #5** (Task 1.6 `snapshot.types.ts`): Read design §10.
  - `TResourceV2SnapshotSlice` must be `<TData = unknown>` (no `TArgs`).

- **Issue #6** (Task 1.7 `plugin.types.ts`): Read design §11.
  - `IPluginContext` must have no generics.
  - `PluginResourceContributions` must be `<TPlugin, TArgs, TData>` (3 type params).
  - `PluginAugmentations` must be `<TPlugins, TArgs, TData>` (3 type params).

---

## Phase 13: Fix issues #7, #8 — RCE and ResourceV2 behavioral descriptions

- **Agent**: `rdpi-redraft`
- **Output**: `04-rce-and-lifecycle.md`, `05-resource-agent-snapshot.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: #7, #8

### Prompt

Read REVIEW.md at `03-plan/REVIEW.md` — section "Round 4 — Approval Gate Extended Sanity Check".
Your assigned issues: #7, #8.
Affected files: `03-plan/04-rce-and-lifecycle.md`, `03-plan/05-resource-agent-snapshot.md`.
Fix only your assigned issues. Do NOT modify any other files.

- **Issue #7** (Task 4.2 `ResourceV2CacheEntry` in `04-rce-and-lifecycle.md`): Read design `02-design/03-model.md` §7.3.
  - RCE must extend `CacheEntry<TMachineInstance<TArgs, TData>>` (not `CacheEntry<TArgs, TData>`).
  - Public interface must be: `machine$`, `isMyArgs`, `createPatch`, `invalidate`, `query`.
  - Remove extra methods `abort()`, `inflight` getter, `onSettled` promise, `resetPatchState()` from the description.

- **Issue #8** (Task 5.1 `ResourceV2` in `05-resource-agent-snapshot.md`): Read design `02-design/03-model.md` §7.2.
  - Remove phantom `invalidateAll()` method from the description.
  - Replace `resetAll()` with internal `resetCache()` (resetAll is API-level, not ResourceV2-level).
  - Use design §7.2 interface methods only.

---

## Phase 14: Re-review after Redraft Round 3

- **Agent**: `rdpi-plan-reviewer`
- **Depends on**: Phases 12, 13
- **Retry limit**: 2

### Prompt

Re-review the implementation plan after Redraft Round 3 fixes.

**Plan files to review** (focus on files modified in this round):
- `03-plan/01-types-and-lib.md` — verify Tasks 1.1, 1.2, 1.3, 1.5, 1.6, 1.7 now match design model exactly
- `03-plan/04-rce-and-lifecycle.md` — verify Task 4.2 RCE extends correct generic, public interface matches §7.3
- `03-plan/05-resource-agent-snapshot.md` — verify Task 5.1 ResourceV2 has no phantom methods, uses `resetCache()` internally

**Design document for traceability**:
- `02-design/03-model.md` — cross-reference ALL type/interface descriptions against:
  - §2 (TPatch), §3 (IPatchHandle, CreatePatchResult)
  - §6 (ICacheMap, TCacheMapFactory)
  - §7.1 (TQueryFn), §7.2 (IResourceV2), §7.3 (IResourceV2CacheEntry)
  - §9 (ICacheEntryAddedTools, IQueryStartedTools)
  - §10 (TResourceV2SnapshotSlice)
  - §11 (IPluginContext, PluginResourceContributions, PluginAugmentations)

**Round 4 issues to verify** (from `03-plan/REVIEW.md`):
1. Task 1.1 — TPatch no generic, IPatchHandle `commit()/abort()` only, CreatePatchResult `<TArgs, TData>`
2. Task 1.2 — ICacheMap `<TArgs, TEntry>`, TCacheMapFactory `(args: TArgs) => TEntry`
3. Task 1.3 — TQueryFn returns `Promise<TData>`, RCE public: `machine$, isMyArgs, createPatch, invalidate, query`
4. Task 1.5 — `$cacheDataLoaded`, `$cacheEntryRemoved`, `$queryFulfilled`, `getCacheEntry`
5. Task 1.6 — `TResourceV2SnapshotSlice<TData = unknown>` (no TArgs)
6. Task 1.7 — IPluginContext no generics, PluginResourceContributions/Augmentations 3 type params
7. Task 4.2 — RCE extends `CacheEntry<TMachineInstance<TArgs, TData>>`, correct public interface
8. Task 5.1 — No `invalidateAll()`, uses `resetCache()` not `resetAll()`

Also spot-check that Rounds 1–2 fixes remain intact (no regressions).

Update `README.md`: replace the existing `## Quality Review` section with updated results. Set `status` to `Draft` if all 8 issues resolved, or `Redraft` if issues remain.

---

# Redraft Round 4 (Verification)

## Phase 15: Completeness verification — all design components mapped to plan tasks

- **Agent**: `rdpi-plan-reviewer`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Perform a **completeness audit** of the implementation plan against the full design.

**Objective**: Verify that EVERY component, type, interface, class, function, constant, and test case defined in the 8 design documents is mapped to at least one concrete task in the plan.

**Plan files to audit** (read ALL):
- `03-plan/01-types-and-lib.md`
- `03-plan/02-state-machines.md`
- `03-plan/03-cache-infrastructure.md`
- `03-plan/04-rce-and-lifecycle.md`
- `03-plan/05-resource-agent-snapshot.md`
- `03-plan/06-api-layer.md`
- `03-plan/07-react-and-plugins.md`
- `03-plan/08-integration-and-exports.md`
- `03-plan/09-docs-and-demos.md`

**Design documents to check against** (read ALL):
1. `02-design/01-architecture.md` — extract every named component, layer boundary, module, and barrel export
2. `02-design/02-dataflow.md` — extract every behavioral flow, state machine state/transition, and sequence interaction
3. `02-design/03-model.md` — extract EVERY type, interface, class, method, property, generic parameter (§1–§16)
4. `02-design/04-decisions.md` — extract every ADR (1–19) and the implementation artifact it mandates
5. `02-design/05-usecases.md` — extract every use case (UC-01 through UC-17) and the code paths they require
6. `02-design/06-testcases.md` — extract every test case ID and verify it appears in a plan task
7. `02-design/07-docs.md` — extract every documentation deliverable (migration guide, API docs, README sections)
8. `02-design/08-risks.md` — extract every risk mitigation that requires code/test artifacts

**Process**:
1. Build a master checklist of ALL design components from the 8 documents above (organized by document).
2. For each component, search the 9 plan phase files for a task that covers it.
3. Mark each component as: ✅ Covered (with phase/task reference) or ❌ Missing.

**Output**: Add a `## Verification: Completeness` section to `03-plan/README.md` (append AFTER the existing `## Quality Review` section). Format:

```markdown
## Verification: Completeness

**Result**: PASS / FAIL (with N gaps found)

### Coverage by Design Document

#### 01-architecture.md
- ✅ / ❌ <component name> → Phase X, Task X.Y (or MISSING)
...

#### 02-dataflow.md
...
(repeat for all 8 documents)

### Gaps (if any)
<numbered list of missing components with design document reference>
```

Do NOT modify any plan phase files. This is a read-only audit.

---

## Phase 16: Cross-consistency verification — no contradictions between phase files

- **Agent**: `rdpi-plan-reviewer`
- **Depends on**: Phase 15
- **Retry limit**: 2

### Prompt

Perform a **cross-consistency audit** across all 9 plan phase files.

**Objective**: Verify that there are no contradictions, duplications, or inconsistencies between different phase files. When the same component (type, class, function, method) is referenced in multiple phases, the descriptions must be consistent.

**Plan files to audit** (read ALL):
- `03-plan/01-types-and-lib.md`
- `03-plan/02-state-machines.md`
- `03-plan/03-cache-infrastructure.md`
- `03-plan/04-rce-and-lifecycle.md`
- `03-plan/05-resource-agent-snapshot.md`
- `03-plan/06-api-layer.md`
- `03-plan/07-react-and-plugins.md`
- `03-plan/08-integration-and-exports.md`
- `03-plan/09-docs-and-demos.md`
- `03-plan/README.md` — Phase Map and Phase Summary table

**Check the following**:

1. **Type consistency**: When a type/interface is defined in one phase (e.g., `ICacheEntry` in Phase 1) and used in another (e.g., Phase 3), do the generic parameters, method signatures, and property names match exactly?
2. **Import/dependency consistency**: If Phase X says it creates `foo.ts` and Phase Y says it imports from `foo.ts`, do the exported names match?
3. **Method/API consistency**: If Phase 4 says `ResourceV2CacheEntry` has method `query()`, does Phase 5 (which uses RCE) refer to the same method name and signature?
4. **Test case consistency**: Do test descriptions in later phases match the interfaces/behaviors described in earlier phases?
5. **Barrel export consistency**: Do barrel files (`index.ts`) in later phases export exactly what earlier phases created?
6. **Phase dependency consistency**: Does the README.md Phase Map match the actual dependencies declared in individual phase files?
7. **Duplicate tasks**: Are there tasks that appear in multiple phases doing the same work on the same file?
8. **Naming consistency**: Are the same entities called by the same name everywhere (e.g., not `ResourceV2Agent` in one file and `Agent` in another)?

**Process**:
1. For each type/class/function that appears in more than one phase file, compare descriptions across phases.
2. For each cross-phase dependency (imports, extends, uses), verify the source exists and matches.
3. Check README.md Phase Map dependencies match individual file `## Dependencies` sections.

**Output**: Add a `## Verification: Cross-Consistency` section to `03-plan/README.md` (append AFTER the `## Verification: Completeness` section). Format:

```markdown
## Verification: Cross-Consistency

**Result**: PASS / FAIL (with N inconsistencies found)

### Cross-Reference Matrix
<table or list showing components that appear in multiple phases and whether descriptions are consistent>

### Inconsistencies (if any)
<numbered list: which phases, which component, what the contradiction is>

### Duplicates (if any)
<numbered list of duplicate tasks across phases>
```

Do NOT modify any plan phase files. This is a read-only audit.

---

## Phase 17: Design adherence verification — task descriptions match design specs exactly

- **Agent**: `rdpi-plan-reviewer`
- **Depends on**: Phase 16
- **Retry limit**: 2

### Prompt

Perform a **design adherence audit** of the implementation plan.

**Objective**: Verify that task descriptions in the plan EXACTLY match the design specifications — correct method names, correct generic parameters, correct property lists, correct signatures. No phantom methods, no missing members, no wrong generics.

**Plan files to audit** (read ALL):
- `03-plan/01-types-and-lib.md`
- `03-plan/02-state-machines.md`
- `03-plan/03-cache-infrastructure.md`
- `03-plan/04-rce-and-lifecycle.md`
- `03-plan/05-resource-agent-snapshot.md`
- `03-plan/06-api-layer.md`
- `03-plan/07-react-and-plugins.md`
- `03-plan/08-integration-and-exports.md`
- `03-plan/09-docs-and-demos.md`

**Design model** (the source of truth — read in full):
- `02-design/03-model.md` — ALL sections §1 through §16. This is the canonical reference for every type, interface, class, and function signature.

**Also cross-reference**:
- `02-design/02-dataflow.md` — state machine states/transitions, sequence diagrams
- `02-design/04-decisions.md` — ADR mandates that constrain implementation
- `02-design/05-usecases.md` — API usage patterns that plan tasks must support

**Verification procedure** — for EVERY task in EVERY phase file that describes creating or modifying a TypeScript file:

1. Read the task description (the concrete changes it describes).
2. Read the corresponding design section (from the `[ref:]` annotation or inferred from the component name).
3. Compare EXACTLY:
   - Are all interface/class members listed? (no extra, no missing)
   - Are generic type parameters correct? (correct count, correct names, correct constraints)
   - Are method signatures correct? (parameter names, parameter types, return types)
   - Are property types correct?
   - Are extends/implements clauses correct?
   - Do behavioral descriptions match the design flows?

**High-priority checks** (areas that had issues in previous rounds):
- Task 1.1 (`machine.types.ts`): `TPatch` no generic, `IPatchHandle` has only `commit()/abort()`, `CreatePatchResult<TArgs, TData>`
- Task 1.2 (`cache.types.ts`): `ICacheEntry<TState>` members, `ICacheMap<TArgs, TEntry>`, `TCacheMapFactory`
- Task 1.3 (`resource.types.ts`): `TQueryFn` signature, `IResourceV2CacheEntry` public interface
- Task 1.4 (`agent.types.ts`): `IResourceV2Agent` — `state$`, `start()`, `compareArgs()` only
- Task 1.5 (`lifecycle.types.ts`): `$cacheDataLoaded`, `$cacheEntryRemoved`, `$queryFulfilled`, `getCacheEntry`
- Task 1.6 (`snapshot.types.ts`): `TResourceV2SnapshotSlice<TData>` (no TArgs)
- Task 1.7 (`plugin.types.ts`): `IPluginContext` no generics, 3 type params on contributions/augmentations
- Task 4.2 (`ResourceV2CacheEntry`): extends `CacheEntry<TMachineInstance<TArgs, TData>>`, correct public interface
- Task 5.1 (`ResourceV2`): no `invalidateAll()`, uses `resetCache()` internally
- Task 7.1 (`useResourceV2Agent`): uses `agent.start(args)`, `agent.state$`

**Output**: Add a `## Verification: Design Adherence` section to `03-plan/README.md` (append AFTER the `## Verification: Cross-Consistency` section). Format:

```markdown
## Verification: Design Adherence

**Result**: PASS / FAIL (with N mismatches found)

### Per-Task Verification

| Phase | Task | File | Design Ref | Status | Notes |
|-------|------|------|------------|--------|-------|
| 1 | 1.1 | machine.types.ts | model §2, §3 | ✅/❌ | ... |
| 1 | 1.2 | cache.types.ts | model §5, §6 | ✅/❌ | ... |
...
(every task that creates/modifies a .ts file)

### Mismatches (if any)
<numbered list: task ref, what the plan says, what the design says, the difference>
```

After this section, add a final summary:

```markdown
## Verification Summary

| Dimension | Result | Issues |
|-----------|--------|--------|
| Completeness | PASS/FAIL | N gaps |
| Cross-Consistency | PASS/FAIL | N inconsistencies |
| Design Adherence | PASS/FAIL | N mismatches |

**Overall**: PASS / FAIL
```

If overall PASS: set README.md `status` to `Draft`.
If overall FAIL: set README.md `status` to `Redraft` and list all issues for the next redraft round.

Do NOT modify any plan phase files. This is a read-only audit.

---

# Redraft Round 5

## Phase 18: Fix foundational layers — types, core RCE, core resource

- **Agent**: `rdpi-redraft`
- **Output**: `01-types-and-lib.md`, `04-rce-and-lifecycle.md`, `05-resource-agent-snapshot.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: Cross-Consistency #3, #4, #5 (partial), #7, #8; Design Adherence #1, #2, #3, #6

### Prompt

Read the verification sections in `03-plan/README.md` — specifically `## Verification: Cross-Consistency` (issues #3, #4, #5, #7, #8) and `## Verification: Design Adherence` (mismatches #1, #2, #3, #6).

The authoritative source of truth for all type/interface signatures is `02-design/03-model.md`. Read it in full before making any edits.

Affected files and fixes:

**File: `03-plan/01-types-and-lib.md`**

- **Task 1.3** (`resource.types.ts`): The `IResourceV2<TArgs, TData>` interface is named but its members are not listed. Read design §7.2b and add all five public members: `createAgent(): IResourceV2Agent<TArgs, TData>`, `query(args): Promise<TData>`, `getEntry(args): IResourceV2CacheEntry | null` + `getEntry(args, doInitiate: true): IResourceV2CacheEntry` (two overloads), `getEntry$(args): Observable<IResourceV2CacheEntry | null>` + `getEntry$(args, doInitiate: true): Observable<IResourceV2CacheEntry>` (two overloads), `invalidate(args): void`. Use `ArgsOrVoid<TArgs>` rest-parameter ergonomics as specified in design.

**File: `03-plan/04-rce-and-lifecycle.md`**

- **Task 4.3** (LifecycleHooks): Method names and parameters differ from design §9.1. Fix method names: `fireOnCacheEntryAdded` → `fireCacheEntryAdded(args, entry)`, `fireOnQueryStarted` → `fireQueryStarted(args, entry)`. Add four missing internal methods from §9.1: `resolveDataLoaded(args, data)`, `fireCacheEntryRemoved(args)`, `resolveQueryFulfilled(args, result)`, `clearAll()`. Fix parameter names to match design (`args, entry` not `getCacheEntries, entryRemovedPromise`). Also update tool name references to match Phase 1 Task 1.5: `$cacheDataLoaded`, `$cacheEntryRemoved`, `$queryFulfilled`, `getCacheEntry`.

**File: `03-plan/05-resource-agent-snapshot.md`**

- **Task 5.1** (ResourceV2): (a) Add `createAgent(): ResourceV2Agent` as a public method — this is required by Tasks 6.2 and 7.1. (b) Fix `getEntry()` semantics: design §7.2a/b says `getEntry(args)` returns `null` when no entry exists, `getEntry(args, doInitiate: true)` forces creation (two overloads). Replace the current `getOrCreate`-always-creates description. (c) Ensure `getEntry$()` is also described with its two overloads per design.
- **Task 5.4** (Snapshot): Wrong `[ref:]` annotation — change `§11` (Plugin Types) to `§10` (Snapshot Types).
- **Task 5.8** (Snapshot tests): Test SN03 uses API-layer signature `hydrateSnapshot(api, snapshot)` but core-layer has `hydrateSnapshot(resources: Map<string, ResourceV2>, snapshot)`. Change SN03 description to use core-layer signature, or move SN03 to Phase 6 API tests.
- **Task 5.9** (barrel update): hydrateSnapshot from core layer should NOT be re-exported from the module barrel — keep it internal. Only the API-layer `hydrateSnapshot` from Phase 6 should be publicly exported. Update the barrel description to exclude core `hydrateSnapshot`.

Fix only the issues listed above. Do not change anything else in these files.

---

## Phase 19: Fix downstream layers — API, React, Plugins, Integration, Docs, README

- **Agent**: `rdpi-redraft`
- **Output**: `06-api-layer.md`, `07-react-and-plugins.md`, `08-integration-and-exports.md`, `09-docs-and-demos.md`, `README.md`
- **Depends on**: Phase 18
- **Retry limit**: 2
- **Review issues**: Cross-Consistency #1, #2, #5 (partial), #6, #9; Design Adherence #4, #5, #7

### Prompt

Read the verification sections in `03-plan/README.md` — specifically `## Verification: Cross-Consistency` (issues #1, #2, #5, #6, #9) and `## Verification: Design Adherence` (mismatches #4, #5, #7).

The authoritative source of truth is `02-design/03-model.md`. Read §11 (plugin types) and §12 (factory signatures) before making edits.

Affected files and fixes:

**File: `03-plan/06-api-layer.md`**

- **Task 6.1** (`createApi.ts`): Replace `PluginAugmentations<TPlugin>` (1 param) with the correct 3-param form `PluginAugmentations<TPlugins, TArgs, TData>` per design §11.
- **Task 6.6** (barrel update): Clarify that `hydrateSnapshot` re-exported here is the API-layer version (`hydrateSnapshot(api: IApi, snapshot)`) — core-layer version stays internal per Phase 18 fix. No naming collision.

**File: `03-plan/07-react-and-plugins.md`**

- **Task 7.3** (`ReactHooksPlugin.ts`): (a) Rename method `augment(resource)` → `augmentResource<TArgs, TData>(resource, options)` per design §11.1 — two parameters, generic. (b) Remove phantom `api.resources.todos.useResourceV2Agent(args)` usage pattern. Replace with correct pattern: `const todosResource = api.createResourceV2({...}); todosResource.useResourceV2Agent(args)`. (c) Replace `PluginAugmentations<ReactHooksPlugin>` with correct 3-param form.
- **Task 7.7** (type-level tests PL09): Replace `PluginAugmentations<ReactHooksPlugin>` with the correct 3-param form `PluginAugmentations<[ReactHooksPlugin], TArgs, TData>`.

**File: `03-plan/08-integration-and-exports.md`**

- **Task 8.7** (final barrel): Remove dual `hydrateSnapshot` export. Only the API-layer `hydrateSnapshot` should appear in the public module barrel. Core-layer version is internal-only.

**File: `03-plan/09-docs-and-demos.md`**

- **Task 9.2** (optimistic-updates.md): Remove phantom `handle.undo()` reference. `IPatchHandle` has only `commit()` and `abort()` per design §3. Replace the "Undo workflow (`handle.undo()`)" topic with the correct undo pattern: abort the patch handle + re-query, or describe inverse patches via `TPatch.inversePatches`.

**File: `03-plan/README.md`**

- **Phase Summary table, Phase 1 row**: Change "10 type files" to "9 type files + barrel" (Tasks 1.1–1.8 = 9 type definition files; Task 1.9 `types/index.ts` is a barrel, not a type definition file).

Fix only the issues listed above. Do not change anything else in these files.

---

## Phase 20: Re-review after Redraft Round 5

- **Agent**: `rdpi-plan-reviewer`
- **Depends on**: Phases 18, 19
- **Retry limit**: 2

### Prompt

Re-review the implementation plan after Redraft Round 5 fixes.

**Plan files to review** (focus on files modified in this round):
- `03-plan/01-types-and-lib.md` — verify Task 1.3 now lists all `IResourceV2` members per design §7.2b
- `03-plan/04-rce-and-lifecycle.md` — verify Task 4.3 uses design §9.1 method names (`fireCacheEntryAdded`, etc.) and includes all 6 methods
- `03-plan/05-resource-agent-snapshot.md` — verify Task 5.1 has `createAgent()` and correct `getEntry()` overloads; Task 5.4 ref is `§10`; Task 5.8 SN03 uses core signature; Task 5.9 excludes core `hydrateSnapshot` from barrel
- `03-plan/06-api-layer.md` — verify Task 6.1 uses 3-param `PluginAugmentations`; Task 6.6 exports only API-layer `hydrateSnapshot`
- `03-plan/07-react-and-plugins.md` — verify Task 7.3 uses `augmentResource(resource, options)`, no phantom `api.resources.todos`, 3-param `PluginAugmentations`; Task 7.7 uses 3-param form
- `03-plan/08-integration-and-exports.md` — verify Task 8.7 has no dual `hydrateSnapshot`
- `03-plan/09-docs-and-demos.md` — verify Task 9.2 has no `handle.undo()`
- `03-plan/README.md` — verify Phase Summary says "9 type files + barrel"

**Design documents for traceability**:
- `02-design/03-model.md` — §7.2b (IResourceV2), §9.1 (LifecycleHooks), §10 (Snapshot), §11 (Plugin types), §11.1 (ReactHooksPlugin), §12 (Factory signatures)

**Verification dimensions** — re-run all three:
1. **Cross-Consistency**: Re-check cross-reference matrix from `## Verification: Cross-Consistency` — all 9 original inconsistencies should now be resolved.
2. **Design Adherence**: Re-check the per-task verification table from `## Verification: Design Adherence` — all 7 original mismatches should now be resolved.
3. **Spot-check**: Verify that Rounds 1–4 fixes remain intact (no regressions).

**Output**: Update `03-plan/README.md`:
- Replace the existing `## Verification: Cross-Consistency` section with updated results.
- Replace the existing `## Verification: Design Adherence` section with updated results.
- Replace the existing `## Verification Summary` section with updated results.
- If all issues resolved: set `status` frontmatter to `Draft`.
- If issues remain: set `status` to `Redraft` and list remaining issues.

---
