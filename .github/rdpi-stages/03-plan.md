# Stage: 03-Plan

Plan stage decomposes the approved design into an actionable, phased implementation plan. Does NOT introduce new design decisions.


## Available Roles

| Role | Agent | Description | Default Limit |
|------|-------|-------------|---------------|
| Planner | `rdpi-planner` | Analyzes design, maps components to concrete file changes, builds phased plan with dependencies and verification | max 1 invocation, retry 2 |
| Plan Reviewer | `rdpi-plan-reviewer` | Reviews plan for design traceability, task concreteness, file path validity, adds Quality Review to README.md | max 1 invocation, retry 2 |


## Typical Phase Structure

| Phase | Agent | Outputs | Depends on | Parallelizable |
|-------|-------|---------|------------|----------------|
| 1 | `rdpi-planner` | `README.md`, `01-phase.md` ... `NN-phase.md` | — | No |
| 2 | `rdpi-plan-reviewer` | Updates `README.md` (adds Quality Review) | 1 | No |

Phase 1 produces the entire plan atomically. Phase 2 reviews and adds Quality Review to README.md.


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


### Phase 2 — Plan Review

The prompt MUST specify:
- Paths to ALL plan files: README.md and all NN-phase.md files in the stage directory
- Path to design README.md (`../02-design/README.md`) for traceability check
- Review criteria:
  1. Every design component is mapped to at least one plan task
  2. File paths are concrete and verified (not placeholders)
  3. Dependencies between phases are correct
  4. Each phase has verification criteria
  5. No vague tasks — all tasks specify exact changes
  6. Each task references the design section it implements
  7. Documentation tasks proportional to existing docs/demos
- Update README.md: add `## Quality Review` section, set status to `Draft`


## Output Conventions

- Frontmatter fields: phase outputs use (title, date, stage, role); README.md uses (title, date, status, feature, research, design)
- README.md structure: Overview, Phase Map (Mermaid), Phase Summary (table), Execution Rules, Next Steps. Quality Review section is added by the reviewer.
- Phase file naming: `NN-phase.md` (e.g., `01-phase.md`) or descriptive `NN-<name>.md` (e.g., `01-types-and-exports.md`)
- Phase file structure: frontmatter, Goal, Dependencies (Requires/Blocks), Execution (Sequential/Parallel), Tasks (detailed), Verification (checklist)
- Mermaid diagrams for dependency graph and optionally Gantt for parallelization


## Scaling Rules

- For small plans (< 3 phases): planner produces all outputs in a single pass
- For large plans (> 6 phases): the stage-creator may split into 2 planner invocations — one for analysis/README.md and one for individual phase files — but this is rare
- Never exceed 3 total phases for plan stage (planner + optional split + reviewer)
