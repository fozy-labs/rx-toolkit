---
title: "Verification Test Cases"
date: 2026-03-18
stage: 02-design
role: rdpi-qa-designer
workflow: b0.2
---

# Verification Test Cases

## Approach

This is a tooling/config task — there is no application code to unit test. "Testing" means verifying that each tool is correctly configured and produces the expected behavior. The verification pyramid:

- **Command-level checks** (majority): run a specific CLI command, verify output or exit code. These are fast, deterministic, and automatable.
- **Integration checks**: run two tools together (e.g., Prettier then ESLint) and verify no conflicts.
- **Manual checks**: editor behavior that can only be verified visually (EditorConfig, IDE type resolution).

Each test case is a single verification step that can be run independently.

## Test Cases

| ID | Category | Description | Verification Command / Step | Expected Output | Priority |
|----|----------|-------------|----------------------------|-----------------|----------|
| T01 | Vitest Typing | `tsconfig.test.json` extends root tsconfig without errors | `tsc --project tsconfig.test.json --noEmit` | Exit code 0, no errors | P0 |
| T02 | Vitest Typing | Vitest globals are typed in test files without explicit imports | Open a test file (e.g., `src/signals/base/Signal.test.ts`) after removing `import { describe, it, expect, vi } from "vitest"` — verify `describe`, `it`, `expect`, `vi` show no red squiggles in VS Code | No type errors; IntelliSense resolves all globals | P0 |
| T03 | Vitest Typing | Vitest globals do NOT leak into source files | Open a non-test source file (e.g., `src/signals/signals/State.ts`) — type `describe` or `expect` — verify these are NOT in autocomplete suggestions | Globals absent from autocomplete in `src/**/*.ts` (non-test) | P1 |
| T04 | ESLint (src/) | Root ESLint config loads and parses successfully | `npx eslint src/ --max-warnings 0 2>&1 | head -5` (or just `npx eslint src/`) | Either clean output or lint errors — no config parsing errors, no "could not find config" errors | P0 |
| T05 | ESLint (src/) | TypeScript-aware rules work (typed linting via `projectService`) | Create a temporary test: add `const x: any = 1;` to a `src/` file, run `npx eslint src/` | Reports `@typescript-eslint/no-explicit-any` error on that line | P0 |
| T06 | ESLint (src/) | `eslint --fix` auto-fixes applicable rules | Introduce a fixable violation (e.g., `let x = 1;` where `x` is never reassigned), run `npx eslint src/ --fix` | Variable changed from `let` to `const` (or equivalent fix applied) | P1 |
| T07 | ESLint (src/) | Test files are excluded from root ESLint | `npx eslint "src/**/*.test.ts"` | No files linted (all ignored per global `ignores`) or explicit "ignored" message | P1 |
| T08 | ESLint (src/) | `apps/` directory is excluded from root ESLint | `npx eslint apps/` from root | All files ignored (no lint errors from demos code) | P1 |
| T09 | ESLint (demos/) | Demos ESLint config loads independently | `cd apps/demos && npx eslint src/` | Either clean output or lint errors — no config parsing errors | P0 |
| T10 | ESLint (demos/) | React Hooks rules are active | Add `if (cond) { useState(); }` in a demos `.tsx` file, run `cd apps/demos && npx eslint src/` | Reports `react-hooks/rules-of-hooks` error | P1 |
| T11 | ESLint (demos/) | Demos config uses `recommended` not `strict` | Add `const x: any = 1;` to a demos file, run `cd apps/demos && npx eslint src/` | Reports `@typescript-eslint/no-explicit-any` as a **warning** (recommended level), not an error (strict level) | P2 |
| T12 | Prettier | Formatting applies configured options (4 spaces, double quotes, 120 width) | Create a file with single quotes and 2-space indent in `src/`, run `npx prettier --write src/thatfile.ts`, inspect output | Quotes changed to double; indentation changed to 4 spaces; lines within 120 chars not wrapped | P0 |
| T13 | Prettier | Import sorting groups correctly | Create a file with imports in wrong order (local first, external last), run `npx prettier --write src/thatfile.ts` | Imports reordered: builtins → third-party → `@/` → `../` → `./`, with blank lines between groups | P0 |
| T14 | Prettier | `prettier --check` detects unformatted files | Modify a `src/` file to use single quotes, run `npx prettier --check src/` | Exit code 1; output lists the unformatted file | P0 |
| T15 | Prettier | `.prettierignore` excludes `apps/demos/` | Run `npx prettier --check apps/demos/src/app/App.tsx` | File is ignored (no output or "ignored" message), exit code 0 | P1 |
| T16 | Prettier | Markdown files are excluded from Prettier | Run `npx prettier --check "**/*.md"` | All `.md` files ignored per `.prettierignore` `*.md` pattern | P2 |
| T17 | EditorConfig | `.editorconfig` is applied by VS Code | Open a new file in VS Code, verify status bar shows: spaces (4), LF, UTF-8 | Editor shows configured defaults | P2 |
| T18 | Integration | Prettier + ESLint produce no conflicts | Run `npx prettier --write src/` then `npx eslint src/` | ESLint reports zero formatting-related errors after Prettier formats files (no `indent`, `quotes`, `comma-dangle` violations) | P0 |
| T19 | Integration | Format + lint pipeline works end-to-end | Run `npm run format && npm run lint` | Both commands succeed (exit code 0) on a clean codebase | P0 |
| T20 | Migration | Initial formatting pass completes without errors | `npx prettier --write src/` on the unformatted codebase | Exit code 0; all files processed; `git diff` shows only formatting changes (no logic changes) | P0 |
| T21 | Migration | `.git-blame-ignore-revs` works with `git blame` | After formatting commit + adding SHA to `.git-blame-ignore-revs`: `git config blame.ignoreRevsFile .git-blame-ignore-revs && git blame src/signals/signals/State.ts` | Formatting commit is skipped in blame output; lines attributed to original authors | P1 |
| T22 | Migration | Vitest import removal doesn't break tests | After removing all `import { ... } from "vitest"` lines and creating `tsconfig.test.json`: `npm run test` | All tests pass (same count as before migration) | P0 |
| T23 | Migration | No stale vitest imports remain after removal | `grep -r "from ['\"]vitest['\"]" src/` | No results (zero remaining explicit vitest imports) | P1 |
| T24 | AI Instructions | Instruction file has correct `applyTo` pattern | Read `.github/instructions/demos.instructions.md` YAML frontmatter, verify `applyTo: "apps/demos/**"` | Pattern matches all files under `apps/demos/` | P1 |
| T25 | AI Instructions | Instruction file covers required workflows | Review content of `demos.instructions.md` for sections: project structure, adding pages, adding examples, adding scope entities, key components | All topics present [ref: ./05-usecases.md#uc-13-content-specification-for-appsdemos-ai-instruction-file] | P1 |

## Edge Cases

### Import sorting with side-effect imports
Side-effect imports like `import "./styles.css"` must not be reordered across groups. The `@ianvs/prettier-plugin-sort-imports` plugin preserves side-effect import positions [ref: ../01-research/02-external-research.md#import-sorting-plugins-comparison]. **Verification**: add a side-effect import between two regular imports, format with Prettier, verify the side-effect import stays in the correct relative position.

### Type-only imports
TypeScript `import type { Foo } from "bar"` statements should be sorted alongside regular imports. The Prettier plugin handles these correctly. **Verification**: mix `import type` and regular imports, format, verify they sort into the correct groups.

### Empty files / files with no imports
Prettier must not crash on files with zero import statements. **Verification**: run `npx prettier --write` on a file with no imports — should complete without errors.

### `tsconfig.test.json` `types` override
When `types` is specified, TypeScript only includes listed type packages. Test files must still resolve types from `@types/node` etc. through module imports rather than global `types`. **Verification**: confirm `tsc --project tsconfig.test.json --noEmit` passes on test files that import Node.js APIs.

### ESLint on files outside `src/`
Root config files (`vitest.config.ts`, `eslint.config.ts`) should not trigger lint errors. The root ESLint config scopes to `files: ["src/**/*.ts"]` with global ignores. **Verification**: run `npx eslint .` and confirm no errors from config files at root level.

## Performance Criteria

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| `prettier --check src/` | < 10s | Formatter check should be fast for CI; `src/` is ~150 files |
| `eslint src/` | < 30s | Typed linting is slower than untyped due to `projectService`; 30s is acceptable for CI |
| `tsc --project tsconfig.test.json --noEmit` | < 15s | Extends main tsconfig; test files are a subset of the codebase |

These are rough thresholds, not hard requirements. If any tool significantly exceeds these, investigate configuration (e.g., `projectService` scope, ESLint file glob overmatch).

## Correctness Verification

End-to-end validation after all tooling is configured:

1. **Clean state check**: Run `npm run format:check && npm run lint && tsc --noEmit && npm run test` — all four commands must pass with exit code 0 on the final committed state.
2. **Idempotency check**: Run `npm run format` twice in a row — second run should produce zero `git diff` changes (Prettier is idempotent).
3. **New file workflow**: Create a new test file in `src/` with vitest globals (no imports), save in VS Code — verify formatting applies on save, types resolve, and `npm run test` passes.
4. **Cross-tool consistency**: After formatting and linting, verify `git status` shows no unstaged changes — all tools agree on the final file state.
