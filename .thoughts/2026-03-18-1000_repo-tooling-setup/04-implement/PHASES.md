---
title: "Phases: 04-implement"
date: 2026-03-18
stage: 04-implement
---

# Phases: 04-implement

## Phase 1: Implement Plan Phase 1 — Foundation

- **Agent**: `rdpi-codder`
- **Output**: Code changes per ../03-plan/01-foundation.md
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Implement all tasks from plan phase 1 (Foundation — Dependencies & Base Configuration).

**Read first:**
- Plan file: `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/01-foundation.md`
- Config specifications: `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/03-model.md`
- Decisions: `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/04-decisions.md`
- Current root `package.json`
- Current `apps/demos/package.json`
- Current `tsconfig.json` (root — to understand what `tsconfig.test.json` will extend)

**Implement these tasks in order:**

1. **Task 1.1** — Modify root `package.json`:
   - Add devDependencies: `prettier` (^3.5.0), `@ianvs/prettier-plugin-sort-imports` (^4.4.0), `eslint` (^9.20.0), `@eslint/js` (^9.20.0), `typescript-eslint` (^8.25.0), `eslint-config-prettier` (^10.1.0), `jiti` (^2.4.0)
   - Remove devDependency: `@testing-library/jest-dom`
   - Add scripts: `"lint": "eslint src/"`, `"lint:fix": "eslint src/ --fix"`, `"format": "prettier --write src/"`, `"format:check": "prettier --check src/"`

2. **Task 1.2** — Modify `apps/demos/package.json`:
   - Add devDependencies: `eslint` (^9.20.0), `@eslint/js` (^9.20.0), `typescript-eslint` (^8.25.0), `eslint-plugin-react-hooks` (^5.2.0), `eslint-config-prettier` (^10.1.0), `jiti` (^2.4.0)
   - Add script: `"lint": "eslint src/"`

3. **Task 1.3** — Create `.editorconfig`:
   - `root = true`
   - `[*]`: indent_style=space, indent_size=4, end_of_line=lf, charset=utf-8, trim_trailing_whitespace=true, insert_final_newline=true
   - `[*.md]`: trim_trailing_whitespace=false
   - `[*.{json,yml,yaml}]`: indent_size=2

4. **Task 1.4** — Create `.prettierrc` (JSON):
   - `tabWidth: 4`, `printWidth: 120`
   - `plugins: ["@ianvs/prettier-plugin-sort-imports"]`
   - `importOrder`: `["<BUILTIN_MODULES>", "", "<THIRD_PARTY_MODULES>", "", "^@/(.*)", "", "^\\.\\./(.*)", "", "^\\./(.*)"]`
   - All other options at Prettier defaults (double quotes, semicolons, trailing commas "all")

5. **Task 1.5** — Create `.prettierignore`:
   - Patterns: `apps/`, `dist/`, `coverage/`, `node_modules/`, `*.md`

6. **Task 1.6** — Create `tsconfig.test.json`:
   - `"extends": "./tsconfig.json"`
   - `compilerOptions.types`: `["vitest/globals"]`
   - `compilerOptions.noEmit`: `true`
   - `include`: `["src/**/*.test.ts", "src/__tests__/**"]`
   - `exclude`: `["node_modules", "dist"]`

7. **Task 1.7** — Create `.git-blame-ignore-revs` (stub):
   - Single comment line: `# Prettier initial formatting pass` (no SHA yet)

8. **Task 1.8** — Install dependencies:
   - Run `npm install` in repository root
   - Run `cd apps/demos && npm install`
   - Verify both installs complete successfully

**Constraints:**
- Do NOT modify any files outside the scope of these tasks
- Follow existing code patterns (check neighbor files for JSON formatting style)
- After all changes, verify `npm run ts-check` passes; if it fails, fix within scope (max 2 attempts)

---

## Phase 2: Implement Plan Phase 6 — AI Instructions

- **Agent**: `rdpi-codder`
- **Output**: Code changes per ../03-plan/06-ai-instructions.md
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Implement Task 6.1 from the plan: create the AI instruction file for `apps/demos/`.

**Read first:**
- Plan file: `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/06-ai-instructions.md`
- Design use cases (UC-13): `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/05-usecases.md`
- Existing instruction file for format reference: `.github/instructions/thoughts-workflow.instructions.md`
- `apps/demos/` source structure — read these files to verify accuracy:
  - `apps/demos/src/app/App.tsx` (routing, navbar, entry structure)
  - `apps/demos/src/components/LiveExample.tsx` (scope object, import stripping)
  - `apps/demos/src/components/QueryTabs.tsx` (tabbed container)
  - `apps/demos/src/components/index.ts` (barrel exports)
  - `apps/demos/src/utils/fetches.ts` (mock API functions)
  - `apps/demos/src/examples/` — list directory, read at least one category's `index.ts`
  - `apps/demos/src/pages/` — list directory, read at least one `.mdx` file
  - `apps/demos/src/vite-env.d.ts` (type declarations)
  - `apps/demos/package.json` (tech stack, linked library)

