---
title: "Verification: Phases 1 & 6"
date: 2026-03-18
stage: 04-implement
role: rdpi-tester
---

## Summary

16/20 checks passed — 4 failures. Dependencies declared in `package.json` but NOT installed (`npm install` was not run). `tsconfig.test.json` has an invalid `include` pattern and pre-existing type errors in `query-v2` test files.

## Results

### Phase 1: Foundation — Structural Checks (from user request)

| # | Check | Status | Details |
|---|-------|--------|---------|
| 1 | Files exist: `.editorconfig`, `.prettierrc`, `.prettierignore`, `tsconfig.test.json`, `.git-blame-ignore-revs` | **PASS** | All 5 files exist with expected content |
| 2 | Root `package.json` devDependencies: `prettier`, `@ianvs/prettier-plugin-sort-imports`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `jiti` | **PASS** | All 7 packages present in `devDependencies` |
| 3 | Root `package.json` scripts: `lint`, `lint:fix`, `format`, `format:check` | **PASS** | All 4 scripts present: `"lint": "eslint src/"`, `"lint:fix": "eslint src/ --fix"`, `"format": "prettier --write src/"`, `"format:check": "prettier --check src/"` |
| 4 | `@testing-library/jest-dom` NOT in root devDependencies | **PASS** | `Select-String "jest-dom" package.json` returned no results |
| 5 | `apps/demos/package.json` devDependencies: `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-config-prettier`, `jiti` | **PASS** | All 6 packages present |
| 6 | `apps/demos/package.json` has `lint` script | **PASS** | `"lint": "eslint src/"` |
| 7 | `.prettierrc` `importOrder` correct sequence | **PASS** | Order: `<BUILTIN_MODULES>` → `""` → `<THIRD_PARTY_MODULES>` → `""` → `^@/(.*)$` → `""` → `^\\.\\./(.*) ` → `""` → `^\\./(.*)$` |
| 8 | `tsconfig.test.json` has `"types": ["vitest/globals"]` and extends `./tsconfig.json` | **PASS** | `"extends": "./tsconfig.json"`, `"types": ["vitest/globals"]` confirmed |
| 9 | `.editorconfig` `indent_size=4` for `[*]`, `indent_size=2` for JSON/YAML | **PASS** | `[*]` has `indent_size = 4`; `[*.{json,yml,yaml}]` has `indent_size = 2` |
| 10 | `.prettierignore` contains `apps/` pattern | **PASS** | File contains `apps/`, `dist/`, `coverage/`, `node_modules/`, `*.md` |

### Phase 6: AI Instructions — Structural Checks (from user request)

| # | Check | Status | Details |
|---|-------|--------|---------|
| 11 | File exists at `.github/instructions/demos.instructions.md` | **PASS** | File exists |
| 12 | YAML frontmatter has `applyTo: "apps/demos/**"` | **PASS** | Frontmatter: `name: "demos"`, `description: "Instructions for working with the rx-toolkit interactive demos app"`, `applyTo: "apps/demos/**"` |
| 13 | Content covers all 6 topics | **PASS** | Sections found: "Project Structure Overview", "How to Add a New Page", "How to Add a New Example", "How to Add External Entities to the Sandbox Scope", "Key Components", "Mock Utilities" |
| 14 | Follows pattern of `thoughts-workflow.instructions.md` | **PASS** | Has YAML frontmatter with `name`, `description`, `applyTo` fields matching the established pattern |

### Phase 1: Plan Verification Checklist

| # | Check | Status | Details |
|---|-------|--------|---------|
| 15 | `npm run ts-check` passes | **PASS** | `tsc --noEmit` exit code 0, no errors |
| 16 | `tsc --project tsconfig.test.json --noEmit` passes (T01) | **FAIL** | Exit code 1. Three categories of errors: (a) `TS5010: File specification cannot end in a recursive directory wildcard ('**'): 'src/__tests__/**'` — invalid `include` pattern in `tsconfig.test.json`; (b) Multiple `TS2339: Property 'state' does not exist on type 'TMachine<...>'` errors in `src/query-v2/__tests__/integration/query-flow.test.ts` and `src/query-v2/__tests__/integration/ssr-hydration.test.ts`; (c) `TS2493: Tuple type '[]' of length '0' has no element at index '0'` in `src/signals/base/Devtools.test.ts` |
| 17 | `npx prettier --version` outputs a version (Prettier installed) | **FAIL** | `npx prettier --version` outputs `3.8.1` but only because `npx` downloads it on-the-fly. Package is NOT locally installed: `require.resolve('prettier')` throws MODULE_NOT_FOUND, `node_modules/prettier/` does not exist. `npm install` was not run after modifying `package.json`. |
| 18 | `npx eslint --version` outputs a version (ESLint installed) | **FAIL** | ESLint is NOT installed. `node_modules/eslint/` does not exist. `require.resolve('eslint')` throws MODULE_NOT_FOUND. |
| 19 | `cd apps/demos && npx eslint --version` (demos ESLint installed) | **FAIL** | ESLint is NOT installed in `apps/demos/node_modules/`. `require.resolve('eslint')` from `apps/demos/` throws MODULE_NOT_FOUND. |
| 20 | `npm run test` passes | **PASS** | 59 test files passed, 612 tests passed, 4 skipped (616 total) |

### Phase 6: Plan Verification Checklist

All Phase 6 plan checks are covered by checks 11–14 above and check 15 (`npm run ts-check`). All PASS.

## Root Cause of Failures

**Checks 17–19 (dependencies not installed):** Task 1.8 from the plan ("Install dependencies — run `npm install` at root and in `apps/demos/`") was not executed. The `package.json` files were modified correctly, but the packages were never installed into `node_modules/`.

**Check 16 (`tsconfig.test.json` compilation):** Two issues:
1. **Config error (introduced by this phase):** The `include` pattern `"src/__tests__/**"` is invalid TypeScript configuration — it must not end in `**`. Should be `"src/__tests__/**/*"` or `"src/__tests__/**/*.ts"`.
2. **Pre-existing type errors:** Multiple TS2339 errors in `src/query-v2/__tests__/integration/` files and TS2493 in `src/signals/base/Devtools.test.ts`. These are pre-existing type issues in `query-v2` (work-in-progress code) and `Devtools.test.ts`, not introduced by this phase. However, the plan Phase 1 verification expects this command to pass.
