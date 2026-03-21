---
title: "Implementation: Repository Tooling Setup"
date: 2026-03-18
status: Draft
feature: "Configure test typing, linting, formatting, and AI instructions for apps/demos"
plan: "../03-plan/README.md"
rdpi-version: b0.2
---

## Status

- Phases completed: 4/6 fully, 2/6 partially (code done, terminal steps pending)
- Verification: partial — `verification-1-6.md` exists; `verification-2-3.md`, `verification-4.md`, `verification-5.md` not produced (terminal unavailable during implementation)
- Issues: 3 (see below)

## Phase Completion

| Plan Phase | Name | Code Changes | Terminal Steps | Status |
|------------|------|-------------|----------------|--------|
| P1 | Foundation | DONE (T1.1–T1.7) | PENDING — `npm install` (T1.8) | Partial |
| P2 | ESLint Configuration | DONE (T2.1–T2.2) | PENDING — triage violations (T2.3) | Partial |
| P3 | Vitest Import Cleanup | DONE (T3.1–T3.2) | — | Complete |
| P4 | Formatting Migration | — | PENDING — entire phase requires terminal | Pending |
| P5 | Documentation | DONE (T5.1) | — | Complete |
| P6 | AI Instructions | DONE (T6.1) | — | Complete |

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | All plan phases implemented | PARTIAL | P1, P2 code done / terminal pending; P3, P5, P6 complete; P4 entirely pending (requires `npm install` + `prettier --write`) |
| 2 | Verification passed for each phase | PARTIAL | Only `verification-1-6.md` exists (16/20 PASS). Missing reports: `verification-2-3.md`, `verification-4.md`, `verification-5.md` — could not be produced without terminal. 4 failures in existing report are all due to `npm install` not run + pre-existing type errors. |
| 3 | No files outside plan scope modified | PASS | All changes are within plan scope: config files, `package.json` files, `eslint.config.ts` files, `docs/CONTRIBUTING.md`, `.github/instructions/demos.instructions.md`, and ~60 test files for vitest import removal. |
| 4 | Code follows project patterns | PASS | ESLint configs use `typescript-eslint` `config()` helper consistent with flat config patterns. JSON configs use 4-space indentation matching existing `package.json`/`tsconfig.json`. Russian language in CONTRIBUTING.md matches existing style. English in AI instructions matches `.github/` convention. |
| 5 | Barrel exports updated correctly | N/A | No new modules requiring barrel exports were introduced. |
| 6 | TypeScript strict mode maintained | PASS | `npm run ts-check` (`tsc --noEmit`) passes per verification check 15. Pre-existing type errors in `query-v2` test files are unrelated to this feature. `tsconfig.test.json` include pattern was corrected from `src/__tests__/**` to `src/__tests__/**/*` after verification flagged TS5010. |
| 7 | Documentation proportional to existing docs/demos | PASS | ~20 lines added to `CONTRIBUTING.md` with 3 subsections (Commands, Editor setup, Git blame). Matches existing section formatting, heading levels, and Russian language style. AI instructions file (~170 lines) is a separate operational artifact, proportional to the existing `thoughts-workflow.instructions.md` pattern. |
| 8 | No security vulnerabilities | PASS | Changes are configuration files and import removal only. No new user-facing code, no external data handling, no authentication changes. |

### Documentation Proportionality

**CONTRIBUTING.md**: New "Инструменты разработки" section adds ~20 lines between "Тесты" and "Соглашения" — proportional to existing sections. Contains 3 subsections: Commands (4 npm scripts + demos note), Editor setup (2 VS Code extensions + formatOnSave), Git blame (`.git-blame-ignore-revs` purpose + local config). Style matches existing Russian-language documentation with `bash` code blocks.

**demos.instructions.md**: ~170 lines covering 6 topics. Accurately reflects current `apps/demos/` structure — verified against actual source files. Format matches existing `thoughts-workflow.instructions.md` pattern (YAML frontmatter with `name`, `description`, `applyTo`). Content is comprehensive but appropriate for AI agent guidance.

No disproportionate or missing documentation.

### Issues Found

1. **Missing verification reports for phases 2–5**
   - **What**: `verification-2-3.md`, `verification-4.md`, `verification-5.md` were never produced. PHASES.md defined these as phases 6, 8, 10 but terminal was unavailable during implementation.
   - **Where**: `.thoughts/2026-03-18-1000_repo-tooling-setup/04-implement/`
   - **Expected**: Verification reports for ESLint configs (P2), vitest cleanup (P3), formatting (P4), and documentation (P5).
   - **Severity**: Medium — manual verification steps in "Manual Steps Required" section below cover these checks.

2. **Pre-existing type errors surface with `tsconfig.test.json`**
   - **What**: `tsc --project tsconfig.test.json --noEmit` fails due to pre-existing TS2339 errors in `src/query-v2/__tests__/integration/query-flow.test.ts`, `src/query-v2/__tests__/integration/ssr-hydration.test.ts`, and TS2493 in `src/signals/base/Devtools.test.ts`. These are NOT introduced by this feature — they are existing type issues in work-in-progress `query-v2` code.
   - **Where**: `src/query-v2/__tests__/integration/` and `src/signals/base/Devtools.test.ts`
   - **Expected**: Plan verification expects `tsc --project tsconfig.test.json --noEmit` to pass (check 16 in verification-1-6.md). This will need investigation — either fix the type errors or exclude the problematic files from `tsconfig.test.json`.
   - **Severity**: Medium — does not affect runtime tests (`npm run test` passes with 612 tests), only affects type checking of test files.