**Create file:** `.github/instructions/demos.instructions.md`

**YAML Frontmatter:**
```yaml
---
name: "demos"
description: "Instructions for working with the rx-toolkit interactive demos app"
applyTo: "apps/demos/**"
---
```

**Required content — 6 topics:**
1. **Project Structure Overview** — tech stack (React 19, Vite, MDX, TailwindCSS v4, HeroUI, react-live), key directories (`pages/`, `examples/`, `components/`, `utils/`), entry point (`main.tsx` → `App.tsx`), linked library (`@fozy-labs/rx-toolkit` via `file:../..`), type declarations (`vite-env.d.ts`)
2. **How to Add a New Page** — create MDX in `src/pages/`, import components, add Route in App.tsx, add navbar link
3. **How to Add a New Example** — create `.tsx` in `src/examples/<category>/`, export `function Base()`, import raw in category `index.ts` with `?raw`, reference in MDX via `<LiveExample>`
4. **How to Add External Entities to Sandbox Scope** — `LiveExample.tsx` scope object, import and add to `defaultScope`
5. **Key Components** — `LiveExample` (react-live wrapper, import stripping, scope injection), `QueryTabs` (tabbed container with URL sync)
6. **Mock Utilities** — `utils/fetches.ts`, mock API pattern (hardcoded data + Promise + setTimeout)

**Constraints:**
- Content must be accurate to the actual codebase — verify by reading the source files listed above
- Follow the format/style of the existing instruction file
- Do NOT modify any other files

---

## Phase 3: Verify Plan Phases 1 + 6

- **Agent**: `rdpi-tester`
- **Output**: `verification-1-6.md`
- **Depends on**: 1, 2
- **Retry limit**: 1

### Prompt

Verify the implementation of plan phases 1 (Foundation) and 6 (AI Instructions). Run all checks from both verification checklists and save the report.

**Read first:**
- Plan Phase 1 verification checklist: `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/01-foundation.md` (§ Verification)
- Plan Phase 6 verification checklist: `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/06-ai-instructions.md` (§ Verification)
- Test cases: `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/06-testcases.md`

**Plan Phase 1 checks:**
1. `npm run ts-check` passes (root `tsc --noEmit`)
2. `tsc --project tsconfig.test.json --noEmit` passes (test types resolve)
3. `npx prettier --version` outputs a version (Prettier installed)
4. `npx eslint --version` outputs a version (ESLint installed)
5. `cd apps/demos && npx eslint --version` outputs a version (demos ESLint installed)
6. `grep -r "jest-dom" package.json` returns no results (`@testing-library/jest-dom` removed)
7. `npm run test` passes (tests still work after dependency changes)
8. Verify files exist: `.editorconfig`, `.prettierrc`, `.prettierignore`, `tsconfig.test.json`, `.git-blame-ignore-revs`
9. Verify `.prettierrc` contains `importOrder` with correct group sequence
10. Verify `tsconfig.test.json` has `"types": ["vitest/globals"]`

**Plan Phase 6 checks:**
11. File exists at `.github/instructions/demos.instructions.md`
12. YAML frontmatter has `applyTo: "apps/demos/**"`
13. Content covers all 6 topics: project structure, adding pages, adding examples, adding scope entities, key components, mock utilities
14. File follows the pattern of `.github/instructions/thoughts-workflow.instructions.md`

**Save report to:** `.thoughts/2026-03-18-1000_repo-tooling-setup/04-implement/verification-1-6.md`

Format: pass/fail per check with error details for any failures. Include a summary line at the top (e.g., "14/14 passed" or "12/14 passed — 2 failures").

---

## Phase 4: Implement Plan Phase 2 — ESLint Configuration

- **Agent**: `rdpi-codder`
- **Output**: Code changes per ../03-plan/02-eslint.md
- **Depends on**: 3
- **Retry limit**: 2

### Prompt

Implement all tasks from plan phase 2 (ESLint Configuration).

**Read first:**
- Plan file: `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/02-eslint.md`
- Config specifications: `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/03-model.md` (sections 5 and 6)
- Architecture: `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/01-architecture.md` (section 5)
- Risk R01: `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/08-risks.md` (R01 — excessive violations)
- External research on ESLint flat config: `.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/02-external-research.md`

