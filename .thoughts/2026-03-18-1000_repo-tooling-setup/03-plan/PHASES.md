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

You are planning the implementation of repository development tooling for `rx-toolkit`. The approved design specifies four tooling areas with ~10 new/modified files and two migration steps.

**Read these documents before planning:**

- Task description: `../TASK.md`
- Research summary: `../01-research/README.md`
- Design README (overview + key decisions): `../02-design/README.md`
- Architecture (file tree, dependencies, config structures): `../02-design/01-architecture.md`
- Data flow (tool interactions, developer workflow, CI flow): `../02-design/02-dataflow.md`
- Config specifications (illustrative configs — may adjust during implementation): `../02-design/03-model.md`
- ADRs (8 decisions): `../02-design/04-decisions.md`
- Use cases & migration paths: `../02-design/05-usecases.md`
- Verification test cases (25 cases): `../02-design/06-testcases.md`
- Documentation impact: `../02-design/07-docs.md`
- Risks (14 risks with mitigations): `../02-design/08-risks.md`

**Analysis requirements (do before writing any plan files):**

1. Map every design component to concrete files (create/modify/delete). The design identifies these files:
   - **New**: `.editorconfig`, `.prettierrc`, `.prettierignore`, `.git-blame-ignore-revs`, `tsconfig.test.json`, `eslint.config.ts` (root), `apps/demos/eslint.config.ts`, `.github/instructions/demos.instructions.md`
   - **Modified**: `package.json` (root — devDependencies + scripts), `apps/demos/package.json` (devDependencies), `docs/CONTRIBUTING.md`
   - **Delete/modify**: remove `@testing-library/jest-dom` from root devDependencies; remove vitest explicit imports from all test files in `src/`
2. Identify dependencies between changes — e.g., `package.json` deps must be installed before ESLint/Prettier configs can be tested; `tsconfig.test.json` must exist before vitest imports can be removed
3. Determine which tasks can run in parallel vs. must be sequential
4. Estimate per-task complexity (Low/Medium/High)
5. Define per-phase verification criteria — every phase must include at minimum a compilability check (`npm run ts-check`)
6. **Verify ALL file paths against the actual repository** — use search to confirm files exist before referencing them. Specifically verify: `package.json`, `tsconfig.json`, `vitest.config.ts`, `apps/demos/package.json`, `apps/demos/tsconfig.json`, `docs/CONTRIBUTING.md`, and the existing test files that need vitest import removal

**Key design decisions to respect (do NOT change these):**

- Test files in global ESLint ignores (not linted) — `02-design/01-architecture.md` section 5
- `eslint-config-prettier` import path (`eslint-config-prettier/flat`) to be verified during implementation — `02-design/README.md` issue #2
- Configs in model are illustrative — may need adjustment during implementation
- `@ianvs/prettier-plugin-sort-imports` for import sorting (ADR-1)
- `eslint.config.ts` with `jiti` for both configs (ADR-2, verified in research Q3)
- Separate ESLint configs for `src/` and `apps/demos/` (ADR-2)
- Formatting scope: `src/` only (ADR-3)
- `tsconfig.test.json` extends root tsconfig (ADR-8)
- Remove `@testing-library/jest-dom` (ADR-7)
- Single formatting commit with `.git-blame-ignore-revs` (ADR-4)
- `strict` preset for root ESLint, `recommended` for demos (ADR-5)
- Skip `eslint-plugin-import-x` (ADR-6)
- AI instruction file: `.github/instructions/demos.instructions.md` with `applyTo: "apps/demos/**"` — content spec in `02-design/05-usecases.md` UC-13

**Output structure:**

Produce these files in the `03-plan/` directory:

1. **README.md** — update the existing README.md with:
   - Phase Map: Mermaid dependency graph showing phase execution order
   - Phase Summary: table with columns (Phase, Name, Description, Dependencies, Parallelizable, Complexity)
   - Execution Rules: sequential vs. parallel constraints, compilability invariant
   - Next Steps: what happens after plan approval

2. **Individual `NN-phase.md` files** — one per implementation phase. Each file must contain:
   - Frontmatter (title, date, stage, role)
   - **Goal**: what this phase accomplishes
   - **Dependencies**: Requires (prior phases) / Blocks (subsequent phases)
   - **Execution**: Sequential or Parallel annotation
   - **Tasks**: numbered list, each task specifying:
     - Exact file path (verified against repo)
     - Action: Create / Modify / Delete
     - Detailed description of what to do (not just "create config file" — specify what goes in it, referencing design sections)
     - Design reference: which design document section this implements
   - **Verification**: checklist of commands/checks to run after this phase

**Constraints:**

