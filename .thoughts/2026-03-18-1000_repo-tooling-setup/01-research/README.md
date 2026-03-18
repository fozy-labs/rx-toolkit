---
title: "Research: Repository Tooling Setup"
date: 2026-03-18
status: Approved
feature: "Configure test typing, linting, formatting, and AI instructions for apps/demos"
rdpi-version: b0.2
---

## Summary

Research investigated four areas of the `rx-toolkit` repository: vitest test typing, ESLint linting, Prettier formatting with import sorting, and AI instruction files for `apps/demos/`. The codebase currently has **zero linting or formatting tooling** — no ESLint, no Prettier, no `.editorconfig`. Vitest is configured with `globals: true` but every test file redundantly imports globals explicitly, and test files are excluded from TypeScript compilation with no `tsconfig.test.json` to cover them.

External research confirmed that ESLint flat config is the required format for new projects (legacy is deprecated/removed in v10), `typescript-eslint` provides tiered presets suitable for library code, and import sorting can be handled by either a Prettier plugin or `eslint-plugin-simple-import-sort`. The `apps/demos/` sandbox has well-defined patterns for adding pages, examples, and external entities, which are documented thoroughly enough to write AI instruction files.

The main decisions ahead for the design stage are: import sorting tool choice (Prettier plugin vs. ESLint rule), vitest typing strategy (keep explicit imports vs. add `tsconfig.test.json`), ESLint strictness level, linting scope (src-only vs. including demos), and cosmetic choices for Prettier (quote style, indent width, print width).

## Documents

- [Codebase Analysis](./01-codebase-analysis.md) — current configs, dependency inventory, formatting conventions, import patterns, apps/demos structure, existing instruction files
- [External Research](./02-external-research.md) — vitest typing approaches, ESLint flat config ecosystem, Prettier import sorting plugins comparison, AI instruction file best practices
- [Open Questions](./03-open-questions.md) — 14 prioritized questions with options, risks, and recommendations covering all four tooling areas

## Key Findings

1. **No linting or formatting tooling exists** — no ESLint, Prettier, or editorconfig files; no related dependencies or scripts in any `package.json` ([Codebase Analysis](./01-codebase-analysis.md), sections 2–3).
2. **Vitest `globals: true` is set but unused for typing** — all test files explicitly import `describe`, `it`, `expect`, `vi` from `'vitest'`, and test files are excluded from the main `tsconfig.json` with no `tsconfig.test.json` to provide type coverage ([Codebase Analysis](./01-codebase-analysis.md), section 1).
3. **ESLint flat config is required** — legacy `.eslintrc` format is deprecated and removed in ESLint v10; `typescript-eslint` and all major plugins support flat config natively ([External Research](./02-external-research.md), section 2).
4. **`eslint-plugin-simple-import-sort` is the strongest candidate for import ordering** — zero dependencies, fast, CI-enforceable, supports the exact group order required (external → `@/` → `../` → `./`), and works alongside Prettier without conflicts ([External Research](./02-external-research.md), section 3; [Open Questions](./03-open-questions.md), Q1).
5. **Codebase uses 4-space indentation and double quotes consistently in `src/`** — `apps/demos/` diverges with mixed single/double quotes; import ordering is inconsistent across both codebases ([Codebase Analysis](./01-codebase-analysis.md), section 3).
6. **`@testing-library/jest-dom` is installed but completely unused** — present in `devDependencies` (v6.9.1) but not imported in any test file; no test uses DOM-specific matchers ([Codebase Analysis](./01-codebase-analysis.md), section 1; [Open Questions](./03-open-questions.md), Q10).
7. **`apps/demos/` has clear, well-documented patterns** for adding pages (MDX + route + navbar), examples (raw `?raw` imports + scope object), and external entities (add to `LiveExample.tsx` `defaultScope`) — sufficient for writing AI instruction files ([Codebase Analysis](./01-codebase-analysis.md), section 4).

