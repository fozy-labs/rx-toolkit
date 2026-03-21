---
title: "Architecture Decision Records"
date: 2026-03-18
stage: 02-design
role: rdpi-architect
workflow: b0.2
---

# Architecture Decision Records

## ADR-1: Import Sorting Tool — Prettier Plugin

### Status
Accepted (user decision)

### Context
The task requires import sorting with group ordering: external → `@/` aliases → `../` relative → `./` local. Two viable approaches exist: a Prettier plugin (`@ianvs/prettier-plugin-sort-imports`) or an ESLint rule (`eslint-plugin-simple-import-sort`). Research found both capable of the exact group order required [ref: ../01-research/02-external-research.md#configuring-import-group-order-external------].

The ESLint approach was recommended by research due to CI error reporting and zero-dependency profile [ref: ../01-research/03-open-questions.md#Q1]. However, the user explicitly chose the Prettier plugin.

### Options Considered
1. **`@ianvs/prettier-plugin-sort-imports`** (Prettier plugin) — Pros: single tool for all formatting; zero ESLint config needed; safe side-effect handling; blank-line separation via empty strings / Cons: no lint-error reporting in CI; modifies AST (against Prettier philosophy); Babel parser overhead
2. **`eslint-plugin-simple-import-sort`** (ESLint rule) — Pros: CI enforcement as lint errors; zero dependencies; 162k repos use it; full regex power / Cons: requires ESLint setup; may produce whitespace Prettier then fixes
3. **Both** — Rejected due to conflict risk between two sorting tools

### Decision
Option 1 — `@ianvs/prettier-plugin-sort-imports`. This is a binding user decision.

### Consequences
- **Positive**: Single formatting tool handles all style concerns including imports; simpler mental model; no ESLint import ordering rules to maintain
- **Negative**: CI cannot report unsorted imports as lint errors — only `prettier --check` detects them (reports as "file not formatted" rather than "imports unsorted")
- **Risk**: If the Prettier plugin has bugs with complex import patterns (type imports, side-effect imports), there's no fallback enforcement. Mitigated by the `@ianvs` fork's strong side-effect handling [ref: ../01-research/02-external-research.md#import-sorting-plugins-comparison]

---

## ADR-2: Separate ESLint Configs for `src/` and `apps/demos/`

### Status
Accepted (user decision)

### Context
The repository has two distinct codebases: `src/` (TypeScript library — RxJS, signals, query) and `apps/demos/` (React app — Vite, TailwindCSS v4, HeroUI, MDX, react-router-dom). They have different tech stacks, different quality requirements, and different tsconfigs [ref: ../01-research/01-codebase-analysis.md#2-linting-status].

Research recommended initially linting only `src/` [ref: ../01-research/03-open-questions.md#Q4], but the user chose separate configs for both.

### Options Considered
1. **Single root ESLint config with file-based overrides** — Pros: one file to maintain; consistent base rules / Cons: complex with two different stacks in one file; need to manage file patterns carefully
2. **Lint `src/` only, ignore `apps/demos/`** — Pros: simplest setup / Cons: demo code unchecked
3. **Separate configs** (root `eslint.config.ts` for `src/`, `apps/demos/eslint.config.ts` for demos) — Pros: fully independent; each tailored to its stack; clear ownership / Cons: duplicated base rules; two files to maintain

### Decision
Option 3 — separate independent configs. This is a binding user decision.

The two configs are **fully independent** with no shared base config file. Both include `@eslint/js` recommended and `eslint-config-prettier` independently. The duplication is ~5 lines and acceptable for full isolation.

### Consequences
- **Positive**: Each config is self-contained and tailored (root uses `strict`, demos uses `recommended`); no risk of root rules leaking to demos or vice versa; each can evolve independently
- **Negative**: Minor duplication of base config entries; two sets of ESLint dependencies (root and `apps/demos/package.json`)
- **Risk**: Dependencies may drift out of sync. Mitigated by regular dependency updates.

---

## ADR-3: Formatting Scope — `src/` Only

### Status
Accepted (user decision)

### Context
Prettier can format both `src/` and `apps/demos/`. The demos use different quote conventions (mostly single quotes) and formatting the demos would change many files that aren't part of the published library [ref: ../01-research/01-codebase-analysis.md#current-formatting-conventions-sampled-across-modules].

Research recommended formatting everything [ref: ../01-research/03-open-questions.md#Q14], but the user chose to scope Prettier to `src/` only.

### Options Considered
1. **Format everything** — Pros: consistent style across repo; Prettier is non-destructive / Cons: larger initial diff; demos maintainers may have preferences
2. **Format `src/` only** — Pros: scoped change; demos are a sandbox; smaller initial formatting commit / Cons: two formatting standards in one repo

### Decision
Option 2 — `src/` only. Implemented via `.prettierignore` with `apps/` pattern. This is a binding user decision.

### Consequences
- **Positive**: Smaller, focused initial formatting commit; no disruption to demo development workflow; demos can evolve their own style
- **Negative**: Inconsistent formatting between `src/` and `apps/demos/`; developers switching between the two codebases encounter different styles
- **Risk**: Inconsistency may confuse contributors. Mitigated by ESLint catching correctness issues in demos regardless.

---

## ADR-4: Initial Formatting Migration — `.git-blame-ignore-revs`

### Status
Proposed (discretionary — Q5)

### Context
Enabling Prettier on `src/` will reformat files (import sorting, potential whitespace/quote changes). A single "format everything" commit pollutes `git blame` for every affected line. This is a well-known problem with formatting adoption [ref: ../01-research/03-open-questions.md#Q5].

### Options Considered
1. **Single formatting commit + `.git-blame-ignore-revs`** — Pros: clean, simple; GitHub natively supports the file; one-time cost; universally recommended / Cons: developers must run `git config blame.ignoreRevsFile .git-blame-ignore-revs` locally
2. **Incremental formatting** (only format changed files) — Pros: no blame pollution / Cons: inconsistent formatting for an extended period; merge conflicts; formatting changes mixed with logic changes
3. **Format by directory/module** — Pros: smaller per-commit blame impact / Cons: still pollutes blame across many commits; more complex

### Decision
Option 1 — single formatting commit with `.git-blame-ignore-revs`.

This is the established industry practice used by React, Angular, TypeScript, and other major projects [ref: ../01-research/03-open-questions.md#Q5]. GitHub renders blame correctly when this file is present. A note in `CONTRIBUTING.md` will document the required local git config.

### Consequences
- **Positive**: Clean git blame; one-time migration; well-supported by tooling
- **Negative**: Developers must configure blame ignore file locally for terminal `git blame` (GitHub UI handles it automatically)
- **Risk**: Minimal. The `.git-blame-ignore-revs` mechanism is widely adopted and well-tested.

---

## ADR-5: ESLint Preset Level — `strict` Without `stylistic`

### Status
Proposed (discretionary — Q8)

### Context
`typescript-eslint` offers tiered presets: `recommended` (baseline), `strict` (superset, more checks), and `stylistic` (code style consistency). The project is a published library where correctness is critical [ref: ../01-research/02-external-research.md#recommended-rule-sets-for-a-library-project].

### Options Considered
1. **`tseslint.configs.recommended`** — Pros: fewest false positives; widely used / Cons: misses stricter checks valuable for libraries
2. **`tseslint.configs.strict`** — Pros: catches more bugs; appropriate for library code; superset of recommended / Cons: may require initial triage to disable rules that don't fit
3. **`tseslint.configs.strict` + `tseslint.configs.stylistic`** — Pros: maximum coverage / Cons: `stylistic` rules may conflict with Prettier; forces opinions like `interface` vs. `type` that may not match team preferences; highest initial noise

### Decision
Option 2 — `strict` without `stylistic`.

**Rationale**: A published library benefits from stricter correctness rules (`no-explicit-any`, `no-non-null-assertion`, `prefer-nullish-coalescing`, `no-floating-promises`). The `stylistic` preset is excluded because: (a) Prettier already handles formatting-related style concerns, (b) `stylistic` opinions on `interface` vs. `type` may conflict with existing codebase patterns, and (c) `eslint-config-prettier` would need to disable overlapping rules anyway [ref: ../01-research/02-external-research.md#recommended-rule-sets-for-a-library-project].

The demos config uses `recommended` (not `strict`) because demos are a sandbox where developer velocity matters more than strictness.

### Consequences
- **Positive**: Strong correctness guarantees for the published library; catches unsafe patterns early
- **Negative**: Initial triage needed — existing code may trigger many warnings that need fixing or rule disabling
- **Risk**: Moderate initial effort to triage. Mitigated by disabling specific rules that don't fit during implementation.

---

## ADR-6: Skip `eslint-plugin-import-x`

### Status
Proposed (discretionary — Q9)

### Context
`eslint-plugin-import-x` provides import validation rules: `no-unresolved`, `no-duplicates`, `no-cycle`, `newline-after-import`. It's the modern fork of `eslint-plugin-import` with a Rust-based resolver [ref: ../01-research/02-external-research.md#preset-packages]. However, import sorting is handled by the Prettier plugin (ADR-1), and import resolution is already validated by TypeScript's compiler.

### Options Considered
1. **Add `eslint-plugin-import-x`** — Pros: `no-cycle` detection; `no-duplicates`; `newline-after-import` / Cons: requires resolver config for `@/*` path alias; additional dependency; TypeScript already catches unresolved imports
2. **Skip `eslint-plugin-import-x`** — Pros: simpler config; fewer dependencies; TypeScript handles resolution via `tsc --noEmit`; import ordering handled by Prettier / Cons: no circular dependency detection; no `no-duplicates` linting

### Decision
Option 2 — skip `eslint-plugin-import-x` for initial setup.

**Rationale**:
- **Unresolved imports**: TypeScript's `tsc --noEmit` catches these with exact type information — more reliable than any ESLint resolver [ref: ../01-research/03-open-questions.md#Q9]
- **Import ordering**: Handled by `@ianvs/prettier-plugin-sort-imports` (ADR-1)
- **Newline after imports**: Handled by the Prettier import sorting plugin (inserts blank lines per `importOrder` config)
- **Circular dependencies**: The main value-add of `import-x`. However, the library has a well-defined module structure (signals → base, query → core/lib, common → utils) that makes circular deps unlikely. This can be added as a follow-up if needed
- **Resolver complexity**: Configuring `eslint-import-resolver-typescript` or `import-x/resolver-next` for the `@/*` path alias adds setup complexity. Not justified when TypeScript already resolves paths

### Consequences
- **Positive**: Simpler ESLint config; fewer dependencies; faster lint execution
- **Negative**: No automated circular dependency detection
- **Risk**: A circular dependency could be introduced undetected. Low probability given the module structure. Can be mitigated by adding `import-x/no-cycle` later if it becomes a concern.

---

## ADR-7: Remove `@testing-library/jest-dom`

### Status
Proposed (discretionary — Q10)

### Context
`@testing-library/jest-dom` (v6.9.1) is in root `devDependencies` but is completely unused — no test file imports it, no test uses DOM matchers like `.toBeInTheDocument()`, and it's not configured in vitest `setupFiles` [ref: ../01-research/01-codebase-analysis.md#vitest-globals-usage-in-test-files]. React hook tests use `renderHook`/`act` from `@testing-library/react` (which IS used) but no DOM-specific assertions.

### Options Considered
1. **Remove** — Pros: honest dependency list; no confusion; cleaner install / Cons: must re-add if DOM matchers needed later (trivial: `npm install -D @testing-library/jest-dom`)
2. **Set up properly** (add to setupFiles, add types) — Pros: ready for DOM assertions / Cons: overhead for unused feature; adds type pollution
3. **Leave as-is** — Pros: zero effort / Cons: confusing; suggests the lib is used when it isn't

### Decision
Option 1 — remove `@testing-library/jest-dom` from `devDependencies`.

**Rationale**: The package is dead weight. Setting it up (option 2) adds complexity for a feature nobody uses. Leaving it (option 3) creates false expectations. Removing it is trivially reversible with one command [ref: ../01-research/03-open-questions.md#Q10].

### Consequences
- **Positive**: Cleaner dependency list; no confusion about available matchers
- **Negative**: None practical — re-adding takes 30 seconds
- **Risk**: Zero.

---

## ADR-8: `tsconfig.test.json` for Vitest Global Types

### Status
Accepted (user decision)

### Context
Vitest is configured with `globals: true` but every test file explicitly imports `describe`, `it`, `expect`, `vi` from `'vitest'`. Test files are excluded from the main `tsconfig.json`. There is no `tsconfig.test.json` to provide type declarations for vitest globals in test files [ref: ../01-research/01-codebase-analysis.md#1-test-typing-setup].

The official Vitest documentation recommends adding `"vitest/globals"` to the `types` array in tsconfig when `globals: true` is set [ref: ../01-research/02-external-research.md#established-practices].

### Options Considered
1. **Keep explicit imports** (status quo) — Pros: no config changes; fully explicit / Cons: verbose; `globals: true` is effectively unused for typing; redundant imports in every test file
2. **Add `tsconfig.test.json` with `types: ["vitest/globals"]`** — Pros: aligns runtime behavior with types; reduces boilerplate; community-standard pattern / Cons: must create and maintain a second tsconfig; must remove explicit vitest imports from test files
3. **Add `types: ["vitest/globals"]` to main `tsconfig.json`** — Pros: simplest change / Cons: pollutes source files with test globals in IDE autocomplete — `describe`, `it`, `expect` appear in production code suggestions

### Decision
Option 2 — `tsconfig.test.json` that extends `tsconfig.json`. This is a binding user decision.

The test tsconfig:
- Extends `./tsconfig.json` to inherit all compiler options
- Adds `types: ["vitest/globals"]` for global type declarations
- Includes `src/**/*.test.ts` and `src/__tests__/**` — the exact patterns excluded by the main tsconfig
- Sets `noEmit: true`

### Consequences
- **Positive**: Clean separation — vitest globals are typed only in test files; IDE autocomplete in source files is unpolluted; aligns with `globals: true` runtime config; removes ~2 lines of boilerplate per test file
- **Negative**: Migration effort — all explicit vitest imports must be removed from existing test files; a second tsconfig to maintain
- **Risk**: IDE must correctly associate test files with `tsconfig.test.json`. Modern VS Code with the TypeScript language service handles multiple tsconfigs via project references/discovery. Vitest's VS Code extension also supports this pattern. Low risk.
