---
title: "Open Questions: Repository Tooling Setup"
date: 2026-03-18
stage: 01-research
role: rdpi-questioner
workflow: b0.2
---

## High Priority

### Q1: Import sorting — Prettier plugin or ESLint rule?

**Context**: The task requires import sorting with a specific group order (external → `@/` → `../` → `./`). Both Prettier plugins and ESLint rules can accomplish this. The choice affects the overall tooling architecture because it determines whether sorting is a formatting concern or a linting concern, and whether violations are silently fixed or reported as errors.

**Options**:
1. **Prettier plugin (`@ianvs/prettier-plugin-sort-imports`)** — Pros: single tool handles all formatting including imports; zero ESLint config for sorting; blank-line separation via empty strings in `importOrder`; safe side-effect handling / Cons: no CI error reporting (silently fixes); modifies AST (against Prettier philosophy); less flexible regex; adds Babel parser overhead per file
2. **ESLint rule (`eslint-plugin-simple-import-sort`)** — Pros: zero dependencies; very fast (no resolver calls); CI can block on unsorted imports; full regex power for grouping; used by 162k repos; Prettier-friendly / Cons: requires ESLint to be set up (already planned); may produce whitespace oddities that Prettier then fixes (benign); two tools involved in import ordering
3. **Both (ESLint sorts, Prettier formats)** — Pros: ESLint enforces order + reports errors, Prettier normalizes whitespace / Cons: risk of conflicting sort opinions if both reorder; unnecessary complexity

**Risks**: Using both a Prettier import plugin and an ESLint import sort rule simultaneously will cause conflicts. Must pick one. If the Prettier plugin is chosen and imports are wrong, CI cannot catch it (only auto-fix on format). If ESLint is chosen, developers must run both tools (but this is standard practice).

**Recommendation**: Option 2 (`eslint-plugin-simple-import-sort`) — it provides CI enforcement, is faster due to zero resolver overhead, has proven ecosystem adoption, and the project is already adding ESLint. Let Prettier handle whitespace/style only.

---

### Q2: Vitest test typing — explicit imports vs. global types?

**Context**: The vitest config has `globals: true`, but every test file explicitly imports `describe`, `it`, `expect`, `vi` from `'vitest'`. This is redundant — the runtime provides globals, but the code imports them anyway. The choice affects whether to add a `tsconfig.test.json` (for IDE support of globals) or keep explicit imports (no config change needed). Test files are excluded from the main `tsconfig.json`.

**Options**:
1. **Keep explicit imports (status quo)** — Pros: no config changes needed; fully explicit and discoverable; IDE type resolution works via import; no risk of polluting source files / Cons: verbose; every test file needs boilerplate imports; `globals: true` config is effectively unused for typing
2. **Add `tsconfig.test.json` with `"types": ["vitest/globals"]`** — Pros: clean — globals just work; matches the `globals: true` runtime config; reduces boilerplate / Cons: must create and maintain a second tsconfig; must remove all existing explicit vitest imports from test files (migration effort); IDE needs to correctly pick up the test tsconfig for test files
3. **Add `"types": ["vitest/globals"]` to the main `tsconfig.json`** — Pros: simplest config change / Cons: pollutes source files with test globals in IDE autocomplete; `describe`, `it`, `expect` would appear as suggestions in production code

**Risks**: Option 2 requires a one-time migration to remove all explicit imports. If the IDE doesn't correctly resolve the test tsconfig, developers lose type checking in test files. Option 3 causes IDE pollution that actively harms developer experience in source files.

**Recommendation**: Option 2 (`tsconfig.test.json`) — it aligns runtime behavior (`globals: true`) with type declarations, provides clean separation, and is the established community pattern. The migration to remove explicit imports can be automated.

---

### Q3: ESLint config format — flat config (`eslint.config.ts`) or flat config (`.mjs`)?

**Context**: ESLint flat config is required (legacy is deprecated). However, the config file extension matters: `.ts` requires either `jiti` as a dev dependency or Node.js 22.13+ with `--experimental-strip-types`. The project uses TypeScript 5.9.2 and the CI environment's Node.js version is unknown.

