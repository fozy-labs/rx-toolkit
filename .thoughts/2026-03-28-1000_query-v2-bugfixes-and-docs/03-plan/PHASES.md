---
title: "Phases: 03-plan"
date: 2026-03-29
stage: 03-plan
---

# Phases: 03-plan

## Phase 1: Implementation Planning

- **Agent**: `rdpi-planner`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Create a phased implementation plan for query-v2 bugfixes, enhancement, documentation, and examples.

**Input documents to read:**

- TASK.md: `../TASK.md`
- Research stage (all files):
  - `../01-research/README.md`
  - `../01-research/01-codebase-analysis.md`
  - `../01-research/02-external-research.md`
  - `../01-research/03-problem-analysis-part1.md`
  - `../01-research/04-problem-analysis-part2.md`
  - `../01-research/05-open-questions.md`
- Design stage (all files):
  - `../02-design/README.md`
  - `../02-design/00-short-design.md`
  - `../02-design/01-architecture.md`
  - `../02-design/02-dataflow.md`
  - `../02-design/03-model.md`
  - `../02-design/04-decisions.md`
  - `../02-design/05-usecases.md`
  - `../02-design/06-testcases.md`
  - `../02-design/07-docs.md`
  - `../02-design/08-risks.md`

**Before writing the plan, perform this analysis:**

1. Map every design component to concrete source files (create/modify/delete). Verify ALL file paths against the actual repository using search — do not assume paths from design documents are correct.
2. Identify dependencies between changes (e.g., type changes must precede code changes, bug fixes before docs).
3. Determine which tasks can run in parallel vs. must be sequential.
4. Estimate per-task complexity (Low/Medium/High).
5. Define per-phase verification criteria (minimum: `npm run ts-check` per phase).

**Scope of changes to plan (from design):**

- Bug #1 (ADR-1): Snapshot fetch bypass — `initialMachine` option in `ResourceV2CacheEntry`, conditional `_doFetch` skip.
- Bug #2 (ADR-2): `onQueryStarted` dead code — wire `fireQueryStarted`/`resolveQueryFulfilled` into `_doFetch`.
- Bug #3 (ADR-3): SWR error masking — fix `ResourceV2Agent._deriveState$` to derive `isError` before SWR override, clear `previous$` using original status.
- Bug #4 (ADR-4): Patcher consistency violation — `resolvePatches` must include `isConsistencyViolation` in return value.
- Bug #5 (ADR-5): `$cacheDataLoaded` hang — reject pending promise in `fireCacheEntryRemoved` before deleting resolver.
- Enhancement (ADR-6): Add `lastError?: unknown` to `MachineSuccess`, set by `errorHappened()`, cleared on success.
- Documentation (ADR-7): Fix 3 factual errors (MachineIdle, devtools options, onQueryStarted), add error handling and lifecycle hooks sections to README.
- Examples (ADR-8): Create 4–5 interactive examples in `apps/demos/src/examples/query-v2/`.
- Test strategy (ADR-9): Tests per design `06-testcases.md`.

**Key files in scope** (verify all paths):

- `src/query-v2/core/` — ResourceV2CacheEntry, ResourceV2Agent, state machines
- `src/query-v2/lib/` — Patcher, LifecycleHooks
- `src/query-v2/types/` — type definitions
- `src/query-v2/api/` — createApi, createResource
- `src/query-v2/__tests__/` — test files
- `docs/query-v2/` — documentation files (README.md, devtools.md, optimistic-updates.md, ssr.md)
- `apps/demos/src/examples/query-v2/` — interactive examples

**Output requirements:**

1. `README.md` in this stage directory with:
   - Phase map (Mermaid dependency graph)
   - Phase summary table (phase number, name, tasks count, complexity, sequential/parallel, verification)
   - Parallelization rules
   - Execution rules (every phase must leave the project compilable)
2. Individual `NN-phase.md` files for each implementation phase, each containing:
   - Goal
   - Dependencies (Requires/Blocks)
   - Execution mode (Sequential/Parallel)
   - Tasks with: exact file path, action (Create/Modify/Delete), detailed description, design reference (ADR/section)
   - Verification checklist

