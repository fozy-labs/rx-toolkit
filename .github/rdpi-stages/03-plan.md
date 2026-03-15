# Stage: 03-Plan

Plan stage decomposes the approved design into an actionable, phased implementation plan. Does NOT introduce new design decisions.


## Available Roles

| Role | Agent | Description | Default Limit |
|------|-------|-------------|---------------|
| Planner | `rdpi-planner` | Analyzes design, maps components to concrete file changes, builds phased plan with dependencies and verification | max 1 invocation, retry 2 |


## Typical Phase Structure

| Phase | Agent | Outputs | Depends on | Parallelizable |
|-------|-------|---------|------------|----------------|
| 1 | `rdpi-planner` | `README.md`, `01-phase.md` ... `NN-phase.md` | — | No |

Plan stage typically has **a single phase** — one planner invocation produces the entire plan. The planner creates README.md and all phase files atomically to ensure consistency.


## Phase Prompt Guidelines

### Phase 1 — Implementation Planning

The prompt MUST specify:
- Paths to ALL documents: `../01-research/`, `../02-design/`
- The analysis requirements (before writing):
  1. Map every design component to concrete files (create/modify/delete)
  2. Identify dependencies between changes
  3. Determine parallelizable tasks
  4. Estimate per-task complexity (Low/Medium/High)
  5. Define per-phase verification criteria
  6. Verify ALL file paths against actual repository (use search)
- Output structure requirements:
  - README.md with phase map (Mermaid dependency graph), summary table, parallelization rules
  - Individual `NN-phase.md` files with task-level detail
- Task format requirements:
  - Each task specifies exact file path, action (Create/Modify/Delete), and detailed description
  - Each task references the design document section it implements
  - Verification checklist per phase (minimum: `npm run ts-check`)
- Constraints:
  - Every phase must leave the project in a compilable state
  - No vague tasks — every task specifies exact files and concrete changes
  - Do not split trivial changes into separate tasks
  - Include docs/ and apps/demos/ impact (if any per design)

<critical>
File paths in the plan MUST be verified against the actual repository. The planner must search to confirm files exist before referencing them.
</critical>


## Output Conventions

- All documents in Russian, code references in English
- No YAML frontmatter in output files (use inline metadata bullets)
- README.md structure: `# План имплементации: <Name>`, metadata bullets (Date, Status: Draft, Research link, Design link), Обзор, Карта фаз (Mermaid), Сводка фаз (table), Правила выполнения, Следующие шаги
- Phase file naming: `NN-phase.md` (e.g., `01-phase.md`) or descriptive `NN-<name>.md` (e.g., `01-types-and-exports.md`)
- Phase file structure: `# Фаза N: <Name>`, Цель, Зависимости (Requires/Blocks), Выполнение (Sequential/Parallel), Задачи (detailed), Верификация (checklist)
- Mermaid diagrams for dependency graph and optionally Gantt for parallelization


## Scaling Rules

- For small plans (< 3 phases): planner produces all outputs in a single pass
- For large plans (> 6 phases): the stage-creator may split into 2 planner invocations — one for analysis/README.md and one for individual phase files — but this is rare
- Never exceed 2 total phases for plan stage
