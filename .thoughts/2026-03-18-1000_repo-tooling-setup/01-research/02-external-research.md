---
title: "External Research: Repository Tooling Setup"
date: 2026-03-18
stage: 01-research
role: rdpi-external-researcher
workflow: b0.2
---

# External Research: Repository Tooling Setup

## 1. Vitest Test Typing

### Comparative Analysis: Approaches to Vitest Global Types

| Approach | Mechanism | Pros | Cons | Confidence |
|----------|-----------|------|------|------------|
| `compilerOptions.types: ["vitest/globals"]` in main `tsconfig.json` | Adds vitest global type declarations to all files in the project | Simple, single config change | Pollutes non-test files with test globals (`describe`, `it`, `expect`, `vi`); IDE will autocomplete test functions in source files | **High** |
| `compilerOptions.types: ["vitest/globals"]` in a separate `tsconfig.test.json` | Separate TS config for test files only | Clean separation — test types only available in test files; main `tsconfig.json` stays unpolluted | Requires maintaining two tsconfig files; IDE may not auto-switch between configs without explicit project references or editor support | **High** |
| `/// <reference types="vitest/globals" />` in a `.d.ts` file (e.g., `vitest.d.ts`) | Triple-slash directive in a declaration file included in the project | Works if the `.d.ts` is included in `tsconfig.json` `include`; can be scoped | Fragile if tsconfig excludes the `.d.ts`; less discoverable than tsconfig approach | **High** |
| Explicit imports from `vitest` (no globals) | `import { describe, it, expect, vi } from 'vitest'` in every test file | No type configuration needed; fully explicit; best discoverability | Verbose — every test file needs imports; deviates from `globals: true` runtime config | **High** |

