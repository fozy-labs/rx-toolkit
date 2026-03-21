---
title: "Phases: 01-research"
date: 2026-03-18
stage: 01-research
---

# Phases: 01-research

## Phase 1: Codebase Analysis

- **Agent**: `rdpi-codebase-researcher`
- **Output**: `01-codebase-analysis.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

You are researching the `rx-toolkit` repository to gather facts for configuring development tooling: test typing, linting, formatting, and AI instructions for `apps/demos/`.

Read the task description at `.thoughts/2026-03-18-1000_repo-tooling-setup/TASK.md`.

Investigate the following areas and document ONLY facts — no solutions, no opinions.

**1. Test typing setup**
- Read `tsconfig.json` (root) — note how test files are excluded, what `compilerOptions` are set.
- Read `vitest.config.ts` — note `globals: true` and any type implications.
- Read `src/__tests__/setup.ts` — what is imported/configured there.
- Check if any `tsconfig.test.json` or test-specific TS config exists.
- Sample 2–3 test files (e.g., `src/query/SKIP_TOKEN.test.ts`, find others in `src/signals/` or `src/common/`) — document which vitest globals are used (`describe`, `it`, `expect`, `vi`, `beforeEach`, etc.) and any `@testing-library` imports.
- Check whether `@vitest/globals` or similar type packages are in `package.json` devDependencies.

**2. Linting status**
- Confirm no `.eslintrc.*`, `eslint.config.*`, or `.eslintignore` files exist.
- Check `package.json` for any eslint-related dependencies or scripts.
- Document the tech stack that linting must cover: TypeScript (check version in `package.json`), React (check usage in `src/`), RxJS, path aliases (`@/*`).
- List all `devDependencies` and `peerDependencies` from root `package.json`.
- Check `apps/demos/package.json` for its own dependencies and config.

**3. Formatting status**
- Confirm no `.prettierrc`, `prettier.config.*`, or `.editorconfig` files exist.
- Sample 5–6 source files across different modules (`src/signals/`, `src/query/`, `src/common/`, `src/query-v2/`, `apps/demos/src/`) — document current formatting conventions: indent style/size, quote style, trailing commas, semicolons, line length patterns.
- Document import ordering patterns in those same files: are imports grouped? What order? Are there blank lines between groups?

**4. `apps/demos/` structure**
- Read `apps/demos/package.json`, `apps/demos/tsconfig.json`, `apps/demos/vite.config.ts`.
- List contents of `apps/demos/src/app/`, `apps/demos/src/pages/`, `apps/demos/src/components/`, `apps/demos/src/examples/`, `apps/demos/src/utils/`.
- Read 2–3 page files and 2–3 example files to understand the pattern for adding new pages and examples.
- Document how routing works (if any), how pages reference examples, and how external entities (from the main `src/`) are imported into the sandbox.

**5. Existing `.github/instructions/` content**
- Read `.github/instructions/thoughts-workflow.instructions.md` — document its structure as a reference for the AI instructions format.
- List any other instruction files under `.github/`.

Write all findings to `01-codebase-analysis.md` in the stage directory. Use `@/` alias for source file paths. Organize by the 5 sections above. Include file path references for every claim.

---

## Phase 2: External Research

- **Agent**: `rdpi-external-researcher`
- **Output**: `02-external-research.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are researching ecosystem best practices for configuring development tooling in a TypeScript + React + RxJS monorepo-like project. The repository uses vitest 4.x, TypeScript 5.9, React 19, and has path aliases (`@/*`).

Read the task description at `.thoughts/2026-03-18-1000_repo-tooling-setup/TASK.md`.

Research the following areas. For each finding, annotate confidence level (High/Medium/Low). Cross-reference claims across multiple sources. Separate established practices from opinions.

**1. Vitest test typing**
- How to properly type vitest globals (`describe`, `it`, `expect`, `vi`) in TypeScript projects.
- Options: `/// <reference types="vitest/globals" />` in a `.d.ts` file vs. adding `vitest/globals` to `tsconfig compilerOptions.types` vs. separate `tsconfig.test.json`. Document trade-offs of each approach.
- How `@testing-library/jest-dom` matchers integrate with vitest types.
- Are there any known issues with vitest 4.x typing?

**2. ESLint for TypeScript + React**
- Current state of ESLint: flat config (eslint.config.js) vs. legacy (.eslintrc). Which is recommended for new setups in 2026?
- Popular preset packages: `@eslint/js`, `typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-import` (or `eslint-plugin-import-x`). Document what each provides.
- How to handle path alias resolution (`@/*`) in import rules.
- Recommended rule sets for a library project (not an app).
- How to configure different rules for test files vs. source files.

**3. Prettier + import sorting**
- Prettier configuration best practices for TypeScript/React projects.
- Import sorting plugins: `@trivago/prettier-plugin-sort-imports`, `prettier-plugin-organize-imports`, `@ianvs/prettier-plugin-sort-imports`, `eslint-plugin-simple-import-sort`. Compare capabilities, maintenance status, popularity.
- How to configure the specific import group order: external → `@/` aliases → `../` relative → `./` local, with alphabetical sorting within groups.
- Prettier vs. ESLint for import sorting — trade-offs.
- How Prettier and ESLint coexist without conflicts (`eslint-config-prettier`).

**4. AI instruction files for VS Code**
- What formats does VS Code / GitHub Copilot support for `.github/instructions/` files?
- The `applyTo` pattern mechanism — how does glob matching work?
- Best practices for structuring instruction files: length, scope, specificity.

Write all findings to `02-external-research.md` in the stage directory. Organize by the 4 sections above. Include source URLs where possible. Mark each finding with a confidence level.

---

## Phase 3: Open Questions

- **Agent**: `rdpi-questioner`
- **Output**: `03-open-questions.md`
- **Depends on**: 1, 2
- **Retry limit**: 1

### Prompt

You are synthesizing open questions and trade-offs for configuring repository development tooling (test typing, linting, formatting, AI instructions for apps/demos) in the `rx-toolkit` repository.

Read the task description at `.thoughts/2026-03-18-1000_repo-tooling-setup/TASK.md`.

Read the research outputs:
- `.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/01-codebase-analysis.md`
- `.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/02-external-research.md`

Based on these findings, generate questions covering:

1. **Technical constraints**: What TypeScript or tooling version constraints affect our choices? Does the `globals: true` vitest config create any typing conflicts?
2. **Tool selection trade-offs**: Which import sorting approach (Prettier plugin vs. ESLint plugin)? Which ESLint preset combination? Flat config vs. legacy?
3. **Scope boundaries**: Should linting/formatting apply to `apps/demos/` as well or only `src/`? Should there be separate ESLint configs? How should test files be typed — global `.d.ts` or `tsconfig.test.json`?
4. **Integration risks**: How do the chosen tools interact? ESLint + Prettier conflicts? Import sorting in both tools?
5. **Migration impact**: The repo currently has no linting or formatting. How to handle the initial formatting pass without polluting git history?

For each question provide:
- **Context**: why this question matters
- **Options**: possible answers (if applicable)
- **Risks**: what could go wrong
- **Recommendation**: your best assessment based on the research (clearly labeled as recommendation, not decision)
- **Priority**: High / Medium / Low

Write to `03-open-questions.md` in the stage directory. Classify questions by priority. Number all questions sequentially.

---

## Phase 4: Research Review

- **Agent**: `rdpi-research-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 1, 2, 3
- **Retry limit**: 2

### Prompt

You are reviewing and synthesizing the research outputs for the "Repository Tooling Setup" feature.

Read all phase outputs:
- `.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/01-codebase-analysis.md`
- `.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/02-external-research.md`
- `.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/03-open-questions.md`

Also read the original task at `.thoughts/2026-03-18-1000_repo-tooling-setup/TASK.md`.

Update `.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/README.md` with:

1. **Summary** — 3–5 sentences covering what was researched and the main findings.
2. **Documents** — links to all phase output files with brief descriptions.
3. **Key Findings** — 5–7 bullet points of the most important facts discovered.
4. **Contradictions and Gaps** — any conflicts between codebase state and best practices, or areas where research was insufficient.
5. **Quality Review** — verify the following checklist:
   - [ ] All phase output files exist and are non-empty
   - [ ] File path references use `@/` alias and are accurate
   - [ ] External research findings have confidence levels annotated
   - [ ] External research includes source attribution
   - [ ] Open questions have priority levels and recommendations
   - [ ] No solutions or implementation decisions are proposed (research only)
   - [ ] Frontmatter is correct in all files
   - [ ] Claims in codebase analysis can be cross-referenced with external research
6. **Next Steps** — what the design stage should address based on research findings.

Preserve the existing README.md frontmatter (title, date, feature, rdpi-version). Set `status` to the appropriate value based on your quality assessment: `Done` if all checklist items pass, `Needs Review` if there are issues.

---