**Implement these tasks in order:**

1. **Task 2.1** — Create root `eslint.config.ts`:
   - Import `js` from `@eslint/js`, `tseslint` from `typescript-eslint`, `eslintConfigPrettier` from `eslint-config-prettier` (try `/flat` subpath first, fall back to base import if it doesn't exist)
   - Global `ignores`: `["dist/", "coverage/", "apps/", "node_modules/", "**/*.test.ts", "src/__tests__/**"]`
   - Layers: `js.configs.recommended` → `...tseslint.configs.strict` → `languageOptions.parserOptions` with `projectService: true` and `tsconfigRootDir: import.meta.dirname` → file-scoped rules override for `src/**/*.ts` → `eslintConfigPrettier` (last)
   - Test files are excluded via global ignores

2. **Task 2.2** — Create `apps/demos/eslint.config.ts`:
   - Same base imports plus `reactHooks` from `eslint-plugin-react-hooks`
   - Global `ignores`: `["node_modules/"]`
   - Layers: `js.configs.recommended` → `...tseslint.configs.recommended` (not strict) → `languageOptions.parserOptions` with `projectService: true` and `tsconfigRootDir: import.meta.dirname` → React Hooks plugin for `src/**/*.{ts,tsx}` → `eslintConfigPrettier` (last)

3. **Task 2.3** — Triage initial ESLint violations:
   - Run `npx eslint src/` and count violations by rule
   - For rules with >20 violations that reflect intentional codebase patterns: add `rules` overrides with explanatory comments (e.g., `"@typescript-eslint/no-explicit-any": "warn"`)
   - Do NOT lower preset from `strict` to `recommended`
   - Do NOT batch-fix individual violations
   - Goal: config loads and runs without parse/config errors; lint errors may remain but are reviewed

**Constraints:**
- Do NOT modify files outside scope (only create/modify ESLint configs)
- After implementation, verify: `npx eslint src/` runs without config errors, `cd apps/demos && npx eslint src/` runs without config errors
- If `eslint-config-prettier/flat` import fails, use `eslint-config-prettier` directly
- Verify `npm run ts-check` still passes

---

## Phase 5: Implement Plan Phase 3 — Vitest Import Cleanup

- **Agent**: `rdpi-codder`
- **Output**: Code changes per ../03-plan/03-vitest-cleanup.md
- **Depends on**: 3
- **Retry limit**: 2

### Prompt

Implement all tasks from plan phase 3 (Vitest Import Cleanup — remove explicit vitest imports from ~60 test files).

**Read first:**
- Plan file: `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/03-vitest-cleanup.md` — contains the complete list of affected files and special cases
- Design use case UC-8: `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/05-usecases.md`
- Risk R06: `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/08-risks.md` (edge cases)

**Implement these tasks:**

1. **Task 3.1** — Remove vitest imports from all test files:
   - Remove ALL lines matching `import { ... } from 'vitest'` or `import { ... } from "vitest"` from every test file in `src/`
   - **Special cases** (files with TWO vitest import lines — both must be removed):
     - `src/query-v2/__tests__/integration/plugin-augmentation.test.ts`
     - `src/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts`
   - **Special case** (expectTypeOf on same line as globals):
     - `src/query-v2/core/machines/Machine.test.ts`
   - **Setup file**: `src/__tests__/setup.ts` — imports `afterEach, beforeEach` from `'vitest'`
   - Handle all ~60 files listed in the plan

2. **Task 3.2** — Verify no stale imports remain:
   - Run `grep -rn "from ['\"]vitest" src/` — must return zero results
   - If any remain, remove them manually

**Constraints:**
- Only remove import lines — do NOT modify any other code in the files
- If removing an import line leaves an empty line at the top of the file, clean it up (no leading blank lines)
- After all changes: `npm run test` must pass, `tsc --project tsconfig.test.json --noEmit` must pass
- Do NOT modify files outside `src/`

---

## Phase 6: Verify Plan Phases 2 + 3

- **Agent**: `rdpi-tester`
- **Output**: `verification-2-3.md`
- **Depends on**: 4, 5
- **Retry limit**: 1

### Prompt

Verify the implementation of plan phases 2 (ESLint Configuration) and 3 (Vitest Import Cleanup). Run all checks from both verification checklists.

**Read first:**
- Plan Phase 2 verification: `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/02-eslint.md` (§ Verification)
- Plan Phase 3 verification: `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/03-vitest-cleanup.md` (§ Verification)
- Test cases: `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/06-testcases.md`

**Plan Phase 2 checks:**
1. `npx eslint src/` runs without config parsing errors
2. `cd apps/demos && npx eslint src/` runs without config parsing errors
3. Test files are excluded from root ESLint: `npx eslint "src/**/*.test.ts"` reports all files as ignored
4. `apps/` directory excluded from root ESLint: `npx eslint apps/` reports all ignored
5. `npm run ts-check` still passes
6. `npm run lint` script works

**Plan Phase 3 checks:**
7. `grep -rn "from ['\"]vitest" src/` returns zero results
8. `npm run test` passes — all tests pass with same count as before
9. `tsc --project tsconfig.test.json --noEmit` passes
10. `npm run ts-check` still passes

**Save report to:** `.thoughts/2026-03-18-1000_repo-tooling-setup/04-implement/verification-2-3.md`

Format: pass/fail per check with error details for any failures. Include summary line at the top.

---

## Phase 7: Implement Plan Phase 4 — Formatting Migration

- **Agent**: `rdpi-codder`
- **Output**: Code changes per ../03-plan/04-formatting-migration.md
- **Depends on**: 6
- **Retry limit**: 2

### Prompt

Implement all tasks from plan phase 4 (Formatting Migration — initial Prettier formatting pass).

**Read first:**
- Plan file: `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/04-formatting-migration.md`
- Design use case UC-7: `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/05-usecases.md`
- Risk R05: `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/08-risks.md` (semantic changes)

**Implement these tasks in order:**

1. **Task 4.1** — Run initial Prettier formatting pass:
   - Run `npx prettier --write src/`
   - Review `git diff --stat` — changes should be widespread (formatting), not concentrated in a few files
   - Spot-check 5–10 files with largest diffs to verify only whitespace/quote/import-order changes, no semantic changes

2. **Task 4.2** — Verify tests pass after formatting:
   - Run `npm run test`
   - All tests must pass — if any fail, investigate by checking `git diff` on related files

3. **Task 4.3** — Commit formatting and update `.git-blame-ignore-revs`:
   - Stage and commit: `git add src/ && git commit -m "style: apply Prettier formatting to src/"`
   - Get SHA: `git log -1 --format="%H"`
   - Update `.git-blame-ignore-revs`: add the SHA below the existing comment header
   - Commit: `git add .git-blame-ignore-revs && git commit -m "chore: add .git-blame-ignore-revs for formatting commit"`

4. **Task 4.4** — Verify Prettier + ESLint integration:
   - Run `npm run format && npm run lint` — both should succeed
   - Run `npx prettier --check src/` — should exit 0 (idempotent)

**Constraints:**
- Do NOT modify files outside `src/` (except `.git-blame-ignore-revs`)
- The formatting commit must contain ONLY formatting changes — no other modifications
- After all changes: `npm run ts-check` must pass

---

## Phase 8: Verify Plan Phase 4

- **Agent**: `rdpi-tester`
- **Output**: `verification-4.md`
- **Depends on**: 7
- **Retry limit**: 1

### Prompt

Verify the implementation of plan phase 4 (Formatting Migration).

**Read first:**
- Plan Phase 4 verification: `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/04-formatting-migration.md` (§ Verification)
- Test cases: `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/06-testcases.md`

**Checks:**
1. `npx prettier --check src/` exits with code 0 (all files formatted)
2. `npm run test` passes (no semantic changes from formatting)
3. `.git-blame-ignore-revs` contains a valid 40-character SHA (not just the comment stub)
4. `npm run ts-check` still passes
5. Idempotency: running `npx prettier --write src/` again produces zero `git diff` changes
6. `npm run format && npm run lint` — both succeed without errors (Prettier + ESLint integration)

**Save report to:** `.thoughts/2026-03-18-1000_repo-tooling-setup/04-implement/verification-4.md`

Format: pass/fail per check with error details for any failures. Include summary line at the top.

---

## Phase 9: Implement Plan Phase 5 — Documentation

- **Agent**: `rdpi-codder`
- **Output**: Code changes per ../03-plan/05-documentation.md
- **Depends on**: 6, 8
- **Retry limit**: 2

### Prompt

Implement Task 5.1 from the plan: update `docs/CONTRIBUTING.md` with a new "Инструменты разработки" section.

**Read first:**
- Plan file: `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/05-documentation.md`
- Design documentation spec: `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/07-docs.md`
- Current file: `docs/CONTRIBUTING.md` — find the "Тесты" section (around line 125) and "Соглашения" section (around line 140)

**Implement Task 5.1:**
- Add a new section "Инструменты разработки" between the existing "Тесты" and "Соглашения" sections
- **Subsection 1: Commands** — `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run format:check`; note `apps/demos/` has separate linting: `cd apps/demos && npx eslint src/`
- **Subsection 2: Editor setup** — VS Code extensions: Prettier (`esbenp.prettier-vscode`), ESLint (`dbaeumer.vscode-eslint`); `editor.formatOnSave: true`
- **Subsection 3: Git blame** — `.git-blame-ignore-revs` purpose, local config command: `git config blame.ignoreRevsFile .git-blame-ignore-revs`, note GitHub handles automatically

**Constraints:**
- Write in Russian to match existing documentation style
- Use `bash` syntax highlighting for command blocks
- Scope: ~15–20 lines of Markdown
- Match existing section formatting and heading levels
- Do NOT modify any other files

---

## Phase 10: Verify Plan Phase 5

- **Agent**: `rdpi-tester`
- **Output**: `verification-5.md`
- **Depends on**: 9
- **Retry limit**: 1

### Prompt

Verify the implementation of plan phase 5 (Documentation).

**Read first:**
- Plan Phase 5 verification: `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/05-documentation.md` (§ Verification)
- Current file: `docs/CONTRIBUTING.md`

**Checks:**
1. `docs/CONTRIBUTING.md` contains the new "Инструменты разработки" section
2. All four commands documented: `lint`, `lint:fix`, `format`, `format:check`
3. `.git-blame-ignore-revs` usage instruction is present
4. Section is placed between "Тесты" and "Соглашения" in the document structure
5. `npm run ts-check` still passes (no code changed)

**Save report to:** `.thoughts/2026-03-18-1000_repo-tooling-setup/04-implement/verification-5.md`

Format: pass/fail per check with error details for any failures. Include summary line at the top.

---

## Phase 11: Implementation Review

- **Agent**: `rdpi-implement-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 3, 6, 8, 10
- **Retry limit**: 2

### Prompt

Review the complete implementation of the Repository Tooling Setup feature. Read all plan phases, verification reports, and produced artifacts, then write the implementation record.

**Read — Plan phases:**
- `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/01-foundation.md`
- `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/02-eslint.md`
- `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/03-vitest-cleanup.md`
- `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/04-formatting-migration.md`
- `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/05-documentation.md`
- `.thoughts/2026-03-18-1000_repo-tooling-setup/03-plan/06-ai-instructions.md`

**Read — Verification reports:**
- `.thoughts/2026-03-18-1000_repo-tooling-setup/04-implement/verification-1-6.md`
- `.thoughts/2026-03-18-1000_repo-tooling-setup/04-implement/verification-2-3.md`
- `.thoughts/2026-03-18-1000_repo-tooling-setup/04-implement/verification-4.md`
- `.thoughts/2026-03-18-1000_repo-tooling-setup/04-implement/verification-5.md`

**Read — Design documents (for traceability):**
- `.thoughts/2026-03-18-1000_repo-tooling-setup/02-design/README.md`
- `.thoughts/2026-03-18-1000_repo-tooling-setup/01-research/README.md`

**Read — Implemented artifacts (spot-check):**
- `.editorconfig`, `.prettierrc`, `.prettierignore`, `tsconfig.test.json`, `.git-blame-ignore-revs`
- `eslint.config.ts` (root), `apps/demos/eslint.config.ts`
- `.github/instructions/demos.instructions.md`
- `docs/CONTRIBUTING.md` (check new section)
- `package.json` (root — check scripts and deps), `apps/demos/package.json` (check deps)
- Spot-check 2–3 test files to confirm vitest imports removed

**Write `README.md`** in `.thoughts/2026-03-18-1000_repo-tooling-setup/04-implement/`, replacing the existing placeholder. Include:

1. **Frontmatter**: title, date, status (Approved/Rejected), feature, plan link
2. **Implementation Record**: date, plan reference, phase completion (6/6 or N/6)
3. **Verification Results Summary**: aggregate pass/fail from all verification reports
4. **Quality Review Checklist**:
   - All plan phases implemented
   - All verification checks passed
   - No out-of-scope files modified
   - Code follows project patterns (naming, indentation, barrel exports, `@/` alias)
   - TypeScript strict mode maintained (`npm run ts-check` passes)
   - Documentation proportional (15–20 lines in CONTRIBUTING.md, not over-specified)
   - No security vulnerabilities introduced
5. **Change Summary**: list of all new/modified files grouped by plan phase
6. **Post-Implementation Recommendations**: areas for manual testing, suggested next steps
7. **Recommended Commit Message**: conventional commits format covering all changes

---
