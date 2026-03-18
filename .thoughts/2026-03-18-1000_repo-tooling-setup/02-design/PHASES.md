---
title: "Phases: 02-design"
date: 2026-03-18
stage: 02-design
---

# Phases: 02-design

## Phase 1: Core Architecture

- **Agent**: `rdpi-architect`
- **Output**: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

You are designing the tooling configuration architecture for the `rx-toolkit` repository. Read the following files to understand the task and research findings:

- Task: `../.thoughts/2026-03-18-1000_repo-tooling-setup/TASK.md`
- Research summary: `../.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/README.md`
- Codebase analysis: `../.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/01-codebase-analysis.md`
- External research: `../.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/02-external-research.md`
- Open questions with user decisions: `../.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/03-open-questions.md` (see "User Answers" section at the bottom — these are binding constraints)

Also read the current root configs to understand the existing setup:
- `@/tsconfig.json`
- `@/vitest.config.ts`
- `@/package.json`
- `@/apps/demos/package.json`
- `@/apps/demos/tsconfig.json`
- `@/apps/demos/vite.config.ts`

**User decisions that MUST be respected (from research Q&A):**
- Import sorting: Prettier plugin (`@ianvs/prettier-plugin-sort-imports`) — NOT ESLint
- Vitest typing: `tsconfig.test.json` with `"types": ["vitest/globals"]`
- ESLint format: `eslint.config.ts` with `jiti` devDependency
- Linting scope: Separate ESLint configs for `src/` and `apps/demos/`
- Quote style: Double quotes (Prettier default)
- Tab width: 4 spaces (keep current)
- Print width: 120
- `.editorconfig`: Yes, add it
- Formatting scope: `src/` only (exclude `apps/demos/` via `.prettierignore`)
- AI instructions: Single file with `applyTo: "apps/demos/**"`
- Discretionary decisions (Q5, Q8, Q9, Q10): You decide based on research findings and best practices

Produce four output files in the `02-design/` stage directory:

**01-architecture.md** — Tooling Configuration Architecture:
- Complete file tree of all new/modified config files with their locations
- Config file layout: which files go at root, which in `apps/demos/`
- Tool selection summary (Prettier, ESLint, vitest types, editorconfig)
- Dependency inventory: all new npm packages with versions and purpose
- Each config file's high-level structure (sections, presets, overrides)
- Relationship between the two ESLint configs (shared base? independent?)
- How `tsconfig.test.json` relates to the main `tsconfig.json` (extends? independent?)
- Mermaid C4 component diagram showing config files and their relationships
- Mermaid diagram showing the file tree of new/modified files

**02-dataflow.md** — Tool Interaction & Developer Workflow:
- How Prettier and ESLint interact (formatting vs. linting boundaries, `eslint-config-prettier` needed?)
- How the Prettier import sorting plugin interacts with ESLint (no `simple-import-sort`, but ESLint may still have import-related rules?)
- Editor integration flow: what happens when a developer saves a file (Prettier format-on-save → ESLint fix-on-save? Or just Prettier?)
- CI flow: recommended lint/format check commands (`prettier --check`, `eslint .`, `tsc --noEmit`)
- Mermaid sequence diagram: developer saves a file → tools run
- Mermaid sequence diagram: CI pipeline checks

**03-model.md** — Configuration Specifications:
- Exact content specification for each config file:
  - `.prettierrc` (or `.prettierrc.json`): all options with values and rationale
  - `.prettierignore`: exact patterns
  - `.editorconfig`: sections and values
  - `tsconfig.test.json`: full content specification
  - Root `eslint.config.ts`: structure, presets, plugins, custom rules, file patterns
  - `apps/demos/eslint.config.ts`: structure, presets, additional plugins (React, JSX), file patterns
- Import sort order configuration for the Prettier plugin: exact `importOrder` array with regex patterns for the required grouping (external → `@/` aliases → `../` relative → `./` local)
- `package.json` script additions (`lint`, `format`, `format:check`, `typecheck`)

