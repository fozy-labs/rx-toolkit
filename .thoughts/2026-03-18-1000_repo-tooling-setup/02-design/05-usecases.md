---
title: "Developer Use Cases & Migration"
date: 2026-03-18
stage: 02-design
role: rdpi-architect
workflow: b0.2
---

# Developer Use Cases & Migration

## Use Cases

### UC-1: Adding a New Test File

A developer creates a new test file (e.g., `src/signals/operators/map.test.ts`). With `tsconfig.test.json` providing `types: ["vitest/globals"]` [ref: ../01-research/03-open-questions.md#Q2], vitest globals are available without imports.

**What the developer does**: nothing special — just write tests. Globals (`describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach`) are typed automatically.

```typescript
// src/signals/operators/map.test.ts
// No imports needed for vitest globals — tsconfig.test.json provides them

describe("map operator", () => {
    it("should transform signal values", () => {
        // ... test logic ...
        expect(result).toBe(expected);
    });

    it("should support vi.fn() for mocking", () => {
        const spy = vi.fn();
        // ...
    });
});
```

**How it works**: VS Code discovers `tsconfig.test.json` via the TypeScript language service's project discovery. Files matching `src/**/*.test.ts` and `src/__tests__/**` are associated with this tsconfig, which extends the root `tsconfig.json` and adds `vitest/globals` to the `types` array [ref: 01-architecture.md#7-tsconfigtestjson--tsconfigjson-relationship]. The runtime already has globals via `vitest.config.ts` with `globals: true` [ref: ../01-research/01-codebase-analysis.md#vitestconfigts].

---

### UC-2: Running Linting

**Library code (`src/`)**:

```bash
# Check for lint errors
npm run lint

# Auto-fix what can be fixed
npm run lint:fix
```

Expected output (clean run):
```
$ eslint src/
✔ No problems found
```

Expected output (errors found):
```
$ eslint src/
src/signals/signals/State.ts
  12:5  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

✖ 1 problem (1 error, 0 warnings)
```

**Demos app (`apps/demos/`)**:

```bash
cd apps/demos
npx eslint src/
```

The two configs are independent — root uses `tseslint.configs.strict`, demos uses `tseslint.configs.recommended` [ref: 01-architecture.md#6-eslint-config-relationship]. Different preset levels, different plugins (demos has `react-hooks`).

---

### UC-3: Running Formatting

**Format all library source code**:

```bash
# Write formatted output
npm run format

# Check only (CI mode — fails if any file isn't formatted)
npm run format:check
```

Expected output (`format:check`, clean):
```
$ prettier --check src/
Checking formatting...
All matched files use Prettier code style!
```

Expected output (`format:check`, unformatted files):
```
$ prettier --check src/
Checking formatting...
src/signals/signals/State.ts
Code style issues found in the above file. Run Prettier to fix.
```

**Format-on-save setup**: VS Code with the Prettier extension uses `editor.formatOnSave: true`. Prettier runs on every save for `src/` files, applying formatting and import sorting in one pass [ref: 02-dataflow.md#3-editor-integration-flow].

---

### UC-4: Adding a New Import

When a developer adds a new import to a file, the `@ianvs/prettier-plugin-sort-imports` plugin handles ordering automatically on save [ref: ../01-research/03-open-questions.md#Q1].

**Before save** (developer writes import anywhere):

```typescript
import { Batcher } from "../base";
import { merge } from "rxjs";
import { Signal } from "@/signals/signals/Signal";
import { BehaviorSubject } from "rxjs";
```

**After save** (Prettier sorts and groups):

```typescript
import { BehaviorSubject, merge } from "rxjs";

import { Signal } from "@/signals/signals/Signal";

import { Batcher } from "../base";
```

Group order enforced by `importOrder` in `.prettierrc` [ref: 03-model.md#1-prettierrc]:
1. `<BUILTIN_MODULES>` — Node.js builtins
2. `<THIRD_PARTY_MODULES>` — npm packages
3. `^@/(.*)$` — path alias imports
4. `^\\.\\./(.*)`  — parent-relative imports
5. `^\\./(.*)$` — sibling-relative imports

Blank lines between groups are inserted automatically (empty strings in `importOrder`). Duplicate specifiers from the same module are merged.

---

### UC-5: Adding a New Page to `apps/demos/`

The `.github/instructions/demos.instructions.md` file (with `applyTo: "apps/demos/**"`) provides AI agents with step-by-step guidance [ref: ../01-research/03-open-questions.md#Q13]. The content specification for this file is in [UC-13](#uc-13-content-specification-for-appsdemos-ai-instruction-file).

**Manual workflow summary** (detailed in the instruction file):

1. Create a new `.mdx` file in `apps/demos/src/pages/` (e.g., `EffectsPage.mdx`)
2. Import components and example namespaces:
   ```mdx
   import { LiveExample, QueryTabs } from "../components";
   import { Effects } from "../examples";
   ```
3. Add a `<Route>` in `apps/demos/src/app/App.tsx`:
   ```tsx
   <Route path="/effects" element={<EffectsPage />} />
   ```
4. Add a `<NavbarItem>` / `<Link>` in the navbar section of `App.tsx`
5. Create example files in `apps/demos/src/examples/effects/` with `?raw` imports in an `index.ts`

[ref: ../01-research/01-codebase-analysis.md#how-to-add-a-new-page]

---

### UC-6: CI Check Failure

When CI reports lint or format errors, the developer:

**Lint failure**:
1. Read the error output — it names the file, line, and rule (e.g., `@typescript-eslint/no-explicit-any`)
2. Fix the code or, if the rule is inappropriate for that case, add an inline `// eslint-disable-next-line` with justification
3. Run `npm run lint` locally to verify
4. Push the fix

**Format failure**:
1. Run `npm run format` locally — Prettier auto-formats all files including import sorting
2. Review the diff (`git diff`) to confirm changes are formatting-only
3. Commit and push

CI runs `prettier --check src/` which fails if any file differs from Prettier's output. Running `npm run format` locally resolves all formatting issues in one pass [ref: 02-dataflow.md#4-ci-pipeline-flow].

---

## Migration Paths

### UC-7: Initial Formatting Migration

Step-by-step procedure after all config files are in place:

1. **Run Prettier on `src/`**:
   ```bash
   npx prettier --write src/
   ```
   This applies formatting (indentation normalization, quote consistency, import sorting) to all files in `src/`.

2. **Commit the formatting changes**:
   ```bash
   git add src/
   git commit -m "style: apply Prettier formatting to src/"
   ```

3. **Record the commit SHA in `.git-blame-ignore-revs`**:
   ```bash
   # Get the SHA of the formatting commit
   git log -1 --format="%H"

   # Add it to .git-blame-ignore-revs
   echo "# Prettier initial formatting pass" >> .git-blame-ignore-revs
   echo "<SHA>" >> .git-blame-ignore-revs
   ```

4. **Configure git locally** to use the ignore file:
   ```bash
   git config blame.ignoreRevsFile .git-blame-ignore-revs
   ```
   GitHub UI respects `.git-blame-ignore-revs` natively — no configuration needed there [ref: ../01-research/03-open-questions.md#Q5].

5. **Commit `.git-blame-ignore-revs`** in a separate commit:
   ```bash
   git add .git-blame-ignore-revs
   git commit -m "chore: add .git-blame-ignore-revs for formatting commit"
   ```

[ref: 04-decisions.md#adr-4-initial-formatting-migration--git-blame-ignore-revs]

---

### UC-8: Vitest Import Removal

Step-by-step after `tsconfig.test.json` is created:

1. **Create `tsconfig.test.json`** at root (per spec in [03-model.md](03-model.md#4-tsconfigtestjson)).

2. **Remove explicit vitest imports from all test files**. This can be automated:

   Using find-and-replace (regex) across `src/**/*.test.ts` and `src/__tests__/**`:

   Pattern to remove lines like:
   ```
   import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
   import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
   ```

   Regex: `^import\s+\{[^}]+\}\s+from\s+['"]vitest['"];?\s*\n`

   Replace with: (empty string)

3. **Also update `src/__tests__/setup.ts`** — it imports `afterEach` and `beforeEach` from `'vitest'` explicitly [ref: ../01-research/01-codebase-analysis.md#src__tests__setupts].

4. **Verify tests still pass**:
   ```bash
   npm run test
   ```

5. **Verify IDE type resolution** — open a test file in VS Code, confirm `describe`, `it`, `expect`, `vi` are recognized without red squiggles.

Affected files (from research): every file listed in the vitest globals usage table [ref: ../01-research/01-codebase-analysis.md#vitest-globals-usage-in-test-files] plus `src/__tests__/setup.ts`.

---

### UC-9: `@testing-library/jest-dom` Removal

Per ADR-7 [ref: 04-decisions.md#adr-7-remove-testing-libraryjest-dom], the package is removed:

1. **Remove from `devDependencies`**:
   ```bash
   npm uninstall @testing-library/jest-dom
   ```

2. **Verify no imports exist** (there are none — confirmed by research [ref: ../01-research/01-codebase-analysis.md#vitest-globals-usage-in-test-files]):
   ```bash
   grep -r "jest-dom" src/
   # Expected: no results
   ```

3. **Verify tests still pass**:
   ```bash
   npm run test
   ```

No setup file changes needed — `@testing-library/jest-dom` was never added to `vitest.config.ts` `setupFiles` or imported anywhere.

---

## Edge Cases

### UC-10: Generated Files Exclusion

**Prettier**: `.prettierignore` excludes `dist/`, `coverage/`, `node_modules/`, and `apps/` [ref: 03-model.md#2-prettierignore]. Running `npm run format` never touches these directories.

**ESLint**: The root `eslint.config.ts` has global `ignores` for `dist/`, `coverage/`, `node_modules/`, `apps/` [ref: 03-model.md#5-root-eslintconfigts]. The demos `eslint.config.ts` ignores `node_modules/` [ref: 03-model.md#6-appsdemos-eslintconfigts].

Both tools naturally skip files outside their `files` glob and ignore patterns. No additional configuration needed for generated outputs.

---

### UC-11: MDX Files in `apps/demos/`

**ESLint**: The `apps/demos/eslint.config.ts` targets `src/**/*.{ts,tsx}` [ref: 03-model.md#6-appsdemos-eslintconfigts]. MDX files (`*.mdx`) are **not included** in the file glob — they are not linted. Adding MDX linting would require `eslint-plugin-mdx`, which is not part of the initial setup. MDX files contain mostly Markdown with JSX imports — TypeScript type-checking for the JSX imports happens via Vite's MDX plugin at build time.

**Prettier**: `apps/demos/` is entirely excluded from Prettier via `.prettierignore` [ref: 03-model.md#2-prettierignore]. MDX files are not formatted.

If MDX linting is desired in the future, `eslint-plugin-mdx` can be added to the demos config with a `files: ["src/**/*.mdx"]` override.

---

### UC-12: Path Alias `@/` in ESLint

The `@/` path alias (`@/*` → `src/*`) is defined in the root `tsconfig.json` [ref: ../01-research/01-codebase-analysis.md#root-tsconfigjson]. ESLint resolves it via `parserOptions.projectService: true` with `tsconfigRootDir: import.meta.dirname` [ref: 03-model.md#5-root-eslintconfigts].

**Root ESLint config**: `projectService` points at the root directory, so it discovers `tsconfig.json` with its `paths` config. TypeScript-aware ESLint rules (`@typescript-eslint/*`) resolve `@/` imports correctly through the TypeScript project service.

**Demos ESLint config**: `apps/demos/tsconfig.json` has no `@/` alias — it doesn't need one. The demos config's `projectService` with `tsconfigRootDir: import.meta.dirname` points at `apps/demos/`, resolving via the demos tsconfig [ref: ../01-research/01-codebase-analysis.md#appsdemos-tsconfigjson].

Since `eslint-plugin-import-x` is not used (ADR-6) [ref: 04-decisions.md#adr-6-skip-eslint-plugin-import-x], there is no separate resolver to configure for the `@/` alias. All path resolution is handled by TypeScript's project service within ESLint.

---

## AI Instruction File

### UC-13: Content Specification for `apps/demos/` AI Instruction File

The file `.github/instructions/demos.instructions.md` with `applyTo: "apps/demos/**"` [ref: ../01-research/03-open-questions.md#Q13] should cover the following content topics. This is a **content specification** — the actual file is created during implementation.

**YAML Frontmatter**:
- `name`: `"demos"`
- `description`: brief description for semantic matching (e.g., "Instructions for working with the rx-toolkit interactive demos app")
- `applyTo`: `"apps/demos/**"`

Format follows the existing instruction file pattern [ref: ../01-research/01-codebase-analysis.md#thoughtsworkflowinstructionsmd].

**Content Topics**:

#### Topic 1: Project Structure Overview
- Tech stack: React 19 + Vite + MDX + TailwindCSS v4 + HeroUI + react-live
- Key directories: `pages/`, `examples/`, `components/`, `utils/`
- Entry point: `main.tsx` → `App.tsx` (routing + navbar)
- Linked library: `@fozy-labs/rx-toolkit` via `file:../..`
- Type declarations: `vite-env.d.ts` for `*.mdx` module types and Vite client types

[ref: ../01-research/01-codebase-analysis.md#4-appsdemos-structure]

#### Topic 2: How to Add a New Page
- Create `.mdx` file in `src/pages/`
- Import components from `../components` (`LiveExample`, `QueryTabs`)
- Import example namespaces from `../examples`
- Add `<Route>` in `App.tsx` with path and element
- Add navigation link in the `<Navbar>` section of `App.tsx`
- Note: page component is the default export of the MDX file

[ref: ../01-research/01-codebase-analysis.md#how-to-add-a-new-page]

#### Topic 3: How to Add a New Example to an Existing Page
- Create `.tsx` file in the appropriate `src/examples/<category>/` directory
- Export a `function Base()` as the main component (required by `LiveExample.processExample()` — it appends `render(Base)`)
- Import the raw file in the category's `index.ts` using `?raw` suffix
- Add export to the `examples` object in that `index.ts`
- Reference in the MDX page via `<LiveExample initialCode={Namespace.examples.key} />`
- Note: example files use real import statements for readability, but `LiveExample.processExample()` strips all import lines via regex

[ref: ../01-research/01-codebase-analysis.md#how-to-add-a-new-example]

#### Topic 4: How to Add External Entities to the Sandbox Scope
- The `react-live` `<LiveProvider>` uses a `scope` object defined in `LiveExample.tsx`
- To make a new export from `@fozy-labs/rx-toolkit` available in examples: import it in `LiveExample.tsx` and add to the `defaultScope` object
- Same process for external packages (e.g., HeroUI components)
- `processExample()` strips import lines — scope object provides all identifiers at runtime

[ref: ../01-research/01-codebase-analysis.md#how-external-entities-are-imported-into-the-sandbox]

#### Topic 5: Key Components
- `LiveExample`: wraps `react-live` with import stripping, scope injection, and Prism syntax highlighting
- `QueryTabs`: tabbed container synced with URL `?tab=` query parameter
- Both re-exported from `components/index.ts`

#### Topic 6: Mock Utilities
- `utils/fetches.ts` provides mock API functions with simulated delays
- Examples import these for data fetching demos
- Pattern: function returns hardcoded data wrapped in `Promise` with `setTimeout`
