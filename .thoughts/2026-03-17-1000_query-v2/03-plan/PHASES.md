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

You are planning the implementation of the query-v2 module for rx-toolkit. This is a complex module requiring careful decomposition into manageable, verifiable phases.

**Task description**: Read `../TASK.md` at `.thoughts/2026-03-17-1000_query-v2/TASK.md`.

**RFC**: Read `docs/contributing/query-v2/README.md`.

**Research outputs** (read the README for summary, consult individual files only as needed for detail):
- `.thoughts/2026-03-17-1000_query-v2/01-research/README.md`
- `.thoughts/2026-03-17-1000_query-v2/01-research/01-codebase-query-v1.md`
- `.thoughts/2026-03-17-1000_query-v2/01-research/02-codebase-signals-common.md`
- `.thoughts/2026-03-17-1000_query-v2/01-research/03-external-research.md`
- `.thoughts/2026-03-17-1000_query-v2/01-research/04-open-questions.md`

**Design outputs** (read ALL of these — they define exactly what to implement):
- `.thoughts/2026-03-17-1000_query-v2/02-design/README.md` — Overview, key decisions summary
- `.thoughts/2026-03-17-1000_query-v2/02-design/01-architecture.md` — C4 diagrams, module structure, folder layout, component responsibilities, public API surface
- `.thoughts/2026-03-17-1000_query-v2/02-design/02-dataflow.md` — 9 sequence diagrams: cache miss, SWR, invalidation, optimistic update, SSR, plugin init, lifecycle hooks, SKIP_TOKEN, reactive query$
- `.thoughts/2026-03-17-1000_query-v2/02-design/03-model.md` — 16 type/interface definitions, ER diagram, generic type propagation, state machine transition rules
- `.thoughts/2026-03-17-1000_query-v2/02-design/04-decisions.md` — 9 ADRs: plugin types (ADR-1), refreshing errors (ADR-2), cache strategy (ADR-3), patch lifecycle (ADR-4), agent subscription (ADR-5), createApi extensibility (ADR-6), CacheEntry (ADR-7), devtools (ADR-8), hook naming (ADR-9)
- `.thoughts/2026-03-17-1000_query-v2/02-design/05-usecases.md` — 11 use cases with TypeScript examples
- `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` — 97 test cases across 11 categories
- `.thoughts/2026-03-17-1000_query-v2/02-design/07-docs.md` — Documentation plan (4 new pages, 2 updates, 1 migration guide, 2–3 demos)
- `.thoughts/2026-03-17-1000_query-v2/02-design/08-risks.md` — 12 risks with mitigations

**Known issue to address in the plan**: The design has a pre-existing inconsistency — `MachineSuccess.start(args)` appears in the model's transition rules table (§4.2, row 6) and test case M5 but is NOT in the `MachineSuccess` class definition (model §1.3) or the architecture state diagram (§5). Your plan must include a task to resolve this inconsistency in one of the early phases (either add `start()` to MachineSuccess or remove it from the transition table and test M5 — defer the design decision to the implementing agent, but ensure the task is tracked).

**Before writing the plan, you MUST analyze**:
1. Map every design component (from architecture, model, decisions) to concrete files under `src/query-v2/`. Use the architecture's folder layout as the canonical structure.
2. Identify dependencies between changes — what must exist before what can be built.
3. Determine which tasks can run in parallel vs. must be sequential.
4. Estimate per-task complexity (Low/Medium/High).
5. Define per-phase verification criteria (minimum: `npm run ts-check` for every phase).
6. Verify ALL referenced file paths against the actual repository using search. Confirm that files you plan to modify exist and files you plan to create do not.

**Module structure** (from design architecture §4 — verify against actual repo):
```
src/query-v2/
  index.ts
  types/
  lib/          — SKIP_TOKEN, NO_VALUE, stableStringify
  core/         — machines, cache (ICacheMap, SerializedCacheMap, CompareCacheMap), patcher, agent, CacheEntry
  api/          — createApi, createResource, ResourceV2
  react/        — ReactHooksPlugin (useResourceV2Agent, useResourceV2Ref)
```

**Output structure — you must produce**:

1. **README.md** (overwrite the existing stage-creator README) with:
   - YAML frontmatter: `title`, `date`, `status: Draft`, `feature`, `research`, `design`, `rdpi-version: b0.2`
   - `## Overview` — 2–3 sentence summary of the plan
   - `## Phase Map` — Mermaid dependency graph showing all phases and their dependencies
   - `## Phase Summary` — Table with columns: Phase, Name, Tasks, Complexity, Dependencies, Parallelizable
   - `## Execution Rules` — Key constraints (compilable at every boundary, test verification, etc.)
   - `## Next Steps` — What happens after plan approval

2. **Individual phase files** (`NN-phase.md` or `NN-<descriptive-name>.md`) — one per implementation phase, each with:
   - YAML frontmatter: `title`, `date`, `stage: 03-plan`, `role: rdpi-planner`
   - `## Goal` — What this phase accomplishes
   - `## Dependencies` — Requires (phases that must complete first), Blocks (phases that depend on this)
   - `## Execution` — Sequential or Parallel
   - `## Tasks` — Detailed task list where EACH task specifies:
     - Exact file path (Create/Modify/Delete action)
     - Detailed description of the changes
     - Design document reference (e.g., "Implements model §1.3 Machine classes")
     - Complexity estimate (Low/Medium/High)
   - `## Verification` — Checklist for confirming the phase is complete (always include `npm run ts-check`)

