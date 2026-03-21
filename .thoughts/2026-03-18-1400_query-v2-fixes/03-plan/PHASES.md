---
title: "Phases: 03-plan"
date: 2026-03-18
stage: 03-plan
---

# Phases: 03-plan

## Phase 1: Implementation Planning

- **Agent**: `rdpi-planner`
- **Output**: `README.md`, `01-phase.md` ... `NN-phase.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

You are planning the implementation of 7 targeted fixes to the `query-v2` module. Your job is to decompose the approved design into concrete, phased implementation tasks with exact file paths, dependency ordering, and verification criteria.

**Read these documents before starting:**

- TASK.md: `../TASK.md`
- Research README: `../01-research/README.md`
- Research codebase analysis: `../01-research/01-codebase-analysis.md`
- Design README: `../02-design/README.md`
- Design architecture: `../02-design/01-architecture.md`
- Design data flow: `../02-design/02-dataflow.md`
- Design domain model: `../02-design/03-model.md`
- Design decisions (ADR-1 through ADR-5): `../02-design/04-decisions.md`
- Design use cases: `../02-design/05-usecases.md`
- Design test cases (T1–T38): `../02-design/06-testcases.md`
- Design documentation plan: `../02-design/07-docs.md`
- Design risks (R1–R10): `../02-design/08-risks.md`

**Analysis requirements (complete these BEFORE writing any plan files):**

1. Map every design component (from architecture, model, decisions, use cases) to concrete source files — create, modify, or delete. Search the repository to verify all file paths exist before referencing them. The query-v2 source lives under `src/query-v2/`.
2. Identify dependencies between changes. The design recommends this order: Fix #3 (core split) first → Fix #1+#2 (hooks dual-path + react folder) → Fix #4 and #5 (devtools + snapshot, parallelizable) → Fix #6 and #7 (JSDoc + docs, parallelizable). Validate this ordering against the actual file dependencies.
3. Determine which tasks within a phase can run in parallel vs. must be sequential.
4. Estimate per-task complexity: Low (< 30 lines changed), Medium (30–100 lines), High (> 100 lines).
5. Define per-phase verification criteria — every phase MUST pass `npm run ts-check` at minimum. Add test commands where applicable.
6. Account for test file impacts: the design specifies 38 test cases (T1–T38) in `../02-design/06-testcases.md`. Map each test case to the phase that implements the code it tests. Include test creation/update tasks.

**Output structure:**

Create `README.md` in this directory (`03-plan/`) with:
- YAML frontmatter: `title`, `date`, `status: Draft`, `feature`, `research: "../01-research/README.md"`, `design: "../02-design/README.md"`, `rdpi-version: b0.2`
- `## Overview` — 2–3 sentence summary
- `## Phase Map` — Mermaid dependency graph showing phase execution order and parallelization
- `## Phase Summary` — Table with columns: Phase, Name, Description, Complexity, Depends On, Parallelizable, Verification
- `## Execution Rules` — Sequential vs. parallel rules, "every phase must leave the project compilable" constraint
- `## Next Steps` — What happens after plan approval

Create individual `NN-phase.md` files (e.g., `01-core-split.md`, `02-hooks-dual-path.md`, etc.) each with:
- YAML frontmatter: `title`, `date`, `stage: 03-plan`, `role: rdpi-planner`
- `## Goal` — What this phase accomplishes (1–2 sentences)
- `## Dependencies` — Requires (previous phases) / Blocks (subsequent phases)
- `## Execution` — Sequential or Parallel
- `## Tasks` — Numbered list, each task specifying:
  - Exact file path (verified against repo)
  - Action: Create / Modify / Delete
  - Detailed description of what changes
  - Design reference (e.g., "Implements ADR-1 §standalone-hooks", "Addresses T5–T8")
  - Complexity: Low / Medium / High
- `## Verification` — Checklist including at minimum `npm run ts-check`, plus relevant test commands

**Constraints:**

