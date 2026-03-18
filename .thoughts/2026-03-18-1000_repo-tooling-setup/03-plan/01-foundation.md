---
title: "Phase 1: Foundation — Dependencies & Base Configuration"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Install all required dependencies and create the base configuration files that all subsequent phases depend on. After this phase, Prettier, ESLint, and `tsconfig.test.json` are structurally in place but not yet exercised (no formatting pass, no import removal, no ESLint triage).

## Dependencies

- **Requires**: None (first phase)
- **Blocks**: Phase 2 (ESLint), Phase 3 (Vitest Cleanup), Phase 4 (Formatting Migration), Phase 5 (Documentation)

## Execution

Sequential — must complete before any other phase begins.

## Tasks

### Task 1.1: Modify root `package.json` — devDependencies and scripts

- **File**: `package.json`
- **Action**: Modify
- **Description**: Add new devDependencies for Prettier, ESLint, and supporting packages. Add new scripts for linting and formatting. Remove unused `@testing-library/jest-dom`.
- **Details**:
  - **Add devDependencies** (exact versions to be resolved at install time):
    - `prettier` (^3.5.0)
    - `@ianvs/prettier-plugin-sort-imports` (^4.4.0)
    - `eslint` (^9.20.0)
    - `@eslint/js` (^9.20.0)
    - `typescript-eslint` (^8.25.0)
    - `eslint-config-prettier` (^10.1.0)
    - `jiti` (^2.4.0)
  - **Remove devDependency**: `@testing-library/jest-dom` (unused — ADR-7)
  - **Add scripts**:
    - `"lint": "eslint src/"`
    - `"lint:fix": "eslint src/ --fix"`
    - `"format": "prettier --write src/"`
    - `"format:check": "prettier --check src/"`
  - [ref: ../02-design/03-model.md#7-packagejson-modifications]
  - [ref: ../02-design/04-decisions.md#adr-7-remove-testing-libraryjest-dom]

### Task 1.2: Modify `apps/demos/package.json` — devDependencies and scripts

- **File**: `apps/demos/package.json`
- **Action**: Modify
- **Description**: Add ESLint-related devDependencies and a lint script for the demos app.
- **Details**:
  - **Add devDependencies**:
    - `eslint` (^9.20.0)
    - `@eslint/js` (^9.20.0)
    - `typescript-eslint` (^8.25.0)
    - `eslint-plugin-react-hooks` (^5.2.0)
    - `eslint-config-prettier` (^10.1.0)
    - `jiti` (^2.4.0)
  - **Add script**: `"lint": "eslint src/"`
  - [ref: ../02-design/03-model.md#7-packagejson-modifications]

### Task 1.3: Create `.editorconfig`

- **File**: `.editorconfig`
- **Action**: Create
- **Description**: Create EditorConfig file with editor-level defaults matching existing code conventions.
- **Details**:
  - `root = true`
  - `[*]`: `indent_style = space`, `indent_size = 4`, `end_of_line = lf`, `charset = utf-8`, `trim_trailing_whitespace = true`, `insert_final_newline = true`
  - `[*.md]`: `trim_trailing_whitespace = false`
  - `[*.{json,yml,yaml}]`: `indent_size = 2`
  - [ref: ../02-design/03-model.md#3-editorconfig]

### Task 1.4: Create `.prettierrc`

- **File**: `.prettierrc`
- **Action**: Create
- **Description**: Create Prettier configuration with import sorting plugin. JSON format.
- **Details**:
  - `tabWidth: 4`, `printWidth: 120`
  - `plugins: ["@ianvs/prettier-plugin-sort-imports"]`
  - `importOrder` array: `<BUILTIN_MODULES>`, `""`, `<THIRD_PARTY_MODULES>`, `""`, `^@/(.*)$`, `""`, `^\\.\\./(.*) `, `""`, `^\\./(.*)$`
  - All other options left at Prettier defaults (double quotes, semicolons, trailing commas "all")
  - [ref: ../02-design/03-model.md#1-prettierrc]

### Task 1.5: Create `.prettierignore`

- **File**: `.prettierignore`
- **Action**: Create
- **Description**: Exclude non-`src/` directories and Markdown from Prettier formatting.
- **Details**:
  - Patterns: `apps/`, `dist/`, `coverage/`, `node_modules/`, `*.md`
  - [ref: ../02-design/03-model.md#2-prettierignore]

### Task 1.6: Create `tsconfig.test.json`

- **File**: `tsconfig.test.json`
- **Action**: Create
- **Description**: Create test-specific TypeScript config extending root `tsconfig.json` with vitest global types.
- **Details**:
  - `"extends": "./tsconfig.json"`
  - `compilerOptions.types`: `["vitest/globals"]`
  - `compilerOptions.noEmit`: `true`
  - `include`: `["src/**/*.test.ts", "src/__tests__/**"]`
  - `exclude`: `["node_modules", "dist"]` (overrides root's test exclusions)
  - [ref: ../02-design/03-model.md#4-tsconfigtestjson]
  - [ref: ../02-design/04-decisions.md#adr-8-tsconfigtestjson-for-vitest-global-types]

### Task 1.7: Create `.git-blame-ignore-revs` (stub)

- **File**: `.git-blame-ignore-revs`
- **Action**: Create
- **Description**: Create the file with a comment header only. The formatting commit SHA will be added in Phase 4.
- **Details**:
  - Content: single comment line `# Prettier initial formatting pass` (no SHA yet)
  - [ref: ../02-design/03-model.md#8-git-blame-ignore-revs]
  - [ref: ../02-design/04-decisions.md#adr-4-initial-formatting-migration--git-blame-ignore-revs]

### Task 1.8: Install dependencies

- **File**: N/A (terminal command)
- **Action**: Execute
- **Description**: Run `npm install` at root and in `apps/demos/` to install all new dependencies.
- **Details**:
  - Run `npm install` in repository root
  - Run `cd apps/demos && npm install`
  - Verify both `node_modules/` directories contain the expected packages

## Verification

- [ ] `npm run ts-check` passes (root `tsc --noEmit` — existing behavior preserved)
- [ ] `tsc --project tsconfig.test.json --noEmit` passes (T01)
- [ ] `npx prettier --version` outputs a version (Prettier installed)
- [ ] `npx eslint --version` outputs a version (ESLint installed)
- [ ] `cd apps/demos && npx eslint --version` outputs a version (demos ESLint installed)
- [ ] `grep -r "jest-dom" package.json` returns no results (`@testing-library/jest-dom` removed)
- [ ] `npm run test` passes (tests still work after dependency changes)