**Constraints**:
- Every phase MUST leave the project in a compilable state (`npm run ts-check` must pass).
- No vague tasks — every task specifies exact files and concrete changes.
- All new code goes in `src/query-v2/` — full isolation from `src/query/`.
- Do not split trivial changes (e.g., a single re-export) into separate tasks.
- Group related test files with the code they test OR in dedicated test phases — but never leave code untested for more than one phase.
- Include documentation and demo tasks (per design `07-docs.md`) in a late phase — after all implementation is stable.
- The plan must cover ALL design components: types, lib utilities, machines, cache, patcher, agent, CacheEntry, ResourceV2, createApi, plugins, React hooks, SSR snapshots, devtools integration, lifecycle hooks, tests, docs, and demos.
- Reference test cases from `06-testcases.md` in phases where they should be implemented (map test categories to code phases).
- Consider the 12 risks from `08-risks.md` — high-impact risks (R1 TS2589, R2 instanceof SSR, R3 hanging patch, R5 signals integration, R7 test complexity, R8 cache key performance) should be validated early in the plan where possible.

---

## Phase 2: Plan Review

- **Agent**: `rdpi-plan-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 1
- **Retry limit**: 2

### Prompt

Review the implementation plan for the query-v2 module.

**Plan files to review** — read ALL of them:
- `.thoughts/2026-03-17-1000_query-v2/03-plan/README.md`
- All `NN-*.md` files in `.thoughts/2026-03-17-1000_query-v2/03-plan/` (list the directory to discover them, exclude PHASES.md and REVIEW.md)

**Design documents for traceability check** — read ALL of them:
- `.thoughts/2026-03-17-1000_query-v2/02-design/README.md`
- `.thoughts/2026-03-17-1000_query-v2/02-design/01-architecture.md`
- `.thoughts/2026-03-17-1000_query-v2/02-design/02-dataflow.md`
- `.thoughts/2026-03-17-1000_query-v2/02-design/03-model.md`
- `.thoughts/2026-03-17-1000_query-v2/02-design/04-decisions.md`
- `.thoughts/2026-03-17-1000_query-v2/02-design/05-usecases.md`
- `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md`
- `.thoughts/2026-03-17-1000_query-v2/02-design/07-docs.md`
- `.thoughts/2026-03-17-1000_query-v2/02-design/08-risks.md`

**Research summary** (for context, not deep review):
- `.thoughts/2026-03-17-1000_query-v2/01-research/README.md`

**Task description**: `.thoughts/2026-03-17-1000_query-v2/TASK.md`

**Review criteria** — verify ALL of the following:

1. **Design traceability**: Every design component (from architecture, model, decisions, use cases, test cases, docs plan, risks) is mapped to at least one plan task. Create a traceability matrix if needed.
2. **File paths**: All file paths are concrete (not placeholders). Verify that files planned for modification actually exist in the repository and files planned for creation do not already exist.
3. **Dependency correctness**: Phase dependencies are correct — no phase reads output from a phase that hasn't completed yet. Verify the Mermaid dependency graph matches the individual phase files.
4. **Verification criteria**: Each phase has verification criteria. Every phase includes `npm run ts-check` at minimum.
5. **Compilable boundaries**: Each phase leaves the project in a compilable state. Check for phases that create types referenced elsewhere without also creating the references, or phases that import from files not yet created.
6. **Task concreteness**: No vague tasks — all tasks specify exact file paths, actions (Create/Modify/Delete), and detailed descriptions of changes.
7. **Design references**: Each task references the design document section it implements (e.g., "model §1.3", "ADR-4", "dataflow §3").
8. **Parallelization correctness**: Tasks marked as parallelizable truly have no dependencies on each other.
9. **Complexity estimates**: Per-task complexity estimates (Low/Medium/High) are present and reasonable.
10. **Documentation proportionality**: Documentation and demo tasks are proportional to existing docs/demos (per design 07-docs.md).
11. **Mermaid dependency graph**: Present in README.md, correctly reflects all phases and their dependencies.
12. **Phase summary table**: Complete in README.md with all required columns.
13. **Known issue tracked**: The `MachineSuccess.start(args)` inconsistency is tracked as a task in the plan.
14. **Test coverage mapping**: Test cases from `06-testcases.md` are mapped to implementation phases where they should be written.
15. **Risk mitigation**: High-impact risks from `08-risks.md` are addressed early in the plan where possible (especially R1 TS2589 plugin types, R3 hanging patch).

**Output**: Update `.thoughts/2026-03-17-1000_query-v2/03-plan/README.md`:
- Add a `## Quality Review` section at the end with:
  - A checklist table (columns: #, Criterion, Status PASS/FAIL, Notes)
  - An issues list (numbered, with severity, location, expected fix, and checklist item reference)
  - A verdict: if any High/Medium issues → set README status to `Needs Revision`; if only Low or none → set status to `Draft`
- Set the `status` field in README.md frontmatter to `Draft` (if approved) or `Needs Revision` (if issues found).

---