3. **ESLint triage (Task 2.3) not performed**
   - **What**: The `eslint.config.ts` custom rules block is empty — the placeholder comment `// (specific rules to be determined after initial triage)` remains. Running `npx eslint src/` will likely produce many violations from the `strict` preset that need rule overrides.
   - **Where**: `eslint.config.ts`, lines 30–33
   - **Expected**: After running `npx eslint src/`, rules with >20 violations reflecting intentional codebase patterns should get config-level overrides (e.g., `"@typescript-eslint/no-explicit-any": "warn"`).
   - **Severity**: High — `npm run lint` will report many errors until triage is performed.

## Manual Steps Required

The following steps must be executed manually in order:

```bash
# 1. Install dependencies (root)
npm install

# 2. Install dependencies (demos)
cd apps/demos && npm install && cd ../..

# 3. Verify tests pass after dependency changes
npm run test

# 4. Verify test types (expect pre-existing errors in query-v2 — see Issue #2)
tsc --project tsconfig.test.json --noEmit

# 5. Triage ESLint violations — add rule overrides to eslint.config.ts
npx eslint src/

# 6. Triage demos ESLint violations
cd apps/demos && npx eslint src/ && cd ../..

# 7. Run initial Prettier formatting pass
npx prettier --write src/

# 8. Verify tests after formatting
npm run test

# 9. Commit formatting changes
git add src/ && git commit -m "style: apply Prettier formatting to src/"

# 10. Get SHA and update .git-blame-ignore-revs
# Replace <SHA> with output of: git log -1 --format="%H"
# Add the SHA below the comment in .git-blame-ignore-revs
# Then: git add .git-blame-ignore-revs && git commit -m "chore: add .git-blame-ignore-revs for formatting commit"

# 11. Configure local git blame to skip formatting commit
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Post-Implementation Recommendations

- [ ] Full build: `npm run build`
- [ ] Full test run: `npm run test`
- [ ] Verify Prettier + ESLint integration: `npm run format && npm run lint`
- [ ] Verify idempotency: `npx prettier --write src/` produces zero git diff
- [ ] Investigate pre-existing type errors in `tsconfig.test.json` scope (Issue #2)
- [ ] Manual testing: verify `apps/demos/` builds and runs (`cd apps/demos && npm run dev`)

## Change Summary

### Phase 1 — Foundation (config files + package.json)
- **Created** `.editorconfig` — editor defaults (indent 4, LF, UTF-8, MD/JSON overrides)
- **Created** `.prettierrc` — Prettier config (tabWidth 4, printWidth 120, import sort plugin)
- **Created** `.prettierignore` — excludes apps/, dist/, coverage/, node_modules/, *.md
- **Created** `tsconfig.test.json` — test TypeScript config with `vitest/globals` types
- **Created** `.git-blame-ignore-revs` — stub with comment header (SHA pending P4)
- **Modified** `package.json` — added 7 devDependencies, removed `@testing-library/jest-dom`, added 4 scripts (lint, lint:fix, format, format:check)
- **Modified** `apps/demos/package.json` — added 6 devDependencies, added lint script

### Phase 2 — ESLint Configuration
- **Created** `eslint.config.ts` (root) — flat config with `strict` preset, typed linting, Prettier compat, test files excluded
- **Created** `apps/demos/eslint.config.ts` — flat config with `recommended` preset, react-hooks plugin, Prettier compat

### Phase 3 — Vitest Import Cleanup (~60 files)
- **Modified** `src/__tests__/setup.ts` — removed `import { afterEach, beforeEach } from 'vitest'`
- **Modified** 59 `.test.ts` files across `src/signals/`, `src/common/`, `src/query/`, `src/query-v2/` — removed all `import { ... } from 'vitest'` lines, including special cases with dual imports and `expectTypeOf`

### Phase 4 — Formatting Migration
- **PENDING** — requires `npm install` + `npx prettier --write src/` + git commit

### Phase 5 — Documentation
- **Modified** `docs/CONTRIBUTING.md` — added "Инструменты разработки" section (~20 lines, 3 subsections: Commands, Editor setup, Git blame)

### Phase 6 — AI Instructions
- **Created** `.github/instructions/demos.instructions.md` — AI instruction file for `apps/demos/` with 6 topics (project structure, adding pages, adding examples, sandbox scope, key components, mock utilities)

## Recommended Commit Message

```
chore: configure repository development tooling

- Add Prettier (import sorting), ESLint (flat config), .editorconfig
- Add tsconfig.test.json for vitest global types
- Remove explicit vitest imports from ~60 test files
- Remove unused @testing-library/jest-dom
- Create ESLint configs: strict for src/, recommended for apps/demos/
- Add .git-blame-ignore-revs stub for formatting migration
- Update CONTRIBUTING.md with development tools section
- Create AI instruction file for apps/demos/
```