**Constraints:**

- Every phase must leave the project in a compilable state (`npm run ts-check`).
- No vague tasks — every task specifies exact files and concrete changes.
- Do not split trivial changes into separate tasks; group related small changes.
- Bugs #1 and #2 share overlapping code in `ResourceV2CacheEntry` — plan them together or in sequence with awareness.
- Bug #3 has a secondary issue (persistent `previous$`) — ensure both sub-issues are covered.
- Bug #5 fix must cover both `resetCache` and GC-triggered removal paths.
- Include docs and examples impact as separate phases after code changes.

---

## Phase 2: Plan Review

- **Agent**: `rdpi-plan-reviewer`
- **Depends on**: Phase 1
- **Retry limit**: 2

### Prompt

Review the implementation plan produced in Phase 1 for completeness, correctness, and design traceability.

**Files to review:**

- Plan stage: all files in this directory (`03-plan/`), including `README.md` and all `NN-phase.md` files.
- Design stage (for traceability):
  - `../02-design/README.md`
  - `../02-design/00-short-design.md`
  - `../02-design/01-architecture.md`
  - `../02-design/03-model.md`
  - `../02-design/04-decisions.md`
  - `../02-design/06-testcases.md`
  - `../02-design/07-docs.md`

**Review criteria (all must pass):**

1. Every design component (ADR-1 through ADR-10) is mapped to at least one plan task.
2. File paths are concrete and verified (not placeholders).
3. Dependencies between phases are correct (no phase reads output that hasn't been produced yet).
4. Each phase has verification criteria (minimum: `npm run ts-check`).
5. Each phase leaves the project in a compilable state.
6. No vague tasks — all tasks specify exact changes.
7. Each task references the design section it implements.
8. Parallelizable vs. sequential tasks correctly marked.
9. Per-task complexity estimates present (Low/Medium/High).
10. Documentation tasks are proportional to existing docs/demos scope (4 doc files, 3 existing examples).
11. Mermaid dependency graph present in README.md.
12. Phase summary table complete in README.md.

**After review:** Update `README.md` to add a `## Quality Review` section with a checklist table and set the status to `Draft`.

---

# Redraft Round 1

## Phase 3: Fix issues #1, #2

- **Agent**: `rdpi-redraft`
- **Output**: `01-types-and-machines.md`, `02-core-bugfixes.md`, `03-agent-and-patcher.md`, `04-tests.md`, `05-docs-and-examples.md`
- **Depends on**: Phase 1, Phase 2
- **Retry limit**: 2
- **Review issues**: #1, #2

### Prompt

Read REVIEW.md at `./REVIEW.md`.
Your assigned issues: #1, #2.
Affected files:
- `./01-types-and-machines.md`
- `./02-core-bugfixes.md`
- `./03-agent-and-patcher.md`
- `./04-tests.md`
- `./05-docs-and-examples.md`
Fix only your assigned issues.

---

## Phase 4: Re-review after Redraft Round 1

- **Agent**: `rdpi-plan-reviewer`
- **Depends on**: Phase 3
- **Retry limit**: 2

### Prompt

Re-verify all phase files modified in Redraft Round 1 for the fixes applied.

**Files to review:**

- `./01-types-and-machines.md`
- `./02-core-bugfixes.md`
- `./03-agent-and-patcher.md`
- `./04-tests.md`
- `./05-docs-and-examples.md`
- `./README.md`

**Verify specifically:**

1. Every task in each phase file now includes a `- **Complexity**: Low/Medium/High` annotation (issue #1).
2. Task 5.5 in `05-docs-and-examples.md` now includes a `[ref: ...]` design traceability tag (issue #2).
3. No regressions introduced — all original review criteria from Phase 2 still pass.

**Design documents for traceability check:**
- `../02-design/README.md`
- `../02-design/04-decisions.md`
- `../02-design/07-docs.md`

**After review:** Update `README.md` Quality Review section with the re-review results and set status to `Draft`.