**Options**:
1. **`eslint.config.ts`** — Pros: TypeScript type safety in config; consistent with the repo's TS-first approach; `defineConfig` helper provides IntelliSense / Cons: requires `jiti` (v2.2.0+) as devDependency or specific Node.js version; may fail in some CI environments
2. **`eslint.config.mjs`** — Pros: works everywhere without extra dependencies; maximum CI compatibility / Cons: no TypeScript type checking in the config itself; JSDoc types are possible but awkward
3. **`eslint.config.js`** with `"type": "module"` in root `package.json` — Pros: simplest extension / Cons: root `package.json` does NOT have `"type": "module"` set, so this would require adding it (potential side effects on other scripts)

**Risks**: Choosing `.ts` and then hitting CI compatibility issues would be frustrating to debug. Choosing `.mjs` sacrifices type safety in a project that otherwise values it.

**Recommendation**: Option 1 (`eslint.config.ts`) with `jiti` added to devDependencies. The project is TypeScript-first, and `jiti` is a lightweight dependency (~50KB). If CI node version is a concern, this should be verified before implementation.

---

### Q4: Linting scope — should `apps/demos/` be linted?

**Context**: The task mentions linting for the repository. `apps/demos/` is a separate app with its own `package.json`, `tsconfig.json`, and different tech stack (TailwindCSS v4, HeroUI, MDX, react-router-dom). It currently has no linting. Including it in linting scope adds complexity (different rules for JSX/TailwindCSS, MDX files, component libraries). Excluding it means demo code quality is unchecked.

**Options**:
1. **Lint both `src/` and `apps/demos/`** with a single root ESLint config and file-based overrides — Pros: consistent quality across the repo; catches errors in demo code; single config to maintain / Cons: more complex config (different rules for MDX, demo-specific patterns); may need additional plugins (MDX, TailwindCSS); demos use different quote conventions
2. **Lint `src/` only**, ignore `apps/demos/`  — Pros: simpler config; demos are a sandbox, not shipped code; faster lint runs / Cons: demo code remains unchecked; inconsistency between the two codebases
3. **Separate ESLint configs** — root config for `src/`, separate `apps/demos/eslint.config.ts` — Pros: fully independent configs; each tailored to its stack / Cons: two configs to maintain; potentially duplicated base rules

**Risks**: Including `apps/demos/` adds config complexity that may slow down the initial tooling setup. MDX files may need `eslint-plugin-mdx` and TailwindCSS class linting is a separate concern. Excluding it now is easy to reverse later, but including it now and getting it wrong creates friction.

**Recommendation**: Option 2 for the initial implementation — lint `src/` only. Add `apps/demos/` to the ESLint ignore list. This can be revisited as a follow-up once the core tooling is stable.

---

### Q5: How to handle the initial formatting pass without polluting git history?