**Source**: [Vitest docs — globals config](https://vitest.dev/config/globals) — "To get TypeScript working with the global APIs, add `vitest/globals` to the `types` field in your `tsconfig.json`."

### Established Practices

- **Official recommendation**: Vitest docs recommend adding `"vitest/globals"` to `compilerOptions.types` when `globals: true` is set in vitest config. **Confidence: High** — [vitest.dev/config/globals](https://vitest.dev/config/globals)

- **Separate `tsconfig.test.json` pattern**: Widely used in larger projects to prevent vitest globals from leaking into source code. The test tsconfig extends the main one with `"extends": "./tsconfig.json"` and overrides `include` to cover test files, adds `"types": ["vitest/globals"]`. The main tsconfig typically excludes test files (e.g., `"exclude": ["**/*.test.ts", "src/__tests__/**"]`). **Confidence: High** — common pattern across vitest GitHub examples and community guides.

- **`typeRoots` caveat**: If `typeRoots` is redefined in tsconfig, you must add `node_modules` back to make `vitest/globals` discoverable. Vitest docs explicitly warn about this. **Confidence: High** — [vitest.dev/config/globals](https://vitest.dev/config/globals)

### `@testing-library/jest-dom` Integration with Vitest

- `@testing-library/jest-dom` provides custom matchers like `.toBeInTheDocument()`, `.toHaveTextContent()`, etc. These matchers need to be both registered at runtime (via `setupFiles`) and typed in TypeScript. **Confidence: High**

- **Runtime setup**: In vitest `setupFiles`, import `@testing-library/jest-dom` (or `@testing-library/jest-dom/vitest` if available). This calls `expect.extend(...)` to register the matchers. **Confidence: High** — [testing-library/jest-dom README](https://github.com/testing-library/jest-dom)

- **Type declarations**: `@testing-library/jest-dom` v6+ ships its own type declarations. For vitest, you need to either:
  1. Add `@testing-library/jest-dom` to `compilerOptions.types` in tsconfig (alongside `vitest/globals`), or
  2. Add `/// <reference types="@testing-library/jest-dom" />` in a `.d.ts` file, or
  3. Import it in the setup file — some versions auto-augment the `vitest` `Assertion` interface.
  **Confidence: Medium** — exact mechanism depends on jest-dom version; v6 introduced `@testing-library/jest-dom/vitest` entry point specifically for vitest compatibility.

- **Vitest extending matchers pattern**: Vitest docs describe the `expect.extend()` API and recommend augmenting the `Assertion` interface via module declaration in a `.d.ts` file for custom matchers. This same pattern applies to jest-dom. **Confidence: High** — [vitest.dev/guide/extending-matchers](https://vitest.dev/guide/extending-matchers)

### Vitest 4.x Typing Notes

- Vitest 4.x (released 2025) introduced breaking changes from v3. The migration guide covers changes to configuration and API. **Confidence: Medium** — vitest.dev lists a migration guide at `/guide/migration#vitest-4` but specific typing issues have not been broadly documented as problematic.

- No widely reported TypeScript typing regressions specific to vitest 4.x were found in the research. The `vitest/globals` type augmentation mechanism remains the same as in v2/v3. **Confidence: Medium** — absence of evidence in primary sources.

## 2. ESLint for TypeScript + React

### Flat Config vs. Legacy

| Aspect | Flat Config (`eslint.config.js`) | Legacy (`.eslintrc.*`) | Confidence |
|--------|----------------------------------|------------------------|------------|
| Status in 2026 | **Recommended** for all new projects. Default format since ESLint v9.0.0 (2024). | Deprecated. Removed in ESLint v10 plans. | **High** |
| TypeScript support | Supported via `eslint.config.ts` (requires `jiti` or Node.js 22.13+ with `--experimental-strip-types`) | Supported via `.eslintrc.js` | **High** |
| Plugin configuration | Plugins are JS objects assigned to `plugins` key directly. `extends` uses config objects/arrays. | Plugins referenced by string name. `extends` uses string config names. | **High** |
| `defineConfig` helper | Available directly from `eslint/config` — provides type checking and documentation. | Not available. | **High** |
| Config inspector | Built-in `--inspect-config` CLI flag for debugging. | Not available. | **High** |

**Source**: [ESLint docs — Configuration Files](https://eslint.org/docs/latest/use/configure/configuration-files) — flat config is the only documented format on the main docs site.

**Source**: [typescript-eslint Getting Started](https://typescript-eslint.io/getting-started/) — all examples use flat config by default.

### Preset Packages

| Package | What It Provides | Confidence |
|---------|-----------------|------------|
| `@eslint/js` | Core ESLint recommended rules (`js/recommended`). Base JavaScript linting rules for correctness. | **High** — [eslint.org](https://eslint.org/docs/latest/use/configure/configuration-files) |
| `typescript-eslint` | TypeScript-aware ESLint rules. Provides `tseslint.configs.recommended`, `strict`, `stylistic`. Includes the TypeScript parser (`@typescript-eslint/parser`). Uses type information for advanced rules (typed linting). | **High** — [typescript-eslint.io](https://typescript-eslint.io/getting-started/) |
| `eslint-plugin-react` | React-specific linting rules: JSX validation, prop types, hooks usage patterns, React API best practices. | **High** — [github.com/jsx-eslint/eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) |
| `eslint-plugin-react-hooks` | Enforces Rules of Hooks (`rules-of-hooks`) and exhaustive deps for `useEffect`/`useMemo`/`useCallback`. Maintained by Meta/React team. | **High** — [npmjs.com/package/eslint-plugin-react-hooks](https://www.npmjs.com/package/eslint-plugin-react-hooks) |
| `eslint-plugin-import` | Original import linting: `no-unresolved`, `order`, `no-duplicates`, `first`, `newline-after-import`. Stale maintenance, 117 dependencies trade chain, doesn't support `exports` field. | **High** — [github.com/import-js/eslint-plugin-import](https://github.com/import-js/eslint-plugin-import) |
| `eslint-plugin-import-x` | Modern fork of `eslint-plugin-import`. Built with TypeScript, uses `unrs-resolver` (Rust-based), 16 dependencies. Supports `exports` field, flat config natively. Actively maintained. Provides `flatConfigs.recommended` and `flatConfigs.typescript`. | **High** — [github.com/un-ts/eslint-plugin-import-x](https://github.com/un-ts/eslint-plugin-import-x) |

### Path Alias Resolution (`@/*`)

- **`eslint-import-resolver-typescript`**: The standard resolver for TypeScript projects using path aliases. Reads `tsconfig.json` `paths` field and resolves aliases accordingly. Required by both `eslint-plugin-import` and `eslint-plugin-import-x` for TypeScript path resolution. **Confidence: High** — [github.com/import-js/eslint-import-resolver-typescript](https://github.com/import-js/eslint-import-resolver-typescript)

- **`eslint-plugin-import-x` with TypeScript**: Uses `get-tsconfig` instead of `tsconfig-paths` + full `typescript` package. For flat config, use `import-x/resolver-next` with `createTypeScriptImportResolver()`. The resolver automatically picks up `paths` from `tsconfig.json`. **Confidence: High** — [eslint-plugin-import-x README](https://github.com/un-ts/eslint-plugin-import-x)

- **`import-x/internal-regex` setting**: Can mark `@scope/` prefixed imports as internal. For `@/*` aliases this setting can help categorize them separately from npm `@scope` packages. Example: `"import-x/internal-regex": "^@/"`. **Confidence: High** — [eslint-plugin-import-x settings docs](https://github.com/un-ts/eslint-plugin-import-x#import-xinternal-regex)

### Recommended Rule Sets for a Library Project

- **`@eslint/js` → `js/recommended`**: Baseline JS correctness rules. **Confidence: High**
- **`typescript-eslint` → `tseslint.configs.strict`**: Superset of `recommended`, catches more bugs. Appropriate for libraries that want maximum correctness. **Confidence: High** — [typescript-eslint.io/users/configs](https://typescript-eslint.io/users/configs)
- **`typescript-eslint` → `tseslint.configs.stylistic`**: Consistent code style for TypeScript constructs (prefer `interface` vs `type`, etc.). Optional but common in libraries. **Confidence: High**
- **Library-specific considerations**: Libraries often enable `no-default-export` (or the `import-x` equivalent) to enforce named exports for better tree-shaking. They may relax `no-console` or use `warn` instead of `error`. **Confidence: Medium** — opinion-based but commonly cited pattern.

### Different Rules for Test Files vs. Source Files

- **ESLint flat config cascading**: The native way in flat config. Use `files` patterns to apply different rule sets:
  ```js
  // Stricter rules for src/
  { files: ["src/**/*.ts"], rules: { ... } },
  // Relaxed rules for tests
  { files: ["**/*.test.ts", "src/__tests__/**"], rules: { ... } },
  ```
  **Confidence: High** — [ESLint docs on cascading configuration](https://eslint.org/docs/latest/use/configure/configuration-files)

- **Common test file relaxations**: Disable `@typescript-eslint/no-explicit-any`, relax `@typescript-eslint/no-non-null-assertion`, allow `no-unused-expressions` (for assertion chains), disable `import-x/no-extraneous-dependencies` (test-only packages). **Confidence: Medium** — commonly cited but project-specific.

## 3. Prettier + Import Sorting

### Prettier Configuration Best Practices

- **Key options for TypeScript/React**: `singleQuote`, `semi`, `trailingComma`, `tabWidth`, `printWidth`, `arrowParens`, `endOfLine`. **Confidence: High** — [prettier.io/docs/en/options](https://prettier.io/docs/en/options)
- **Default values (Prettier 3.x+)**: `trailingComma: "all"` (changed from `"es5"` in v3), `endOfLine: "lf"`, `arrowParens: "always"`, `tabWidth: 2`, `printWidth: 80`, `semi: true`, `singleQuote: false`. **Confidence: High**
- **Best practice**: Store config in `.prettierrc` or `prettier.config.mjs`. Add `.prettierignore` for `dist/`, `coverage/`, `node_modules/`. **Confidence: High**
- **Plugin loading**: Since Prettier 3.0, plugins must be explicitly listed in the `plugins` config array. **Confidence: High** — [prettier.io/docs/en/plugins](https://prettier.io/docs/en/plugins)

### Import Sorting Plugins Comparison

| Plugin | Stars | Approach | Last Active | Pros | Cons | Confidence |
|--------|-------|----------|-------------|------|------|------------|
| `@ianvs/prettier-plugin-sort-imports` | 1.4k | Prettier plugin, regex-based `importOrder` | Feb 2026 (v4.7.1) | Does not reorder across side-effect imports; combines imports from same source; supports `<TYPES>`, `<BUILTIN_MODULES>`, `<THIRD_PARTY_MODULES>` grouping keywords; handles comments properly; blank line separation via empty strings in `importOrder` | Modifies AST (against Prettier conventions); Prettier-only (no standalone ESLint fix) | **High** |
| `@trivago/prettier-plugin-sort-imports` | 3.9k | Prettier plugin, regex-based `importOrder` | Jan 2026 (v6.0.2) | Oldest/most popular; `importOrderSeparation`, `importOrderSortSpecifiers`, `<THIRD_PARTY_MODULES>` keyword; supports v6 with modern features | More issues (86 open); side-effect ordering was less safe historically; options API differs from `@ianvs` fork | **High** |
| `prettier-plugin-organize-imports` | ~1.5k | Prettier plugin, uses TypeScript's `organizeImports` API | Moderate activity | Leverages TypeScript's own organize imports; removes unused imports | Limited grouping control; depends on TypeScript compiler; less flexible for custom group ordering | **Medium** |
| `eslint-plugin-simple-import-sort` | 2.4k | ESLint rule with autofix | Active (v12.x) | Zero dependencies; Prettier-friendly; powerful `groups` regex option; sorts both imports and exports; handles comments; git-diff-friendly (sorts on `from`); used by 162k repos | ESLint-based (not Prettier); requires ESLint integration; might produce odd whitespace that Prettier then fixes | **High** |

**Sources**: GitHub repos for each plugin (stars, last commit, README).

### Configuring Import Group Order: External → `@/` → `../` → `./`

#### With `@ianvs/prettier-plugin-sort-imports`:
```json
{
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
Empty strings produce blank lines between groups. This matches the desired order exactly. **Confidence: High** — [IanVS/prettier-plugin-sort-imports README, examples 3 and 6](https://github.com/IanVS/prettier-plugin-sort-imports#3-add-spaces-between-import-groups)

#### With `eslint-plugin-simple-import-sort`:
```json
{
  "simple-import-sort/imports": ["error", {
    "groups": [
      ["^\\u0000"],
      ["^node:"],
      ["^@?\\w"],
      ["^@/"],
      ["^\\.\\./"],
      ["^\\./?$", "^\\./.+"]
    ]
  }]
}
```
Each inner array is separated by blank lines. `^@/` matches the alias group distinct from npm `@scope` packages (which match `^@?\\w`). **Confidence: High** — [eslint-plugin-simple-import-sort custom grouping docs](https://github.com/lydell/eslint-plugin-simple-import-sort#custom-grouping)

#### With `@trivago/prettier-plugin-sort-imports`:
```json
{
  "importOrder": [
    "<BUILTIN_MODULES>",
    "<THIRD_PARTY_MODULES>",
    "^@/(.*)$",
    "^\\.\\./(.*)$",
    "^\\./(.*)$"
  ],
  "importOrderSeparation": true,
  "importOrderSortSpecifiers": true
}
```
**Confidence: High** — [trivago/prettier-plugin-sort-imports README](https://github.com/trivago/prettier-plugin-sort-imports)

### Prettier vs. ESLint for Import Sorting — Trade-offs

| Aspect | Prettier Plugin | ESLint Rule | Confidence |
|--------|----------------|-------------|------------|
| **When it runs** | On format (`prettier --write`) | On lint fix (`eslint --fix`) | **High** |
| **Integration** | Zero ESLint config; works wherever Prettier runs | Requires ESLint setup; may need parser config | **High** |
| **Conflict risk** | Inherently no conflict with Prettier (it IS Prettier) | May produce whitespace Prettier then reformats (benign) | **High** |
| **AST modification** | Modifies AST (technically against Prettier philosophy) | Standard ESLint autofix pattern | **High** |
| **Error reporting** | No lint errors; silently reforms on save | Reports errors in CI; can block PRs | **High** |
| **Flexibility** | Limited to plugin's options | Full regex power; can combine with other import rules | **Medium** |

**Established practice**: Many projects use `eslint-plugin-simple-import-sort` for import ordering (as an ESLint rule) combined with Prettier for all other formatting. The two tools cooperate well — ESLint sorts imports, Prettier handles whitespace/style. The `eslint-plugin-simple-import-sort` author explicitly recommends using Prettier alongside. **Confidence: High** — [eslint-plugin-simple-import-sort README](https://github.com/lydell/eslint-plugin-simple-import-sort#the-sorting-autofix-causes-some-odd-whitespace)

**Alternative**: Using a Prettier import sorting plugin means a single tool handles everything. This is simpler but less flexible and cannot report errors in CI (only silently fix). **Confidence: High**

### Prettier-ESLint Coexistence (`eslint-config-prettier`)

- **`eslint-config-prettier`** (5.9k stars): Turns off all ESLint rules that are unnecessary or might conflict with Prettier. Must be placed last in the config chain. **Confidence: High** — [github.com/prettier/eslint-config-prettier](https://github.com/prettier/eslint-config-prettier)

- **Flat config usage**:
  ```js
  import eslintConfigPrettier from "eslint-config-prettier/flat";
  export default [
    // ... other configs
    eslintConfigPrettier, // must be last
  ];
  ```
  **Confidence: High**

- **Automatically handles plugins**: Turns off conflicting rules from `@typescript-eslint`, `eslint-plugin-react`, `@stylistic`, `eslint-plugin-unicorn`, etc. — all from a single config entry. **Confidence: High**

- **CLI helper tool**: `npx eslint-config-prettier path/to/file.js` checks if your config has rules that conflict with Prettier. Useful for validation. **Confidence: High**

- **Important caveat for flat config**: Plugin names must match the canonical names. If you rename a plugin (e.g., `ts` instead of `@typescript-eslint`), `eslint-config-prettier` won't know to turn off its rules. **Confidence: High** — explicitly documented in the README.

- **`eslint-plugin-prettier` is NOT recommended**: Running Prettier as an ESLint rule via `eslint-plugin-prettier` is the old approach. The current best practice is to run Prettier and ESLint as separate steps. This avoids performance overhead and `arrow-body-style`/`prefer-arrow-callback` conflicts. **Confidence: High** — [prettier.io/docs/en/integrating-with-linters](https://prettier.io/docs/en/integrating-with-linters)

## 4. AI Instruction Files for VS Code

### Supported Formats

| File Type | Location | Behavior | Confidence |
|-----------|----------|----------|------------|
| `.github/copilot-instructions.md` | Workspace root `.github/` | Always-on — applied to every chat request in the workspace | **High** |
| `*.instructions.md` | `.github/instructions/` (and subdirs), `.claude/rules/`, user profile folders | File-based — applied conditionally based on `applyTo` glob or description match | **High** |
| `AGENTS.md` | Workspace root (or subfolders with experimental setting) | Always-on — recognized by multiple AI agents | **High** |
| `CLAUDE.md` | Workspace root, `.claude/`, user home `~/.claude/` | Always-on — for Claude Code compatibility | **High** |

**Source**: [VS Code docs — Custom Instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions) (updated March 2026)

### Instructions File Format

```markdown
---
name: 'Display Name'
description: 'Short description shown on hover'
applyTo: '**/*.ts'
---

# Instructions content in Markdown
```

**Frontmatter fields**:
- `name` (optional): Display name in UI. Defaults to filename.
- `description` (optional): Shown on hover. Also used for semantic matching to current task.
- `applyTo` (optional): Glob pattern for automatic application. If omitted, file is available manually but not applied automatically.

**Confidence: High** — [VS Code docs — Instructions file format](https://code.visualstudio.com/docs/copilot/customization/custom-instructions#_instructions-file-format)

### `applyTo` Glob Pattern Mechanism

- **Pattern evaluation**: Glob patterns are evaluated relative to the workspace root. Standard glob syntax with `*`, `**`, `?`, `{}` grouping.
- **Examples**:
  - `**/*.ts` — all TypeScript files
  - `**/*.test.ts` — all test files
  - `apps/demos/**` — everything under apps/demos
  - `src/query/**/*.ts` — TypeScript files in the query module
  - `**` — all files (effectively always-on for any file-related task)
- **Matching behavior**: When the agent works on a file matching the glob, the instructions are automatically included in the chat context. Multiple instruction files can match the same file — VS Code combines them (no guaranteed order).
- **Semantic matching**: If `description` is provided, VS Code may also apply the instruction when the description semantically matches the task, even without a file match.

**Confidence: High** — [VS Code docs](https://code.visualstudio.com/docs/copilot/customization/custom-instructions)

### Best Practices for Structuring Instruction Files

- **Keep instructions short and self-contained**. Each file should cover one topic or scope. **Confidence: High** — VS Code docs "Tips for writing effective instructions"

- **Include reasoning behind rules** — when the AI understands *why*, it makes better decisions in edge cases. Example: "Use `date-fns` instead of `moment.js` because moment.js is deprecated and increases bundle size." **Confidence: High** — VS Code docs

- **Show concrete code examples** — preferred patterns and anti-patterns. The AI responds better to examples than abstract rules. **Confidence: High** — VS Code docs

- **Focus on non-obvious rules** — skip conventions that linters/formatters already enforce. **Confidence: High** — VS Code docs

- **Organize by topic in subdirectories**:
  ```
  .github/instructions/
    frontend/
      react.instructions.md
      accessibility.instructions.md
    backend/
      api-design.instructions.md
    testing/
      unit-tests.instructions.md
  ```
  **Confidence: High** — VS Code docs example

- **Reference context with Markdown links** — instruction files can link to other files or URLs for the agent to follow. **Confidence: High**

- **Reuse instruction files** — can be referenced from prompt files and custom agents via `#instructions` syntax. **Confidence: High**

- **Generation support**: `/create-instruction` chat command can generate an instruction file from a description. `/init` analyzes workspace and generates `copilot-instructions.md`. **Confidence: High**

## Opinions and Speculation

- **"Always use a separate `tsconfig.test.json`"**: This is a common recommendation on blogs and StackOverflow, but the Vitest docs themselves only mention adding to the main tsconfig. The separate config approach is best practice for larger projects where IDE pollution is a concern, but it adds maintenance overhead. Not strictly necessary for small-to-medium projects.

- **"Use `eslint-plugin-import-x` over `eslint-plugin-import`"**: This is becoming consensus in the TypeScript community due to `eslint-plugin-import`'s stalled maintenance, but `eslint-plugin-import` still has much higher usage (millions of weekly downloads). The fork is the clear choice for new projects in 2026 but may lack some ecosystem compatibility.

- **"Prettier import sorting is simpler than ESLint-based"**: This depends on workflow. If the project already uses ESLint, adding import sorting there keeps tool count down and provides CI error reporting. If the project is Prettier-only, a Prettier plugin is simpler. Both approaches are valid.

- **"`@ianvs/prettier-plugin-sort-imports` vs `@trivago/prettier-plugin-sort-imports`"**: The `@ianvs` fork is generally recommended over the original `@trivago` plugin due to better side-effect handling, comment support, blank line control, and combined type imports. The `@trivago` v6 has narrowed the gap but the `@ianvs` fork remains more feature-complete per its README.

## Pitfalls

- **Vitest globals + IDE autocomplete pollution**: Adding `vitest/globals` to the main tsconfig causes the IDE to suggest `describe`, `it`, `expect` in non-test files. Mitigated by a separate `tsconfig.test.json`. **Confidence: High**

- **Flat config plugin naming**: `eslint-config-prettier` only disables rules for plugins using their canonical names. Non-standard names (e.g., `ts` instead of `@typescript-eslint`) won't be handled. **Confidence: High** — [eslint-config-prettier README](https://github.com/prettier/eslint-config-prettier#eslintconfigjs-flat-config-plugin-caveat)

- **Side-effect import reordering**: Both Prettier and ESLint import sorting plugins handle side-effect imports (`import "./polyfill"`) differently. `@ianvs` keeps them in place by default; `@trivago` v6 has `importOrderSideEffects: true` by default (sorts them); `eslint-plugin-simple-import-sort` never sorts side-effect-only imports. Be aware of your tool's default behavior. **Confidence: High**

- **`@/*` alias confusion with npm scoped packages**: Both `@/utils` (local alias) and `@scope/package` (npm) start with `@`. Import sorting regex must distinguish them. The pattern `^@/` specifically matches the alias (since npm scoped packages are `@scope/name`, not `@/`). **Confidence: High**

- **ESLint TypeScript config file support**: `eslint.config.ts` requires `jiti` (v2.2.0+) as a dev dependency, or Node.js 22.13+ with experimental flags. Not all CI environments may support this. Using `.mjs` extension is safer for broad compatibility. **Confidence: High** — [ESLint docs](https://eslint.org/docs/latest/use/configure/configuration-files#typescript-configuration-files)

## Performance

- **`eslint-plugin-import-x` vs `eslint-plugin-import`**: The fork uses `unrs-resolver` (Rust-based) instead of Node.js `resolve` package, and `get-tsconfig` instead of `tsconfig-paths` + `typescript`. This results in significantly faster resolution, especially in large monorepos. The dependency count is 16 vs 117. **Confidence: High** — [eslint-plugin-import-x README differences section](https://github.com/un-ts/eslint-plugin-import-x#differences)

- **Prettier import sorting performance**: Prettier plugins run within the Prettier formatting pass. The `@ianvs` and `@trivago` plugins use Babel parser for AST analysis, which adds overhead per file. For large codebases, ESLint-based sorting may be faster due to parser reuse. **Confidence: Medium** — no benchmarks found, but architecturally plausible.

- **`eslint-plugin-simple-import-sort` performance**: Zero dependencies, minimal processing. Sorts are done on the `from` string using `Intl.Collator`. No resolver calls needed (unlike `import/order` which verifies paths). Very fast. **Confidence: High** — [eslint-plugin-simple-import-sort README](https://github.com/lydell/eslint-plugin-simple-import-sort)

## Sources

- [Vitest docs — Getting Started](https://vitest.dev/guide/) — project setup, configuration basics
- [Vitest docs — globals config](https://vitest.dev/config/globals) — TypeScript typing for vitest globals
- [Vitest docs — Testing Types](https://vitest.dev/guide/testing-types) — type-level testing with vitest
- [ESLint docs — Configuration Files](https://eslint.org/docs/latest/use/configure/configuration-files) — flat config format, `defineConfig`, `files`/`ignores` patterns
- [typescript-eslint — Getting Started](https://typescript-eslint.io/getting-started/) — setup, configs (recommended/strict/stylistic), typed linting
- [eslint-plugin-import-x](https://github.com/un-ts/eslint-plugin-import-x) — modern import linting, flat config support, TypeScript resolver
- [eslint-config-prettier](https://github.com/prettier/eslint-config-prettier) — disabling ESLint rules that conflict with Prettier
- [Prettier docs — Options](https://prettier.io/docs/en/options) — all Prettier formatting options
- [@ianvs/prettier-plugin-sort-imports](https://github.com/IanVS/prettier-plugin-sort-imports) — import sorting Prettier plugin (fork), 1.4k stars
- [@trivago/prettier-plugin-sort-imports](https://github.com/trivago/prettier-plugin-sort-imports) — original import sorting Prettier plugin, 3.9k stars
- [eslint-plugin-simple-import-sort](https://github.com/lydell/eslint-plugin-simple-import-sort) — ESLint-based import sorting, 2.4k stars, 162k dependents
- [VS Code docs — Custom Instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions) — instruction file format, `applyTo` patterns, best practices
- [VS Code docs — Customize AI](https://code.visualstudio.com/docs/copilot/copilot-customization) — overview of all AI customization options
