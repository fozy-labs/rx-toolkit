---
title: "Phase 4: Formatting Migration"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Run the initial Prettier formatting pass on `src/`, commit the formatting changes as a single commit, and record the commit SHA in `.git-blame-ignore-revs`. After this phase, all `src/` files conform to Prettier's configured style, and `git blame` can be configured to skip the formatting commit.

## Dependencies

- **Requires**: Phase 1 (`.prettierrc`, `.prettierignore`, dependencies installed)
- **Recommended after**: Phase 3 (Vitest Import Cleanup — so the formatting commit is purely formatting, not mixed with import removal)
- **Blocks**: Phase 5 (Documentation)

## Execution

Sequential — run after Phase 3 for a clean formatting commit.

## Tasks

### Task 4.1: Run initial Prettier formatting pass

- **File**: All files in `src/` (Prettier processes them)
- **Action**: Execute
- **Description**: Run Prettier on the entire `src/` directory to apply formatting (indentation normalization, quote consistency, import sorting) to all files.
- **Details**:
  - Run `npx prettier --write src/`
  - Expected: exit code 0; all files processed
  - Review `git diff --stat` to confirm changes are widespread (formatting) not concentrated (potential semantic issue)
  - Spot-check 5–10 files with largest diffs to verify only whitespace/quote/import-order changes
  - [ref: ../02-design/05-usecases.md#uc-7-initial-formatting-migration]
  - [ref: ../02-design/08-risks.md#r05-prettier-changes-code-semantics]

### Task 4.2: Verify tests pass after formatting

- **File**: N/A (test execution)
- **Action**: Execute
- **Description**: Run the full test suite to confirm Prettier did not change code semantics.
- **Details**:
  - Run `npm run test`
  - All tests must pass with the same count as before formatting
  - If any test fails, investigate: check `git diff` on the failing test's related files for non-formatting changes
  - [ref: ../02-design/06-testcases.md, T20]

### Task 4.3: Commit formatting and update `.git-blame-ignore-revs`

- **File**: `.git-blame-ignore-revs`
- **Action**: Modify
- **Description**: Commit all formatting changes in a single commit, then record the commit SHA in `.git-blame-ignore-revs`.
- **Details**:
  - Stage and commit: `git add src/ && git commit -m "style: apply Prettier formatting to src/"`
  - Get SHA: `git log -1 --format="%H"`
  - Update `.git-blame-ignore-revs`: add the SHA below the comment header
  - Commit the updated file: `git add .git-blame-ignore-revs && git commit -m "chore: add .git-blame-ignore-revs for formatting commit"`
  - [ref: ../02-design/05-usecases.md#uc-7-initial-formatting-migration]
  - [ref: ../02-design/03-model.md#8-git-blame-ignore-revs]

### Task 4.4: Verify Prettier + ESLint integration (if Phase 2 is complete)

- **File**: N/A (integration test)
- **Action**: Execute
- **Description**: If Phase 2 (ESLint) is already complete, verify that the formatted code produces no ESLint formatting-related errors.
- **Details**:
  - Run `npm run format && npm run lint`
  - Both commands should succeed — ESLint should report zero formatting-related violations after Prettier formats files
  - Run `npx prettier --check src/` to verify idempotency — should exit 0 (all files already formatted)
  - [ref: ../02-design/06-testcases.md, T18, T19]

## Verification

- [ ] `npx prettier --check src/` exits with code 0 (all files formatted, T14 inverse)
- [ ] `npm run test` passes (T20 — no semantic changes)
- [ ] `.git-blame-ignore-revs` contains a valid 40-character SHA
- [ ] `npm run ts-check` still passes (compilability invariant)
- [ ] Idempotency: running `npx prettier --write src/` again produces zero `git diff` changes