**Context**: The repository has no formatting configured. Enabling Prettier will reformat potentially every file (indentation is 4 spaces but Prettier's default is 2, quote style is inconsistent, etc.). A single "format everything" commit would pollute `git blame` for every line in the codebase, making history harder to navigate.

**Options**:
1. **Single formatting commit + `.git-blame-ignore-revs`** — Pros: clean and simple; `git blame --ignore-revs-file .git-blame-ignore-revs` skips the commit; GitHub supports this file natively; one-time cost / Cons: developers must configure `git config blame.ignoreRevsFile .git-blame-ignore-revs` locally (or it's set in `.gitconfig` via project setup)
2. **Incremental formatting (only format changed files)** — Pros: no blame pollution; gradual adoption / Cons: inconsistent formatting across files for an extended period; merge conflicts when files get formatted at different times; lint-staged only covers new commits
3. **Format and split by directory/module** — Pros: smaller blame impact per commit / Cons: still pollutes blame across many commits; more complex to manage; doesn't fundamentally solve the problem

**Risks**: Option 2 creates a long-lived inconsistency that confuses contributors and makes diffs noisier (formatting changes mixed with logic changes). Option 1 is universally recommended but requires a one-time setup step for local git configs.

**Recommendation**: Option 1 — single formatting commit with `.git-blame-ignore-revs`. This is the established industry practice used by major open-source projects (React, Angular, TypeScript itself). Add a note in `CONTRIBUTING.md` about the blame ignore file.

---

## Medium Priority

### Q6: Prettier config — which quote style?

**Context**: The `src/` codebase predominantly uses double quotes for import paths. The `apps/demos/` code uses mostly single quotes. Prettier defaults to double quotes (`singleQuote: false`). Choosing a quote style will reformat all non-conforming files.

**Options**:
1. **Double quotes (`singleQuote: false`, Prettier default)** — Pros: matches the dominant convention in `src/` (the main library code); no Prettier config needed for this option (it's the default); consistent with JSON / Cons: deviates from common community preference for single quotes in JS/TS
2. **Single quotes (`singleQuote: true`)** — Pros: widely preferred in the JS/TS ecosystem; shorter; matches `apps/demos/` convention / Cons: requires reformatting all `src/` files (which currently use double quotes); explicit Prettier setting needed

**Risks**: Low risk either way — this is purely cosmetic and will be auto-enforced by Prettier. The initial formatting commit (Q5) will handle the transition regardless of choice.

**Recommendation**: Option 1 (double quotes) — aligns with the existing `src/` convention, minimizing diff in the initial formatting pass for the library's core code.

---

### Q7: Prettier `tabWidth` — 2 or 4 spaces?

**Context**: The entire codebase currently uses 4-space indentation consistently. Prettier defaults to 2 spaces. Changing to 2 spaces would reformat every indented line in the project.

**Options**:
1. **Keep 4 spaces (`tabWidth: 4`)** — Pros: no indentation changes in the initial format pass; matches existing convention; less disruption / Cons: deviates from Prettier's default and the most common community setting (2 spaces)
2. **Switch to 2 spaces (`tabWidth: 2`, Prettier default)** — Pros: matches community convention; more compact code; default so no config needed for this option / Cons: reformats every indented line; larger initial formatting diff; the team is used to 4 spaces

**Risks**: Switching to 2 spaces creates a massive diff in the initial formatting commit but is absorbed by `.git-blame-ignore-revs`. Keeping 4 spaces avoids churn but sets a non-standard convention going forward.

**Recommendation**: Depends on team preference — this is a subjective decision. If minimizing initial churn is prioritized, keep 4 spaces. If aligning with ecosystem norms matters more, switch to 2. Either works with `.git-blame-ignore-revs`.

---

### Q8: `typescript-eslint` preset level — `recommended` vs. `strict` vs. `strict` + `stylistic`?

**Context**: `typescript-eslint` offers multiple preset tiers. `recommended` catches common bugs. `strict` is a superset catching more. `stylistic` enforces style consistency (e.g., `interface` vs. `type`). The project is a published library, so correctness matters more than in an internal app.

**Options**:
1. **`tseslint.configs.recommended`** — Pros: least noise; widely used default; fewer false positives / Cons: misses stricter checks that help library quality
2. **`tseslint.configs.strict`** — Pros: catches more bugs; appropriate for library code; superset of recommended / Cons: may produce many initial warnings/errors that need triage; some rules may be too opinionated
3. **`tseslint.configs.strict` + `tseslint.configs.stylistic`** — Pros: maximum coverage for both correctness and style; consistent code patterns / Cons: stylistic rules may clash with team preferences (e.g., forced `interface` over `type`); highest initial error count to address

**Risks**: Starting with `strict` may produce a large number of warnings in existing code, requiring either fixing or disabling rules. Starting with `recommended` and upgrading later means a second triage pass.

**Recommendation**: Option 2 (`strict` without `stylistic`) — provides strong correctness guarantees for a library. `stylistic` can be added later once the team sees how `strict` works in practice. Disable specific rules that don't fit after initial triage.

---

### Q9: Import linting — `eslint-plugin-import-x` or skip?

**Context**: If `eslint-plugin-simple-import-sort` is used for sorting (Q1), there's a question of whether `eslint-plugin-import-x` should also be added for other import rules (`no-unresolved`, `no-duplicates`, `no-cycle`, `newline-after-import`, etc.). These plugins serve different purposes: sorting vs. validation.

**Options**:
1. **Add `eslint-plugin-import-x`** for import validation rules (alongside `simple-import-sort` for ordering) — Pros: catches unresolved imports, duplicate imports, circular dependencies; produces more helpful error messages; `import-x` is fast (Rust resolver) / Cons: additional dependency; requires resolver config for `@/*` path alias; more rules to configure/maintain
2. **Skip `eslint-plugin-import-x`**, rely on TypeScript for import validation — Pros: simpler config; TypeScript already catches unresolved imports at compile time; fewer dependencies / Cons: no `no-cycle` detection; no `no-duplicates` linting; no `newline-after-import` enforcement (though Prettier/sort plugin handles spacing)

**Risks**: Without `import-x`, circular dependencies go undetected until they cause runtime issues. However, TypeScript's `tsc --noEmit` already catches most import errors. Adding `import-x` with the `@/*` alias requires configuring `eslint-import-resolver-typescript` or `import-x/resolver-next` with TypeScript support.

**Recommendation**: Option 2 for the initial setup — skip `eslint-plugin-import-x`. TypeScript handles resolution, and `simple-import-sort` handles ordering. Add `import-x` as a follow-up if circular dependency detection or advanced import rules are needed.

---

### Q10: Should `@testing-library/jest-dom` be set up or removed?

**Context**: `@testing-library/jest-dom` is in `devDependencies` (v6.9.1) but is **not imported or used in any test file**. No test uses matchers like `.toBeInTheDocument()`. This is dead weight — or it may be intended for future use.

**Options**:
1. **Remove it** — Pros: cleaner dependencies; no confusion about available matchers; honest about what's actually used / Cons: must re-add if DOM matchers are needed later (trivial)
2. **Set it up properly** (add to vitest `setupFiles`, add types) — Pros: ready for use; enables richer DOM assertions in React component tests / Cons: overhead for unused feature; adds type pollution if types are global
3. **Leave as-is** (installed but not configured) — Pros: zero effort / Cons: confusing; suggests it's used when it isn't; wastes dependency install time

**Risks**: Low risk either way. Setting it up when nobody uses it adds unnecessary complexity. Removing it is trivially reversible.

**Recommendation**: Option 1 — remove it. It's unused and adds confusion. Re-adding takes one command if needed.

---

## Low Priority

### Q11: Should an `.editorconfig` be added alongside Prettier?

**Context**: No `.editorconfig` exists. Prettier handles formatting, but `.editorconfig` provides editor-level defaults (indent style, file encoding, final newline, trailing whitespace) that affect behavior even when Prettier isn't running (e.g., when creating new files, editing non-code files like `.md` or `.yml`).

**Options**:
1. **Add `.editorconfig`** — Pros: provides consistent defaults for all editors; covers files Prettier doesn't format (YAML, Markdown, etc.); widely supported; near-zero maintenance / Cons: minor overlap with Prettier for code files; one more config file (trivial)
2. **Skip `.editorconfig`** — Pros: fewer config files; Prettier handles code formatting / Cons: non-code files have no formatting defaults; editors may apply different settings

**Risks**: None significant. `.editorconfig` is additive and non-conflicting.

**Recommendation**: Option 1 — add `.editorconfig`. It's a universal standard with near-zero cost that fills gaps Prettier doesn't cover.

---

### Q12: Prettier `printWidth` — 80, 100, or 120?

**Context**: No line length enforcement exists. Some lines in the codebase (especially JSX with Tailwind classes in demos) reach 120+ characters. Prettier defaults to 80.

**Options**:
1. **80 (Prettier default)** — Pros: encourages shorter lines; better readability on narrow screens and side-by-side diffs; no config needed / Cons: may force excessive line breaks in TypeScript generics and JSX
2. **100** — Pros: good balance; accommodates TypeScript verbose types without excessive wrapping / Cons: explicit config
3. **120** — Pros: minimal reformatting of existing code; accommodates long JSX/Tailwind lines / Cons: can lead to very long lines; harder to read in narrow viewports

**Risks**: Too narrow (80) creates noisy diffs with many wrapped lines. Too wide (120) reduces readability. This is cosmetic and handled by the initial formatting commit regardless.

**Recommendation**: 100 — balances readability with TypeScript's tendency for longer type signatures. Common choice for TypeScript library projects.

---

### Q13: AI instructions for `apps/demos/` — how many instruction files?

**Context**: The task requires writing `.github/instructions` files for AI agents working with `apps/demos/`. There are several distinct workflows: adding new pages, adding examples, adding external entities to the sandbox. The codebase analysis documents all of these patterns.

**Options**:
1. **Single instruction file** (`demos.instructions.md` with `applyTo: "apps/demos/**"`) covering all workflows — Pros: one file to maintain; all context in one place / Cons: may be long; less targeted activation
2. **Multiple instruction files** by workflow (e.g., `demos-pages.instructions.md`, `demos-examples.instructions.md`, `demos-scope.instructions.md`) — Pros: shorter, focused; semantic matching by description activates only relevant instructions / Cons: more files to maintain; risk of overlap
3. **Single file with cross-references** — short instruction file that links to the codebase analysis or a dedicated `apps/demos/README.md` — Pros: stays short; AI can follow links for detail / Cons: depends on AI reliably following links; adds indirection

**Risks**: Low risk. VS Code best practices recommend short, focused files. However, the `apps/demos/` workflows are closely related (adding a page involves adding examples), so splitting may create artificial boundaries.

**Recommendation**: Option 1 — single instruction file. The total content is not large enough to warrant splitting. The `applyTo` glob ensures it activates when working in the demos directory.

---

### Q14: Should formatting apply to `apps/demos/`?

**Context**: Related to Q4 (linting scope) but for Prettier specifically. Prettier is less intrusive than ESLint — it only changes whitespace and style, not logic. Including `apps/demos/` in formatting would normalize quote style and indentation there too.

**Options**:
1. **Format everything** (both `src/` and `apps/demos/`) — Pros: consistent style across the entire repo; Prettier is non-destructive; single `.prettierrc` at root / Cons: the initial formatting diff includes demo files; demo maintainers may have preferences
2. **Format `src/` only** — Pros: scoped change; demos are a sandbox / Cons: inconsistent formatting; need to configure `.prettierignore` for `apps/demos/`

**Risks**: Excluding demos creates two formatting standards in one repo, which is confusing. Including demos is low-risk since Prettier changes are purely cosmetic.

**Recommendation**: Option 1 — format everything. Prettier's changes are safe and consistency across the repo is worth the initial diff. Include `apps/demos/` in the formatting pass.

---

## User Answers

### Q1: Import sorting — Prettier plugin or ESLint rule?
**Decision**: Prettier plugin (`@ianvs/prettier-plugin-sort-imports`)

### Q2: Vitest test typing — explicit imports vs. global types?
**Decision**: `tsconfig.test.json` с глобальными типами vitest

### Q3: ESLint config format — flat config (`.ts`) or flat config (`.mjs`)?
**Decision**: `eslint.config.ts` + `jiti`

### Q4: Linting scope — should `apps/demos/` be linted?
**Decision**: Раздельные конфиги (отдельный ESLint конфиг для `src/` и `apps/demos/`)

### Q5: How to handle the initial formatting pass?
**Decision**: На усмотрение (без привязки к конкретному подходу)

### Q6: Prettier config — which quote style?
**Decision**: Двойные кавычки (Prettier default)

### Q7: Prettier `tabWidth` — 2 or 4 spaces?
**Decision**: 4 пробела (сохранить текущий стиль)

### Q8: `typescript-eslint` preset level?
**Decision**: На усмотрение

### Q9: Import linting — `eslint-plugin-import-x` or skip?
**Decision**: На усмотрение

### Q10: Should `@testing-library/jest-dom` be set up or removed?
**Decision**: На усмотрение

### Q11: Should an `.editorconfig` be added?
**Decision**: Добавить

### Q12: Prettier `printWidth`?
**Decision**: 120

### Q13: AI instructions for `apps/demos/` — how many files?
**Decision**: Один файл (single instruction file с `applyTo: "apps/demos/**"`)

### Q14: Should formatting apply to `apps/demos/`?
**Decision**: Только `src/` (Prettier не применять к `apps/demos/`)