- Every phase must leave the project in a compilable state after all its tasks are applied.
- No vague tasks — every task must specify exact files and concrete changes. "Update imports" is not enough; specify WHICH files update WHICH imports.
- Do not split trivial changes into separate phases. Group related small changes.
- Include documentation tasks (JSDoc in Fix #6, docs updates in Fix #7) — check `../02-design/07-docs.md` for the specific files and sections to update.
- The design explicitly states no new documentation files and no demo changes — respect that constraint.
- Reference the design's risk mitigations (R1–R10 from `../02-design/08-risks.md`) in the relevant phase verification criteria where applicable.
- Existing test files that need updating are mentioned in the research (`plugin-augmentation.test.ts`, `query-flow.test.ts`, `ssr-hydration.test.ts`) and the design test strategy. Include their updates in the correct phases.

---

## Phase 2: Plan Review

- **Agent**: `rdpi-plan-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: Phase 1
- **Retry limit**: 2

### Prompt

Review the implementation plan for the query-v2 fixes. Your job is to verify completeness, correctness, and traceability against the approved design.

**Read these documents:**

Plan files (in `../03-plan/` — this directory):
- `README.md` — Phase map, summary table, execution rules
- All `NN-*.md` files (list the directory to discover them) — Individual phase details

Design files (for traceability):
- `../02-design/README.md` — Design overview and key decisions
- `../02-design/01-architecture.md` — Component boundaries
- `../02-design/02-dataflow.md` — Data flow diagrams
- `../02-design/03-model.md` — Domain model
- `../02-design/04-decisions.md` — ADR-1 through ADR-5
- `../02-design/05-usecases.md` — Use cases
- `../02-design/06-testcases.md` — 38 test cases (T1–T38)
- `../02-design/07-docs.md` — Documentation plan
- `../02-design/08-risks.md` — Risks R1–R10

**Review criteria — verify ALL of the following:**

1. **Design traceability**: Every design component (ADR-1 through ADR-5, all use cases from 05-usecases.md, all test cases T1–T38) is mapped to at least one plan task. No design element is orphaned.
2. **File path validity**: All file paths referenced in plan tasks are concrete and verified against the repository (not placeholders or guesses). Search the repository to spot-check at least 5 file paths.
3. **Dependency correctness**: Phase dependencies in the plan match the actual data flow. No phase reads an output that hasn't been produced by a prior phase. The recommended order (#3 → #1/#2 → #4/#5 → #6/#7) is respected or deviations are justified.
4. **Per-phase verification**: Each phase has verification criteria including at minimum `npm run ts-check`. Phases with test tasks include test run commands.
5. **Compilable state**: Each phase leaves the project in a compilable state — no phase deletes files that later phases depend on without updating imports in the same phase.
6. **Task concreteness**: No vague tasks. Every task specifies exact files, exact actions (Create/Modify/Delete), and concrete descriptions of what changes.
7. **Design references**: Each task references the design section it implements (ADR number, use case, test case, risk).
8. **Parallelization correctness**: Tasks marked as parallelizable truly have no ordering dependencies. Tasks marked sequential have genuine dependencies.
9. **Complexity estimates**: Every task has a complexity estimate (Low/Medium/High).
10. **Documentation proportionality**: Documentation tasks (JSDoc, docs updates) are proportional to the scope defined in `../02-design/07-docs.md` — no over-specification, no new files.
11. **Mermaid dependency graph**: README.md contains a valid Mermaid dependency graph showing phase execution order.
12. **Phase summary table**: README.md contains a complete summary table with all required columns.

**Output:**

Update `README.md` in this directory:
- Add a `## Quality Review` section at the end with a checklist table (same format as design stage reviews: #, Criterion, Status PASS/FAIL/WARN, Notes)
- If all criteria pass: set `status` in frontmatter to `Draft`
- If any criteria fail: set `status` to `Needs Revision`, list specific issues under the Quality Review section with actionable fix descriptions

---

# Redraft Round 1

## Phase 3: Fix issue #1 and user feedback (remove README.md from Phase 4B)

- **Agent**: `rdpi-redraft`
- **Output**: `01-core-split.md`, `04b-documentation.md`, `README.md`
- **Depends on**: Phase 1, Phase 2
- **Retry limit**: 2
- **Review issues**: #1, user feedback

### Prompt

Read REVIEW.md at `../03-plan/REVIEW.md`.
Your assigned issues: #1 plus the user feedback item in `## User Feedback`.

Affected files (all paths relative to `../03-plan/`):

1. **`01-core-split.md`** — Issue #1: In the Task 1.4 description, the parenthetical says "7 relative imports change" but the enumerated list contains 8 import changes. Change "7" to "8".

2. **`04b-documentation.md`** — User feedback: Remove **Task 4B.3** entirely (the task that modifies `docs/query-v2/README.md`). Then update:
   - The `## Goal` sentence: change "three existing documentation files" to "two existing documentation files".
   - The `## Verification` checklist: remove the item `- [ ] docs/query-v2/README.md mentions standalone hook usage`.
   - The `## Verification` line about proportionality: update "~25 lines total across 3 files" to "~20 lines total across 2 files".

3. **`README.md`** — In the `## Phase Summary` table, update the Phase 4B row:
   - Description column: remove mention of `README.md` (keep `ssr.md` and `api-reference.md`).
   - Keep everything else unchanged.
   - Set `status` in frontmatter to `Inprogress`.

Fix only your assigned issues. Do not change anything else.

---

## Phase 4: Re-review after Redraft Round 1

- **Agent**: `rdpi-plan-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: Phase 3
- **Retry limit**: 2

### Prompt

Re-verify the plan files modified in Redraft Round 1. Read:

- `../03-plan/REVIEW.md` — the original review issues
- `../03-plan/01-core-split.md` — verify issue #1 is fixed (Task 1.4 header now says "8 relative imports change")
- `../03-plan/04b-documentation.md` — verify Task 4B.3 (docs/query-v2/README.md) is fully removed, Goal/Verification updated
- `../03-plan/README.md` — verify Phase 4B description no longer mentions README.md, status is `Inprogress`

Also re-check against the original review criteria from Phase 2 (design traceability, file path validity, dependency correctness, etc.) but ONLY for the sections that were modified. Do not re-review unchanged files.

Update the `## Quality Review` section in `README.md` to reflect the re-review results. If all fixes are correct, set `status` to `Draft`.

---