**04-decisions.md** — Architecture Decision Records:
- ADR-1: Import sorting tool choice (Prettier plugin) — rationale from user decision, consequences
- ADR-2: Separate ESLint configs for src/ and apps/demos/ — rationale, shared base strategy
- ADR-3: Formatting scope (src/ only) — rationale, consequences for apps/demos/
- ADR-4: Initial formatting migration strategy (decide Q5 — recommend `.git-blame-ignore-revs` per research)
- ADR-5: ESLint preset level (decide Q8 — recommend `strict` without `stylistic` per research)
- ADR-6: `eslint-plugin-import-x` inclusion (decide Q9)
- ADR-7: `@testing-library/jest-dom` disposition (decide Q10)
- ADR-8: tsconfig.test.json strategy (global types for vitest)
- Each ADR must follow: Status, Context, Options (with pros/cons), Decision, Consequences
- Each ADR must cite specific research findings with relative links to `../01-research/` documents

All design choices must reference research findings via relative links. Use Mermaid diagrams where specified. Keep diagrams under 15-20 elements.

---

## Phase 2: Use Cases & Documentation Impact

- **Agent**: `rdpi-architect`
- **Output**: `05-usecases.md`, `07-docs.md`
- **Depends on**: 1
- **Retry limit**: 2

### Prompt

You are designing developer use cases and documentation impact for the `rx-toolkit` repository tooling setup. Read:

- Task: `../.thoughts/2026-03-18-1000_repo-tooling-setup/TASK.md`
- Research open questions (User Answers section): `../.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/03-open-questions.md`
- Architecture from Phase 1: `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/01-architecture.md`
- Dataflow from Phase 1: `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/02-dataflow.md`
- Config specs from Phase 1: `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/03-model.md`
- Decisions from Phase 1: `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/04-decisions.md`
- Codebase analysis (for demos structure): `../.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/01-codebase-analysis.md`

Produce two output files in the `02-design/` stage directory:

**05-usecases.md** — Developer Use Cases & Migration:

