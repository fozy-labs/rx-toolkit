---
title: "Risk Analysis"
date: 2026-03-18
stage: 02-design
role: rdpi-qa-designer
workflow: b0.2
---

# Risk Analysis

## Risk Matrix

| ID | Risk | Probability | Impact | Strategy | Mitigation |
|----|------|-------------|--------|----------|------------|
| R01 | ESLint `strict` preset produces excessive initial violations in `src/` | High | Medium | Mitigate | Triage violations during implementation; disable specific rules that don't fit with inline `// eslint-disable` or config-level `rules` overrides. Do NOT lower the entire preset to `recommended`. |
| R02 | `eslint-config-prettier` fails to disable conflicts due to plugin name aliasing | Low | High | Mitigate | Use canonical plugin names in `eslint.config.ts` — do not alias `typescript-eslint` to `ts` or similar. Verify with integration test T18. |
| R03 | `@ianvs/prettier-plugin-sort-imports` mishandles edge cases (type imports, side-effect imports, re-exports) | Low | Medium | Accept | Plugin is the most maintained fork (19k+ GitHub stars on parent, active `@ianvs` fork). Side-effect preservation is explicitly documented [ref: ../01-research/02-external-research.md#import-sorting-plugins-comparison]. Monitor after initial formatting pass. |
| R04 | `jiti` fails to load `eslint.config.ts` in CI environment | Medium | High | Mitigate | Pin `jiti` version in `devDependencies`. If CI uses Node.js < 22.13, `jiti` is required. Test ESLint config loading in CI as part of first PR. Fallback: rename to `eslint.config.mjs` if `jiti` is unstable. |
| R05 | Initial Prettier formatting pass changes code semantics (not just formatting) | Low | High | Mitigate | Run `npm run test` after `prettier --write src/` and before committing. Prettier is designed to be semantics-preserving. Review `git diff` for any non-whitespace/non-import-order changes. |
| R06 | Vitest import removal regex misses edge cases (multi-line imports, aliased imports, `vitest/utils` subpath imports) | Medium | Medium | Mitigate | After regex removal, run `grep -r "from ['\"]vitest" src/` to verify zero remaining imports. Run `npm run test` to verify all tests pass. Manually fix any edge cases the regex misses. |
| R07 | `tsconfig.test.json` `types: ["vitest/globals"]` excludes needed `@types/*` packages | Low | Medium | Mitigate | The `types` field replaces (not merges) the base config's type resolution. Test files resolve `@types/node` etc. via module imports, not global types. Verify with `tsc --project tsconfig.test.json --noEmit` (test case T01). |
| R08 | Typed linting (`projectService`) makes `eslint src/` slow (>60s) | Medium | Low | Accept | `projectService` is slower than untyped linting but provides significantly more valuable rules (`no-floating-promises`, `no-misused-promises`). If slow, scope typed rules to specific file patterns or increase CI timeout. |
| R09 | Root and demos ESLint configs diverge over time (dependency version drift) | Medium | Low | Accept | Both configs are independent by design [ref: ./04-decisions.md#adr-2-separate-eslint-configs-for-src-and-appsdemos]. Dependency drift is low-risk since demos are a sandbox. Address during periodic dependency updates. |
| R10 | `apps/demos/` has no formatting enforcement (Prettier excluded) | Low | Low | Accept | User decision [ref: ./04-decisions.md#adr-3-formatting-scope--src-only]. ESLint still catches correctness issues in demos. Inconsistent formatting in demos is acceptable — they are a sandbox, not published code. |
| R11 | Editor does not pick up `tsconfig.test.json` for test files automatically | Low | Medium | Mitigate | VS Code TypeScript language service discovers multiple tsconfigs via `include` patterns. If not resolved, add `"references"` to root `tsconfig.json` pointing at `tsconfig.test.json`. Verify with manual check (test case T02). |
| R12 | ESLint flat config ecosystem compatibility issues (plugins expecting legacy format) | Low | Medium | Mitigate | All selected plugins (`@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-config-prettier`) explicitly support flat config [ref: ../01-research/02-external-research.md]. No legacy-only plugins in the dependency list. |
| R13 | `.git-blame-ignore-revs` not configured locally by developers | Medium | Low | Accept | GitHub UI respects the file natively — no config needed for web blame. For local `git blame`, document `git config blame.ignoreRevsFile .git-blame-ignore-revs` in `CONTRIBUTING.md`. Non-critical — blame still works, just shows the formatting commit. |
| R14 | Import sorting plugin conflicts with manual import grouping in existing code | Low | Low | Accept | The initial `prettier --write` pass will re-sort all imports according to the configured `importOrder`. Any existing manual grouping is replaced. This is intentional — the tool becomes the single source of truth for import order going forward. |

## Detailed Mitigation Plans

### R01: ESLint `strict` preset — excessive initial violations

The `tseslint.configs.strict` preset enables rules like `no-explicit-any`, `no-non-null-assertion`, `prefer-nullish-coalescing`, and `no-unsafe-*` family. The existing `src/` codebase was written without a linter, so many violations are expected on first run.

**Mitigation steps**:
1. Run `npx eslint src/ 2>&1 | grep -c "error"` to count total violations before any fixes.
2. Categorize violations by rule — identify rules with >20 violations that may indicate a codebase pattern rather than individual mistakes.
3. For rules that conflict with intentional patterns (e.g., `no-explicit-any` in generic utility code), add config-level rule overrides in the `rules` object with a comment explaining why.
4. Fix remaining "real" violations incrementally — do NOT batch-disable rules just to get a clean run.

**Verification**: After triage, `npx eslint src/` runs clean (exit code 0).

### R04: `jiti` fails in CI

The `eslint.config.ts` format requires a TypeScript loader. ESLint uses `jiti` for this. If the CI runner has an incompatible Node.js version or `jiti` has a loading issue, ESLint will fail to start.

**Mitigation steps**:
1. Pin `jiti` to a known-working version (e.g., `^2.4.0`) in `devDependencies`.
2. The first PR with the ESLint config must run `npx eslint src/` in CI to verify config loading.
3. If `jiti` fails: rename `eslint.config.ts` to `eslint.config.mjs` and convert TS syntax to JS — this is a 5-minute fallback that eliminates the `jiti` dependency entirely.

**Verification**: CI job succeeds with `npx eslint src/` (test case T04).

### R05: Prettier changes code semantics

Prettier claims to be semantics-preserving, but import sorting (reordering side-effect imports, merging duplicate import specifiers) could theoretically change behavior if side-effect order matters.

**Mitigation steps**:
1. Run `npx prettier --write src/` as an isolated step.
2. Immediately run `npm run test` — all tests must pass.
3. Review `git diff --stat` to confirm changes are spread across many files (formatting) rather than concentrated in a few (potential semantic change).
4. Spot-check 5–10 files with the largest diffs to verify changes are whitespace/quote/import-order only.

**Verification**: Full test suite passes after formatting (test case T20, T22).

### R06: Vitest import removal misses edge cases

The regex `^import\s+\{[^}]+\}\s+from\s+['"]vitest['"];?\s*\n` handles standard single-line named imports. It may miss multi-line imports, type imports (`import type { ... } from "vitest"`), or subpath imports (`from "vitest/utils"`).

**Mitigation steps**:
1. Before running the regex, run `grep -rn "vitest" src/ --include="*.ts"` to catalog all vitest references.
2. After regex removal, run the same grep to verify zero remaining imports.
3. Check for `vitest` references that are NOT import lines (e.g., `/// <reference types="vitest" />`) — these should not exist but verify.
4. Run `npm run test` to confirm all tests still pass.

**Verification**: Grep returns zero results for vitest imports (test case T23); all tests pass (test case T22).
