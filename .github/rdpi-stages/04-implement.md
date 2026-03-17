# Stage: 04-Implement

Implement stage executes the approved plan. Code changes must precisely follow the plan — no deviations, no extra features, no unrelated refactoring.


## Available Roles

| Role | Agent | Description | Default Limit |
|------|-------|-------------|---------------|
| Coder | `rdpi-codder` | Implements code changes according to plan phase tasks | max 1 invocation per plan phase, retry 2 |
| Tester | `rdpi-tester` | Runs verification for completed phases, saves report to `verification-<N>.md` | max 1 invocation per plan phase, retry 1 |
| Implementation Reviewer | `rdpi-implement-reviewer` | Reviews all changes, creates implementation record README.md | max 1 invocation, retry 2 |


## Typical Phase Structure

The number of implement phases is derived from the plan. For each plan phase:

| Phase | Agent | Output | Depends on |
|-------|-------|--------|------------|
| N.1 | `rdpi-codder` | Code changes for plan phase N | Previous plan phase completion |
| N.2 | `rdpi-tester` | `verification-N.md` (in stage directory) | N.1 |
| Final | `rdpi-implement-reviewer` | `README.md` (implementation record) | All N.1 + N.2 |

Each plan phase becomes a code → test pair. The tester saves a verification report to `verification-<N>.md` in the `04-implement/` directory. The reviewer runs once at the end, reading all verification files.


## Phase Prompt Guidelines

### Phase N.1 — Code Implementation (per plan phase)

The prompt MUST specify:
- Path to the specific plan phase file: `../03-plan/NN-phase.md`
- Path to relevant design documents (architecture, model, dataflow)
- Instructions:
  1. Read the phase plan fully
  2. Implement each task in order
  3. Follow existing code patterns precisely (naming, indentation, barrel exports, `@/` alias)
  4. Update `index.ts` barrel exports when adding new files
  5. Maintain TypeScript strict mode compatibility
  6. Do NOT modify files outside the current phase scope
- Error handling:
  - If `ts-check` fails after implementation: fix within phase scope (max 2 attempts)
  - If unfixable: document the issue and continue

### Phase N.2 — Verification (per plan phase)

The prompt MUST specify:
- What was implemented (reference the coder's phase)
- Run the verification checklist from the plan phase file:
  - `npm run ts-check`
  - Any phase-specific behavioral checks
  - API consistency checks
- Report format: pass/fail per check, error details if failed
- Save verification report to `04-implement/verification-<N>.md` (or `verification-<lowest-N>-<highest-N>.md` for grouped phases) — the implement-reviewer reads these files
- If tests fail: report to orchestrator (do not attempt fixes — that's the coder's job on retry)

### Final Phase — Implementation Review

The prompt MUST specify:
- Paths to ALL plan phases and their implemented changes
- Paths to research + design documents for traceability
- Path to verification files: `04-implement/verification-*.md`
- Write `README.md` in `04-implement/`, replacing the stage-creator's placeholder, with:
  - Implementation record: date, status, plan link
  - Phase completion status (N/N)
  - Verification results summary
  - Quality review checklist: all plan phases implemented, verification passed, no out-of-scope files modified, code follows project patterns, barrel exports correct, TypeScript strict mode, docs proportional, no security vulnerabilities
  - List of all changed files
  - Post-implementation recommendations (build, manual testing areas)
  - Recommended commit message (conventional commits format)


## Output Conventions

- Frontmatter fields: phase outputs use (title, date, stage, role); README.md uses (title, date, status, feature, plan)
- Implementation record README.md structure: Status, Quality Review (Checklist + Documentation Proportionality + Issues Found), Post-Implementation Recommendations, Change Summary, Recommended Commit Message
- Code style: match existing codebase exactly (read neighbor files for reference)
- Use `@/*` path alias for imports within `src/`


## Scaling Rules

- For phases with only type changes: tester phase can be reduced to `ts-check` only
- For large plans (> 5 plan phases): consider grouping independent plan phases into a single coder invocation if they are parallelizable per the plan. The corresponding tester verifies all grouped phases and saves a report named `verification-<lowest-N>-<highest-N>.md` (e.g., `verification-2-3.md`)
- Never exceed 2× (number of plan phases) + 1 total phases for implement stage