*Use Cases (with TypeScript/config code examples where applicable):*
1. **Adding a new test file** — how vitest globals typing works with `tsconfig.test.json`, what a developer does (nothing special — just write tests, globals are typed)
2. **Running linting** — commands for src/ and apps/demos/ separately, expected output
3. **Running formatting** — commands, format-on-save setup
4. **Adding a new import** — how auto-sorting works with the Prettier plugin on save
5. **Adding a new page to apps/demos/** — reference the AI instruction file for guidance; briefly describe the workflow
6. **CI check failure** — what a developer does when CI reports lint/format errors

*Migration Paths:*
7. **Initial formatting migration** — step-by-step: run Prettier on src/, commit, add to `.git-blame-ignore-revs`, configure git locally
8. **Vitest import removal** — step-by-step: create `tsconfig.test.json`, remove explicit vitest imports from all test files (can be automated with a codemod or find-and-replace), verify tests still pass
9. **`@testing-library/jest-dom` disposition** — removal or setup steps (per ADR-7 decision)

*Edge Cases:*
10. Generated files, `coverage/`, `node_modules/`, `dist/` — how they're excluded from both Prettier and ESLint
11. MDX files in apps/demos/ — how ESLint and Prettier handle them (or don't)
12. Path alias `@/` in ESLint — how TypeScript resolver handles it for the separate configs

*AI Instruction File:*
13. **Content specification for the apps/demos AI instruction file** — define the exact structure and content topics the `.github/instructions/demos.instructions.md` file should cover:
    - How to add a new page (MDX file + route in router config + navbar entry)
    - How to add a new example to an existing page (raw import + scope object)
    - How to add external entities (rx-toolkit exports) to the sandbox scope
    - Project structure overview for apps/demos/
    - Use the codebase analysis findings about the demos structure
    - This is a CONTENT SPECIFICATION — describe WHAT the instruction file should contain, not the file itself (implementation is for the plan/implement stages)

**07-docs.md** — Documentation Impact:

WARNING: Keep this file SHORT and focused. Only list high-impact documentation changes. This is a tooling setup, not a feature with API docs.

- What needs to be added/updated in `docs/CONTRIBUTING.md`: new "Development Tools" section covering lint/format commands, editor setup recommendations, `.git-blame-ignore-revs` note
- Whether `README.md` needs any changes (probably no — tooling is internal)
- Any `package.json` `scripts` section documentation (if scripts are self-documenting via names, no extra docs needed)
- Do NOT write the documentation content itself — only specify WHAT topics need coverage and WHERE

---

## Phase 3: QA Strategy & Risks

- **Agent**: `rdpi-qa-designer`
- **Output**: `06-testcases.md`, `08-risks.md`
- **Depends on**: 1, 2
- **Retry limit**: 1

### Prompt

You are designing the QA strategy and risk analysis for the `rx-toolkit` repository tooling setup. Read:

- Task: `../.thoughts/2026-03-18-1000_repo-tooling-setup/TASK.md`
- Architecture: `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/01-architecture.md`
- Dataflow: `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/02-dataflow.md`
- Config specs: `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/03-model.md`
- Decisions: `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/04-decisions.md`
- Use cases & migration: `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/05-usecases.md`
- Research findings: `../.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/README.md`

Produce two output files in the `02-design/` stage directory:

**06-testcases.md** — Verification Test Cases:

This is a tooling/config task, not a software feature. "Test cases" here mean verification steps — how to confirm each tool is correctly configured and working.

Use this table format:
| ID | Category | Description | Verification Command / Step | Expected Output | Priority |
|----|----------|-------------|----------------------------|-----------------|----------|

Categories:
- **Vitest Typing**: Verify `tsconfig.test.json` works, globals are typed, no explicit imports needed, `tsc --noEmit` passes on test files
- **ESLint (src/)**: Verify root config loads, parses TypeScript, applies preset rules, catches a known violation, auto-fix works
- **ESLint (demos/)**: Verify demos config loads independently, handles JSX/React, doesn't conflict with root config
- **Prettier**: Verify formatting works with configured options (4 spaces, double quotes, 120 width), import sorting groups correctly (external → @/ → ../ → ./), `.prettierignore` excludes apps/demos/
- **EditorConfig**: Verify file is applied by editors (manual check)
- **Integration**: Verify Prettier and ESLint don't conflict (no rule clashes), format + lint pipeline works end-to-end
- **Migration**: Verify initial formatting pass completes, `.git-blame-ignore-revs` works, vitest import removal doesn't break tests
- **AI Instructions**: Verify instruction file has correct `applyTo` pattern, content covers required workflows

Aim for 15-25 test cases. Prioritize: P0 = blocks usage, P1 = important, P2 = nice to have.

**08-risks.md** — Risk Analysis:

Use this table format:
| ID | Risk | Probability | Impact | Strategy | Mitigation |
|----|------|-------------|--------|----------|------------|

Consider risks in these areas:
- Tool conflicts (Prettier + ESLint, import sorting clashes)
- Migration risks (formatting pass breaks something, vitest import removal misses edge cases)
- Dependency risks (jiti compatibility, Prettier plugin stability, ESLint flat config ecosystem maturity)
- Developer experience risks (slow lint times, confusing error messages, editor integration issues)
- Scope risks (separate ESLint configs diverging over time, apps/demos/ having no formatting enforcement)
- CI risks (commands fail in CI environment, Node.js version incompatibility for eslint.config.ts)

For each High-impact risk, provide a detailed mitigation plan (2-3 sentences, actionable).

Aim for 10-15 risks.

---

## Phase 4: Design Review

- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 1, 2, 3
- **Retry limit**: 2

### Prompt

You are reviewing the complete design for the `rx-toolkit` repository tooling setup. Read ALL design documents:

- `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/01-architecture.md`
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/02-dataflow.md`
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/03-model.md`
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/04-decisions.md`
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/05-usecases.md`
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/06-testcases.md`
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/07-docs.md`
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/08-risks.md`

Also read research documents for traceability verification:
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/README.md`
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/01-codebase-analysis.md`
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/03-open-questions.md` (especially "User Answers" section)

Review criteria:

1. **Research traceability** — Every design decision must trace back to a research finding or user answer. Check that ADRs in `04-decisions.md` cite research documents. Verify that user decisions from Q1-Q14 are correctly reflected (especially: Prettier plugin for imports, separate ESLint configs, 4-space tabs, 120 printWidth, src/-only formatting, single AI instruction file).

2. **Internal consistency** — No contradictions between design documents. Architecture file layout matches config specs in model. Dataflow diagrams match the tool choices in architecture. Use cases reference correct commands from dataflow. Test cases cover all use case scenarios.

3. **Completeness** — All four task areas covered (test typing, linting, formatting, AI instructions). All discretionary decisions (Q5, Q8, Q9, Q10) have ADRs. Migration paths defined. Verification criteria exist for every component.

4. **Feasibility** — Config specifications are technically valid (correct option names, valid ESLint flat config syntax patterns, correct Prettier plugin configuration). Dependency versions are compatible. No circular dependencies between configs.

5. **Mermaid conformance** — Diagrams are titled, under 15-20 elements, syntactically valid.

6. **Docs proportionality** — `07-docs.md` is short and focused. No implementation details in docs spec. Describes WHAT, not HOW.

7. **ADR completeness** — Each ADR has Status, Context, Options, Decision, Consequences. No missing sections.

8. **Test-risk coverage** — Every high-impact risk in `08-risks.md` has a corresponding test case in `06-testcases.md`. Test cases cover the critical migration paths.

9. **No implementation code** — Design documents describe structure and specifications, not actual config file contents ready to copy-paste. Config model (03-model.md) may include option specifications but should not be a complete implementation.

10. **Research open questions addressed** — All 14 open questions from research have been addressed (either by user decision or by design-stage ADR for discretionary items).

Update `README.md` in the `02-design/` directory with:
- Overview (1-2 sentences)
- Goals and Non-Goals
- Documents list with links to all 8 design files
- Key Decisions summary (one-line per ADR)
- Quality Review checklist table (the 10 criteria above with PASS/FAIL/PARTIAL and notes)
- Issues Found (numbered, with severity and location)
- Next Steps

---

# Redraft Round 1

## Phase 5: Fix issues #1, #3

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `03-model.md`
- **Depends on**: 1, 2, 3, 4
- **Retry limit**: 2
- **Review issues**: #1, #3

### Prompt

Read REVIEW.md at `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/REVIEW.md`.
Your assigned issues: #1, #3.
Affected files:
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/01-architecture.md`
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/03-model.md`

**Issue #1** — Inconsistency between architecture and model on test file linting strategy.
Read both `01-architecture.md` (section 5, `eslint.config.ts (root)` structure list) and `03-model.md` (section 5, root ESLint config). The model puts test files (`**/*.test.ts`, `src/__tests__/**`) into ESLint global `ignores` (not linted), while architecture describes "Test file overrides: relaxed rules". These are contradictory.

Choose the best approach by comparing the two:
- **Option A (model's approach)**: Test files in global `ignores` — not linted. Simpler, avoids rule configuration for test files. Rationale: test files already have vitest type-checking via `tsconfig.test.json`; linting adds marginal value.
- **Option B (architecture's approach)**: Test files linted with relaxed rules (e.g., `no-explicit-any` off). More thorough but adds configuration complexity.

Pick whichever approach is more sound for this project (a TypeScript library with vitest tests), then update BOTH documents to be consistent. If you pick Option A, update `01-architecture.md` section 5 to remove "Test file overrides" and add test patterns to the ignores description. If you pick Option B, update `03-model.md` section 5 to replace global ignores with relaxed test overrides.

User feedback: "Решить несоответствие — выбрать лучший подход и привести документы в соответствие."

**Issue #3** — Model contains near-complete implementation code.
Add a brief note at the top of `03-model.md` (right after the frontmatter/overview section) stating that the configuration examples are illustrative specifications and may be adjusted during implementation. Something like: "> **Note:** The configurations below are illustrative design specifications. Exact contents may be adjusted during the implementation stage." Do not restructure or remove the existing config specs — they are acceptable for a config-focused task.

User feedback: "Добавить пометку, что конфиги носят наглядный/примерный характер и могут быть скорректированы при имплементации."

**Issue #2** is deferred — no action needed. The `eslint-config-prettier` import path will be verified during implementation.

Fix only your assigned issues. Do not modify any other files or content.

---

## Phase 6: Re-review after Redraft Round 1

- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 5
- **Retry limit**: 2

### Prompt

Read REVIEW.md at `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/REVIEW.md` to understand what issues were raised.

Re-verify the files modified in Redraft Round 1:
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/01-architecture.md`
- `../.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/03-model.md`

Check specifically:
1. **Issue #1 resolved**: Architecture and model are now consistent regarding test file linting strategy. Whichever approach was chosen, both documents must agree. No contradictions remain.
2. **Issue #3 resolved**: `03-model.md` has a note at the top clarifying that configs are illustrative and may be adjusted during implementation.
3. **No regressions**: The fixes did not introduce new inconsistencies with other design documents (`02-dataflow.md`, `04-decisions.md`, `05-usecases.md`, `06-testcases.md`). Spot-check that test-related use cases and test cases still align with the chosen approach.
4. **Issue #2 (deferred)**: Confirm it is noted as an implementation-time verification item. No changes expected.

Update `README.md` in the `02-design/` directory:
- Update the Quality Review checklist: set items #7 and #10 to reflect resolved status.
- Update the "Issues Found" section to note which issues are resolved and which are deferred.
- Update "Next Steps" to indicate readiness for Plan stage (if all issues resolved).

---
