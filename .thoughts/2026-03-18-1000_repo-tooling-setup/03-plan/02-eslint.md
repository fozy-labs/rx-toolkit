---
title: "Phase 2: ESLint Configuration"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Create ESLint flat config files for both `src/` (strict) and `apps/demos/` (recommended), verify they load without errors, and triage initial violations. After this phase, `npm run lint` and `cd apps/demos && npx eslint src/` are functional.

## Dependencies

- **Requires**: Phase 1 (dependencies installed)
- **Blocks**: Phase 5 (Documentation — needs lint commands to be accurate)

## Execution

Parallel with Phase 3 (Vitest Import Cleanup).

## Tasks

### Task 2.1: Create root `eslint.config.ts`

- **File**: `eslint.config.ts`
- **Action**: Create
- **Description**: Create ESLint flat config for library source code in `src/`. Uses `typescript-eslint` `strict` preset with typed linting via `projectService`.
- **Details**:
  - Import `js` from `@eslint/js`, `tseslint` from `typescript-eslint`, `eslintConfigPrettier` from `eslint-config-prettier` (verify import path — the `/flat` subpath may or may not exist; try `eslint-config-prettier/flat` first, fall back to `eslint-config-prettier` if it fails) [ref: ../02-design/README.md, issue #2]
  - Global `ignores`: `["dist/", "coverage/", "apps/", "node_modules/", "**/*.test.ts", "src/__tests__/**"]`
  - Layers: `js.configs.recommended` → `...tseslint.configs.strict` → `languageOptions.parserOptions` with `projectService: true` and `tsconfigRootDir: import.meta.dirname` → file-scoped `rules` override block for `src/**/*.ts` → `eslintConfigPrettier` (last)
  - Test files are in global ignores — not linted by this config [ref: ../02-design/01-architecture.md#5-config-file-structures]
  - [ref: ../02-design/03-model.md#5-root-eslintconfigts]

### Task 2.2: Create `apps/demos/eslint.config.ts`

- **File**: `apps/demos/eslint.config.ts`
- **Action**: Create
- **Description**: Create independent ESLint flat config for the demos app. Uses `recommended` preset (not `strict`) plus `eslint-plugin-react-hooks`.
- **Details**:
  - Import same base packages as Task 2.1, plus `reactHooks` from `eslint-plugin-react-hooks`
  - Global `ignores`: `["node_modules/"]`
  - Layers: `js.configs.recommended` → `...tseslint.configs.recommended` → `languageOptions.parserOptions` with `projectService: true` and `tsconfigRootDir: import.meta.dirname` → React Hooks plugin config for `src/**/*.{ts,tsx}` → `eslintConfigPrettier` (last)
  - [ref: ../02-design/03-model.md#6-appsdemos-eslintconfigts]
  - [ref: ../02-design/04-decisions.md#adr-2-separate-eslint-configs-for-src-and-appsdemos]

### Task 2.3: Triage initial ESLint violations in `src/`

- **File**: `eslint.config.ts` (root — may need `rules` overrides)
- **Action**: Modify (if needed)
- **Description**: Run `npx eslint src/` and triage the results. For rules with many violations that reflect intentional codebase patterns (not bugs), add config-level `rules` overrides in the custom rules block. Do NOT lower the preset from `strict` to `recommended`.
- **Details**:
  - Run `npx eslint src/ 2>&1 | grep -c "error"` to count violations
  - Categorize by rule — identify rules with >20 violations
  - For pattern-level conflicts: add `rules` overrides (e.g., `"@typescript-eslint/no-explicit-any": "warn"`) with a comment explaining why
  - For individual violations: leave for incremental fixing (do not batch-fix in this phase)
  - Goal: `npx eslint src/` exits without config errors; lint errors may remain but must be reviewed
  - [ref: ../02-design/08-risks.md#r01-eslint-strict-preset--excessive-initial-violations]

## Verification

- [ ] `npx eslint src/` runs without config parsing errors (T04)
- [ ] `cd apps/demos && npx eslint src/` runs without config parsing errors (T09)
- [ ] Test files are excluded from root ESLint: `npx eslint "src/**/*.test.ts"` reports all ignored (T07)
- [ ] `apps/` directory excluded from root ESLint: `npx eslint apps/` reports all ignored (T08)
- [ ] `npm run ts-check` still passes (compilability invariant)
- [ ] `npm run lint` script works (runs `eslint src/`)
