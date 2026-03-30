---
title: "Phases: 03-plan"
date: 2026-03-30
stage: 03-plan
---

# Phases: 03-plan

## Phase 1: Implementation Planning

- **Agent**: `rdpi-planner`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Produce a complete implementation plan for the query-v2 feature described below. The plan must decompose the design into phased, dependency-ordered implementation steps with concrete file paths and verification criteria.

**Task**: Read `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/TASK.md` for the raw problem descriptions (6 problems).

**Research**: Read `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/README.md` for key findings, root cause analysis, and contradictions.

**Design** (read ALL of these):
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/02-design/README.md` — overview, goals, non-goals, key decisions
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/02-design/00-short-design.md` — direction, scope boundaries
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/02-design/01-architecture.md` — current/proposed architecture, C4 diagrams, module dependencies
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/02-design/02-dataflow.md` — data flow sequences for all areas
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/02-design/03-model.md` — type changes, class redesigns, code samples for all components
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/02-design/04-decisions.md` — ADR-1 through ADR-7
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/02-design/05-usecases.md` — use cases and API examples
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/02-design/06-testcases.md` — full test strategy with IDs (CM20–CM56, LH10–LH33, IT01–IT08, DV01–DV07)
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/02-design/07-docs.md` — documentation impact
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/02-design/08-risks.md` — risks R1–R10 with mitigations

**Before writing the plan, perform this analysis**:

1. Map every design component to concrete source files (create/modify/delete). Verify each file path exists in the repository by searching. Key source directories: `src/query-v2/core/`, `src/query-v2/api/`, `src/query-v2/types/`, `src/query-v2/lib/`, `src/query-v2/react/`, `src/query-v2/__tests__/`, `apps/demos/src/examples/query-v2/`, `docs/query-v2/`.
2. Identify dependencies between changes. The design specifies three areas:
   - **Area A** (CacheMap + Devtools Keys, problems #1–#4): types → CompareCacheMap → SerializeCacheMap → ResourceV2 factory → createCacheMap → exports
   - **Area B** (LifecycleHooks, problem #5): ResourceV2CacheEntry → ResourceV2 → LifecycleHooks deletion
   - **Area C** (Demo fixes, problem #6): 5 demo files in `apps/demos/src/examples/query-v2/`
   - **Cross-cutting**: Snapshot migration (`entries()` → `values()` + `argsKey`), createApi migration, test updates, documentation
3. Determine which tasks can run in parallel vs must be sequential. Area A types must precede Area A implementations. Area B is independent of Area A. Area C is independent of both. Tests depend on their corresponding code changes.
4. Estimate per-task complexity (Low/Medium/High).
5. Define per-phase verification criteria — every phase must leave the project in a compilable state (`npm run ts-check`).

**Output requirements**:

- Update `README.md` in this stage directory with: phase map (Mermaid dependency graph), phase summary table, parallelization rules, execution rules.
- Create individual `NN-phase.md` files. Each file must contain: Goal, Dependencies (Requires/Blocks), Execution mode (Sequential/Parallel), Tasks (with exact file path, action Create/Modify/Delete, detailed description referencing design section), Verification checklist.
- Each task must reference the specific design document section it implements (e.g., "03-model.md §1.4" or "ADR-1").
- Include documentation tasks from `07-docs.md` and demo tasks from Area C.
- Include test tasks covering the test strategy from `06-testcases.md` — pair code changes with their tests.
- Address risks R1–R10 from `08-risks.md` — ensure mitigation steps are reflected in the plan (e.g., R2 requires atomic factory signature change, R7 requires grep for `entries()` consumers).

**Constraints**:
- Every phase must leave the project in a compilable state after all its tasks are applied.
- No vague tasks — every task specifies exact files and concrete changes.
- Do not split trivial changes into separate phases. Group related changes that must be applied together.
- The factory signature change (ADR-3/ADR-4, `TCacheMapFactory`) affects both CacheMap classes and ResourceV2 — these MUST be in the same phase or a strictly ordered dependency chain.

---

## Phase 2: Plan Review

- **Agent**: `rdpi-plan-reviewer`
- **Depends on**: 1
- **Retry limit**: 2

### Prompt

Review the implementation plan produced by the planner. Read ALL plan files in `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/03-plan/`: `README.md` and every `NN-phase.md` file present.

Cross-reference against the design at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/02-design/`:
- `README.md` (goals, non-goals, key decisions)
- `00-short-design.md` (scope boundaries)
- `01-architecture.md` (module dependencies, proposed architecture)
- `03-model.md` (all type and class changes)
- `04-decisions.md` (ADR-1 through ADR-7)
- `06-testcases.md` (test IDs: CM20–CM56, LH10–LH33, IT01–IT08, DV01–DV07)
- `07-docs.md` (documentation impact)
- `08-risks.md` (risks R1–R10)

**Review criteria**:
1. Every design component (from 03-model.md, 04-decisions.md) is mapped to at least one plan task
2. File paths are concrete and verified (not placeholders)
3. Dependencies between phases are correct — no phase reads an output that hasn't been produced yet
4. Each phase has verification criteria including `npm run ts-check`
5. Each phase leaves the project in a compilable state
6. No vague tasks — all tasks specify exact files and concrete changes
7. Each task references the design section it implements
8. Parallelizable vs sequential tasks correctly marked
9. Per-task complexity estimates present (Low/Medium/High)
10. Documentation tasks are proportional to existing docs/demos (per 07-docs.md)
11. Mermaid dependency graph present in README.md
12. Phase summary table complete in README.md
13. Test cases from 06-testcases.md are covered — CM20–CM56, LH10–LH33, IT01–IT08, DV01–DV07 are all assigned to plan phases
14. Risk mitigations from 08-risks.md are reflected in the plan (R2: atomic factory change, R7: entries() grep, R9: hydration check)
15. No scope creep beyond what the design specifies (check against 00-short-design.md scope boundaries and README.md non-goals)

**Output**: Update `README.md` in the stage directory — add `## Quality Review` section with checklist table, issues found (if any), and set status to `Draft`.

---
