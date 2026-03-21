---
title: "Configuration Specifications"
date: 2026-03-18
stage: 02-design
role: rdpi-architect
workflow: b0.2
---

# Configuration Specifications

> **Note:** The configurations below are illustrative design specifications. Exact contents may be adjusted during the implementation stage.

## 1. `.prettierrc`

JSON format at repository root.

```jsonc
{
    "tabWidth": 4,
    "printWidth": 120,
    "plugins": ["@ianvs/prettier-plugin-sort-imports"],
    "importOrder": [
        "<BUILTIN_MODULES>",
        "",
        "<THIRD_PARTY_MODULES>",
        "",
        "^@/(.*)$",
        "",
        "^\\.\\./(.*)",
        "",
        "^\\./(.*)$"
    ]
}
```

### Option Rationale

| Option | Value | Rationale |
|--------|-------|-----------|
| `tabWidth` | `4` | Keep existing 4-space convention [ref: ../01-research/03-open-questions.md#Q7]; all sampled files use 4 spaces [ref: ../01-research/01-codebase-analysis.md#current-formatting-conventions-sampled-across-modules] |
| `printWidth` | `120` | User decision [ref: ../01-research/03-open-questions.md#Q12]; accommodates TypeScript generics and long type signatures |
| `singleQuote` | *(default: `false`)* | Double quotes — user decision matches existing `src/` convention [ref: ../01-research/03-open-questions.md#Q6]; `src/` predominantly uses double quotes [ref: ../01-research/01-codebase-analysis.md#current-formatting-conventions-sampled-across-modules] |
| `semi` | *(default: `true`)* | Semicolons present everywhere in codebase [ref: ../01-research/01-codebase-analysis.md#current-formatting-conventions-sampled-across-modules] |
| `trailingComma` | *(default: `"all"`)* | Trailing commas already present in multi-line constructs [ref: ../01-research/01-codebase-analysis.md#current-formatting-conventions-sampled-across-modules] |
| `arrowParens` | *(default: `"always"`)* | Prettier default; consistent with existing code |
| `endOfLine` | *(default: `"lf"`)* | Standard for cross-platform projects |
| `plugins` | `["@ianvs/prettier-plugin-sort-imports"]` | User chose Prettier plugin for import sorting [ref: ../01-research/03-open-questions.md#Q1] |

### Import Order Specification

The `importOrder` array with regex patterns and blank-line separators (empty strings):

| Position | Pattern | Matches | Example |
|----------|---------|---------|---------|
| 1 | `<BUILTIN_MODULES>` | Node.js builtins | `import { fileURLToPath } from "node:url"` |
| — | `""` | Blank line separator | |
| 2 | `<THIRD_PARTY_MODULES>` | npm packages | `import { BehaviorSubject } from "rxjs"` |
| — | `""` | Blank line separator | |
| 3 | `^@/(.*)$` | Path alias imports | `import { Signal } from "@/signals/signals/Signal"` |
| — | `""` | Blank line separator | |
| 4 | `^\\.\\./(.*)`  | Parent-relative imports | `import { Batcher } from "../base"` |
| — | `""` | Blank line separator | |
| 5 | `^\\./(.*)$` | Sibling-relative imports | `import { useSignal } from "./useSignal"` |

This matches the task requirement: external packages first → `@/` aliases → `../` relative → `./` local [ref: ../01-research/02-external-research.md#with-ianvsprettier-plugin-sort-imports].

Within each group, imports are sorted alphabetically by module specifier.

## 2. `.prettierignore`

```
apps/
dist/
coverage/
node_modules/
*.md
```

| Pattern | Rationale |
|---------|-----------|
| `apps/` | Demos excluded from formatting per user decision [ref: ../01-research/03-open-questions.md#Q14] |
| `dist/` | Build output — never format |
| `coverage/` | Coverage reports — never format |
| `node_modules/` | Dependencies — never format |
| `*.md` | Markdown files have manual formatting; Prettier Markdown reformatting can break intentional line breaks in docs |

## 3. `.editorconfig`

```ini
root = true

[*]
indent_style = space
indent_size = 4
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false

[*.{json,yml,yaml}]
indent_size = 2
```

| Section | Key Settings | Rationale |
|---------|-------------|-----------|
| `[*]` | 4 spaces, LF, UTF-8, trim trailing, final newline | Matches existing conventions [ref: ../01-research/01-codebase-analysis.md#current-formatting-conventions-sampled-across-modules]; LF for cross-platform consistency |
| `[*.md]` | No trailing whitespace trim | Trailing spaces are significant in Markdown (line breaks) |
| `[*.{json,yml,yaml}]` | 2-space indent | JSON/YAML convention; `package.json` already uses 2 spaces |

## 4. `tsconfig.test.json`

```jsonc
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "types": ["vitest/globals"],
        "noEmit": true
    },
    "include": ["src/**/*.test.ts", "src/__tests__/**"],
    "exclude": ["node_modules", "dist"]
}
```

### Design Details

| Field | Value | Rationale |
|-------|-------|-----------|
| `extends` | `"./tsconfig.json"` | Inherits all compiler options: `strict`, `jsx`, `paths`, `moduleResolution`, `target`, `module` [ref: ../01-research/02-external-research.md#established-practices] |
| `types` | `["vitest/globals"]` | Provides global type declarations for `describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach` without explicit imports [ref: ../01-research/02-external-research.md#vitest-test-typing] |
| `noEmit` | `true` | Test files are never compiled to JS output |
| `include` | `["src/**/*.test.ts", "src/__tests__/**"]` | Covers co-located test files (`*.test.ts`) and the test helpers directory (`__tests__/`) — these are exactly the patterns excluded by the main `tsconfig.json` [ref: ../01-research/01-codebase-analysis.md#root-tsconfigjson] |
| `exclude` | `["node_modules", "dist"]` | Override the main tsconfig's `exclude` which includes `**/*.test.ts` — without this override, `extends` would inherit the test exclusion and negate the `include` |

**Note on `types` array**: When `types` is specified in tsconfig, TypeScript only includes the listed type packages from `@types/`. Since the main `tsconfig.json` does NOT specify `types`, it auto-includes all `@types/*`. By specifying `types: ["vitest/globals"]` here, we must ensure that other needed types (`@types/node`, `@types/react`) are still resolved. Since `extends` inherits the base config and `types` from the child **replaces** (not merges), the test config should also include the types needed for test files. However, in practice, `@types/node` and `@types/react` are resolved through module imports rather than global `types` — so specifying only `["vitest/globals"]` is correct for this use case.

## 5. Root `eslint.config.ts`

```typescript
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default tseslint.config(
    // Global ignores
    {
        ignores: ["dist/", "coverage/", "apps/", "node_modules/", "**/*.test.ts", "src/__tests__/**"],
    },

    // Base JS rules
    js.configs.recommended,

    // TypeScript strict rules with typed linting
    ...tseslint.configs.strict,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },

    // Custom rule overrides
    {
        files: ["src/**/*.ts"],
        rules: {
            // Relax rules that don't fit the library's coding patterns
            // (specific rules to be determined during implementation after initial triage)
        },
    },

    // Prettier compatibility — must be last
    eslintConfigPrettier,
);
```

### Structure Breakdown

| Layer | Source | Purpose |
|-------|--------|---------|
| Global ignores | `ignores` config object | Exclude non-library files; exclude test files from strict src/ rules |
| JS recommended | `@eslint/js` | Baseline JS correctness (no-undef, no-unused-vars, etc.) [ref: ../01-research/02-external-research.md#preset-packages] |
| TS strict | `typescript-eslint` | Stricter TS rules: `no-explicit-any`, `no-non-null-assertion`, `prefer-nullish-coalescing`, etc. [ref: ../01-research/02-external-research.md#recommended-rule-sets-for-a-library-project] |
| Typed linting | `parserOptions.projectService` | Enable rules that require type info (e.g., `no-floating-promises`, `no-misused-promises`) |
| Custom overrides | `rules` object | Disable/adjust rules after initial triage during implementation |
| Prettier compat | `eslint-config-prettier/flat` | Turn off all formatting-related rules [ref: ../01-research/02-external-research.md#prettier-eslint-coexistence-eslint-config-prettier] |

**Note on test files**: Test files (`**/*.test.ts`, `src/__tests__/**`) are in the global `ignores` for the root ESLint config. This means they are **not linted** by the root config. A future enhancement could add a separate test-file config layer with relaxed rules, but for the initial setup, tests are excluded from ESLint to minimize noise. TypeScript type-checking for tests is handled via `tsconfig.test.json`.

## 6. `apps/demos/eslint.config.ts`

```typescript
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default tseslint.config(
    // Global ignores
    {
        ignores: ["node_modules/"],
    },

    // Base JS rules
    js.configs.recommended,

    // TypeScript recommended rules (less strict for demos)
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },

    // React Hooks rules
    {
        files: ["src/**/*.{ts,tsx}"],
        plugins: {
            "react-hooks": reactHooks,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
        },
    },

    // Prettier compatibility — must be last
    eslintConfigPrettier,
);
```

### Structure Breakdown

| Layer | Source | Purpose |
|-------|--------|---------|
| Global ignores | `ignores` | Exclude `node_modules/` |
| JS recommended | `@eslint/js` | Same baseline as root |
| TS recommended | `typescript-eslint` | Less strict than root — demos are a sandbox [ref: ../01-research/03-open-questions.md#Q4] |
| Typed linting | `parserOptions.projectService` | Points at `apps/demos/tsconfig.json` via `tsconfigRootDir` |
| React Hooks | `eslint-plugin-react-hooks` | Enforces Rules of Hooks (`rules-of-hooks`, `exhaustive-deps`) — highest-value React rule [ref: ../01-research/02-external-research.md#preset-packages] |
| Prettier compat | `eslint-config-prettier/flat` | Even though Prettier doesn't format demos, the config is harmless and protects against future scope changes |

**Note on `eslint-config-prettier` in demos**: Even though Prettier is excluded from `apps/demos/` via `.prettierignore`, including `eslint-config-prettier` in the demos ESLint config is a defensive best practice. If formatting scope is ever extended to include demos, no ESLint rule conflicts will arise. The config is a no-op when there are no conflicting rules.

## 7. `package.json` Modifications

### New `devDependencies` (root)

```jsonc
{
    "devDependencies": {
        // ... existing deps ...
        "prettier": "^3.5.0",
        "@ianvs/prettier-plugin-sort-imports": "^4.4.0",
        "eslint": "^9.20.0",
        "@eslint/js": "^9.20.0",
        "typescript-eslint": "^8.25.0",
        "eslint-config-prettier": "^10.1.0",
        "jiti": "^2.4.0"
    }
}
```

> **Removed**: `@testing-library/jest-dom` — unused [ref: ../01-research/01-codebase-analysis.md#vitest-globals-usage-in-test-files]

### New `scripts` (root)

```jsonc
{
    "scripts": {
        // ... existing scripts ...
        "lint": "eslint src/",
        "lint:fix": "eslint src/ --fix",
        "format": "prettier --write src/",
        "format:check": "prettier --check src/"
    }
}
```

> The existing `ts-check` script (`tsc --noEmit`) already covers type checking. No rename needed — it works.

### New `devDependencies` (`apps/demos/package.json`)

```jsonc
{
    "devDependencies": {
        // ... existing deps ...
        "eslint": "^9.20.0",
        "@eslint/js": "^9.20.0",
        "typescript-eslint": "^8.25.0",
        "eslint-plugin-react-hooks": "^5.2.0",
        "eslint-config-prettier": "^10.1.0",
        "jiti": "^2.4.0"
    }
}
```

### New `scripts` (`apps/demos/package.json`)

```jsonc
{
    "scripts": {
        "dev": "vite",
        "lint": "eslint src/"
    }
}
```

## 8. `.git-blame-ignore-revs`

```
# Prettier initial formatting pass
# (SHA to be added after the formatting commit)
<COMMIT_SHA>
```

This file is created during implementation. The SHA of the initial formatting commit is added after it's created. GitHub natively respects this file in the blame UI [ref: ../01-research/03-open-questions.md#Q5].

The repository's `.gitconfig` or `CONTRIBUTING.md` should document:
```
git config blame.ignoreRevsFile .git-blame-ignore-revs
```