## Contradictions and Gaps

1. **Minor internal inconsistency in codebase analysis**: The formatting section states "Semicolons: Present everywhere in `.ts`/`.tsx` files" but the sampling table notes `@/src/common/react/useConstant.ts` as having "no semicolons on some lines." This is a minor discrepancy — the general statement may need qualification. **Severity: Low.**

2. **CI environment unknown**: Open question Q3 notes that the `eslint.config.ts` format requires either `jiti` or Node.js 22.13+, but the CI Node.js version is not documented anywhere in the research. This could affect the ESLint config format decision. **Severity: Medium.**

3. **No root `package.json` `"type"` field documented**: The codebase analysis documents `apps/demos/package.json` has `"type": "module"` but does not explicitly state whether the root `package.json` has this field. Open question Q3 mentions it does NOT — this cross-reference is consistent but the codebase analysis should have stated it directly. **Severity: Low.**

4. **`vite-tsconfig-paths` discrepancy**: Codebase analysis notes that `vite-tsconfig-paths` is in `apps/demos/` devDependencies but is NOT used in the Vite config. This unused dependency is documented but not flagged in open questions. **Severity: Low.**

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | All phases produced output files | PASS | Phases 1–3 all produced non-empty output files; Phase 4 is this review |
| 2 | Codebase analysis has exact file:line references | PASS | "Code References" section at the end provides `@/file:line-range` for all claims; body text uses file-level `@/` references |
| 3 | External research has source + confidence annotations | PASS | Every finding annotated with confidence level (High/Medium/Low); Sources section lists 14 URLs; inline source attribution throughout |
| 4 | Open questions are actionable (context, options, risks) | PASS | All 14 questions have Context, Options, Risks, Recommendation, and Priority sections |
| 5 | No solutions or design proposals in research | PASS | Codebase analysis is facts-only; external research presents comparisons without prescribing; open questions have "Recommendation" labels (acceptable per guidelines) |
| 6 | YAML frontmatter present on all files | PASS | All three output files have correct YAML frontmatter with title, date, stage, role, workflow fields |
| 7 | Cross-references consistent between documents | PASS | Findings in codebase analysis (no ESLint, globals-but-explicit-imports, jest-dom unused, 4-space indent) are consistently referenced in external research options and open questions; no contradictions between documents |

### Issues Found

1. **Minor inconsistency within codebase analysis** — Semicolon observation ("Present everywhere") contradicts the `useConstant.ts` table entry ("no semicolons on some lines"). Severity: **Low**. Does not affect design decisions.

2. **CI Node.js version not researched** — Affects the `eslint.config.ts` vs `.mjs` decision (Q3). Not documented in codebase analysis or external research. Severity: **Medium**. Design stage should verify or default to the safer `.mjs` option.

3. **Root `package.json` `"type"` field not explicitly documented in codebase analysis** — Referenced indirectly in Q3 but missing from the codebase analysis proper. Severity: **Low**.

## Next Steps

Proceeds to Design stage after human review. The design stage should address:

1. **Import sorting tool choice** (Q1) — Prettier plugin vs. `eslint-plugin-simple-import-sort`
2. **Vitest typing strategy** (Q2) — keep explicit imports vs. add `tsconfig.test.json`
3. **ESLint config format** (Q3) — `.ts` with `jiti` vs. `.mjs` (verify CI Node.js version)
4. **Linting scope** (Q4) — `src/` only vs. including `apps/demos/`
5. **Initial formatting migration** (Q5) — `.git-blame-ignore-revs` approach
6. **Prettier cosmetic choices** (Q6, Q7, Q12) — quote style, tab width, print width
7. **ESLint preset level** (Q8) — `recommended` vs. `strict` vs. `strict` + `stylistic`
8. **`@testing-library/jest-dom` disposition** (Q10) — remove or set up
9. **AI instruction file structure for `apps/demos/`** (Q13) — single vs. multiple files