- Every phase must leave the project in a compilable state (`npm run ts-check` must pass)
- No vague tasks — every task specifies exact files and concrete changes
- The initial Prettier formatting pass (migration UC-7) and vitest import removal (migration UC-8) are distinct steps that should happen AFTER their respective config files are in place
- The `.git-blame-ignore-revs` file is created empty initially, then updated with the formatting commit SHA after the formatting pass
- `docs/CONTRIBUTING.md` update should happen after all tooling is configured so the documented commands are accurate
- The AI instruction file (`demos.instructions.md`) is independent of the other tooling — it can be planned as a parallel phase
- Include `apps/demos/` impact: its `package.json` needs new devDependencies, and it gets its own `eslint.config.ts`
- Do not split trivial changes into separate phases — group related small tasks together

---

## Phase 2: Plan Review

- **Agent**: `rdpi-plan-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 1
- **Retry limit**: 2

### Prompt

Review the implementation plan for the repository tooling setup feature. The plan decomposes the approved design into phased implementation tasks.

**Read these files:**

- Plan README: `./README.md`
- All plan phase files: list the `03-plan/` directory and read all `NN-*.md` files
- Design README: `../02-design/README.md`
- Architecture: `../02-design/01-architecture.md`
- Config specifications: `../02-design/03-model.md`
- Use cases & migration: `../02-design/05-usecases.md`
- Test cases: `../02-design/06-testcases.md`
- Documentation impact: `../02-design/07-docs.md`
- Risks: `../02-design/08-risks.md`

**Review criteria — check ALL of these:**

1. **Design traceability**: every design component (from `01-architecture.md` file tree — all new/modified files) is mapped to at least one plan task
2. **File path validity**: all file paths in plan tasks are concrete and verified against the actual repo (not placeholders)
3. **Dependency correctness**: phase dependencies reflect actual data flow — no phase reads an output that hasn't been produced yet. Specifically:
   - Dependencies must be installed before config files can be tested
   - `tsconfig.test.json` must exist before vitest imports are removed
   - Config files must exist before migration steps run
   - `.git-blame-ignore-revs` is created early but populated after the formatting commit
4. **Verification criteria**: each phase has a verification checklist; every phase includes `npm run ts-check` at minimum
5. **Compilability invariant**: each phase leaves the project in a compilable state
6. **Task concreteness**: no vague tasks — all tasks specify exact file paths and describe concrete changes
7. **Design references**: each task references the design section it implements (e.g., "per `02-design/03-model.md` section 4")
8. **Parallelization**: parallelizable vs. sequential tasks are correctly identified and marked
9. **Complexity estimates**: per-task or per-phase complexity estimates (Low/Medium/High) present
10. **Documentation proportionality**: documentation tasks are proportional to existing docs (per `02-design/07-docs.md` — ~15-20 lines to `CONTRIBUTING.md`)
11. **Mermaid dependency graph**: present in README.md, correctly shows phase order and dependencies
12. **Phase summary table**: complete in README.md with all required columns
13. **Migration ordering**: initial formatting pass (UC-7) and vitest import removal (UC-8) are sequenced after their respective configs are in place
14. **Risk coverage**: plan addresses high/medium risks from `02-design/08-risks.md` (R01, R02, R04, R05, R06, R07) through verification steps or explicit mitigation tasks

**After review, update `README.md`:**

Add a `## Quality Review` section at the end of README.md containing:
- Checklist table (criteria #1-14 above with PASS/FAIL/PARTIAL status and notes)
- Issues Found: numbered list of any problems (with severity: Low/Medium/High and specific locations)
- Set the `status` field in frontmatter to `Draft`

---

# Redraft Round 1

## Phase 3: Fix issue #2 — approximate line numbers in Task 5.1

- **Agent**: `rdpi-redraft`
- **Output**: `05-documentation.md`
- **Depends on**: 1, 2
- **Retry limit**: 2
- **Review issues**: #2

### Prompt

Read REVIEW.md at `./REVIEW.md`.
Your assigned issues: #2.
Affected files: `./05-documentation.md`.
Fix only your assigned issue.

The problem: Task 5.1 references "Тесты section (line ~134)" and "Соглашения section (line ~139)", but the actual lines in `docs/CONTRIBUTING.md` are:
- "## Тесты" is at line 125
- "## Соглашения" is at line 140

Update the two approximate line references in Task 5.1's description from `(line ~134)` → `(line ~125)` and `(line ~139)` → `(line ~140)`.

Do NOT change anything else in the file.

---

## Phase 4: Re-review after Redraft Round 1

- **Agent**: `rdpi-plan-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 3
- **Retry limit**: 2

### Prompt

Re-verify the file modified in Redraft Round 1: `./05-documentation.md`.

Confirm that:
1. Task 5.1 now references correct approximate line numbers for `docs/CONTRIBUTING.md` sections ("## Тесты" at line ~125, "## Соглашения" at line ~140)
2. No other content was inadvertently changed

Also confirm Issue #1 from REVIEW.md (Task 1.8 missing `[ref:]`) was intentionally ignored per user feedback — no action needed.

Update `README.md`:
- Update the `## Quality Review` section to reflect the redraft fixes (mark issue #2 as resolved, issue #1 as ignored per user feedback)
- Set frontmatter `status` to `Draft`

---
