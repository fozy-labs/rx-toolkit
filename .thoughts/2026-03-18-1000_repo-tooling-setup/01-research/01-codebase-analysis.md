---
title: "Repository Tooling Setup — Codebase Analysis"
date: 2026-03-18
stage: 01-research
role: rdpi-codebase-researcher
workflow: b0.2
---

## Summary

The `rx-toolkit` repository is a TypeScript library built on RxJS with React bindings, using vitest for testing (with explicit imports of globals), no linting or formatting tooling configured, and an `apps/demos/` sandbox app using Vite + React + MDX + TailwindCSS v4 + HeroUI. No `tsconfig.test.json`, `.eslintrc`, `.prettierrc`, or `.editorconfig` files exist.

## Findings

### 1. Test Typing Setup

#### Root `tsconfig.json`
- **Location**: `@/tsconfig.json` (root)
- `compilerOptions.target`: `"ESNext"`
- `compilerOptions.module`: `"ESNext"`
- `compilerOptions.moduleResolution`: `"bundler"`
- `compilerOptions.strict`: `true`
- `compilerOptions.jsx`: `"react-jsx"`
- `compilerOptions.baseUrl`: `"./"`
- `compilerOptions.paths`: `{ "@/*": ["src/*"] }`
- `include`: `["src/**/*"]`
- `exclude`: `["node_modules", "dist", "**/*.test.ts", "src/__tests__/**"]`
- **Key fact**: All test files (`**/*.test.ts`) and the `src/__tests__/` directory are **excluded** from the main TS compilation. There is no separate `tsconfig.test.json` or any test-specific TypeScript configuration file in the repository.

#### `vitest.config.ts`
- **Location**: `@/vitest.config.ts` (root)
- `test.globals`: `true` — vitest globals are enabled, meaning `describe`, `it`, `expect`, `vi`, etc. are available without imports at runtime.
- `test.environment`: `"jsdom"`
- `test.setupFiles`: `["src/__tests__/setup.ts"]`
- `test.include`: `["src/**/*.test.ts"]`
- `test.pool`: `"forks"`
- `resolve.alias`: `{ '@': './src' }` (via `fileURLToPath`)
- Coverage provider: `"v8"`, thresholds at 80%.

#### `src/__tests__/setup.ts`
- **Location**: `@/src/__tests__/setup.ts`
- Imports `afterEach` and `beforeEach` **explicitly from `'vitest'`** (not relying on globals).
- Calls `resetSharedOptions()` in `beforeEach` (imported from `@/__tests__/helpers/singleton-reset.ts`).
- Helper files exist at: `@/src/__tests__/helpers/async-helpers.ts`, `@/src/__tests__/helpers/signal-helpers.ts`, `@/src/__tests__/helpers/singleton-reset.ts`.

#### Test-specific TypeScript config
- **No `tsconfig.test.json`** exists anywhere in the repository. No tsconfig variant includes test files.
- **No `@vitest/globals`** type package in `devDependencies`. The vitest types come from the `vitest` package itself (`^4.0.18`).

#### Vitest globals usage in test files
Despite `globals: true` being set in vitest config, **all test files explicitly import vitest globals**. Observed patterns:

| File | Imports from `'vitest'` |
|---|---|
| `@/src/query/SKIP_TOKEN.test.ts` | `describe, it, expect` |
| `@/src/signals/signals/State.test.ts` | `describe, it, expect, vi` |
| `@/src/signals/base/Batcher.test.ts` | `describe, it, expect, vi` |
| `@/src/signals/react/useSignal.test.ts` | `describe, it, expect, vi` |
| `@/src/__tests__/integration/root-exports.test.ts` | `describe, it, expect` |
| `@/src/query/react/useResourceAgent.test.ts` | `describe, it, expect, vi, beforeEach, afterEach` |
| `@/src/query-v2/core/__tests__/ResourceV2.test.ts` | `describe, it, expect, vi, beforeEach, afterEach` |
| `@/src/query-v2/core/CacheMap.test.ts` | `describe, it, expect, vi` |

- Many test files that use timers/mocking also import `beforeEach` and `afterEach` from `'vitest'`.
- **No test file uses `@testing-library/jest-dom` matchers** (no `toBeInTheDocument`, `toHaveTextContent`, etc. found in any test).
- React hook tests use `renderHook` and `act` from `@testing-library/react`.
- `@testing-library/jest-dom` is in `devDependencies` (`^6.9.1`) but **not imported or used in any test file**.

#### Type implications
- Since test files are excluded from `tsconfig.json` and there's no `tsconfig.test.json`, the TypeScript compiler (`tsc --noEmit`) does not type-check test files.
- Vitest's own TypeScript integration (via its `globals: true` + the `vitest` package types) provides types within the vitest runtime, but there's no explicit `types: ["vitest/globals"]` in any tsconfig.
- IDE type resolution for test files relies on vitest's TypeScript plugin or the explicit imports.

---

### 2. Linting Status

#### No ESLint configuration exists
- No `.eslintrc.*` files found.
- No `eslint.config.*` files found.
- No `.eslintignore` file found.
- No eslint-related dependencies in `package.json` (neither root nor `apps/demos`).
- No eslint-related scripts in `package.json`.

#### Tech stack to be covered by linting

| Technology | Version / Source |
|---|---|
| TypeScript | `5.9.2` (root `devDependencies`) |
| React | `^19.0.0` (root `peerDependencies`) |
| RxJS | `^7.0.0` (root `peerDependencies`) |
| Zod | `4.1.11` / `^4.0.0` (root `devDependencies` + `peerDependencies`) |
| immer | `^10.1.3` (root `dependencies`) |
| observable-hooks | `^4.2.4` (root `dependencies`) |
| Path alias | `@/*` → `src/*` |

#### Root `package.json` — `devDependencies`
- `@testing-library/jest-dom`: `^6.9.1`
- `@testing-library/react`: `^16.3.2`
- `@types/node`: `^25.3.5`
- `@types/react`: `^19.2.14`
- `@vitest/coverage-v8`: `^4.0.18`
- `@vitest/ui`: `^4.0.18`
- `concurrently`: `9.2.0`
- `jsdom`: `^28.1.0`
- `rimraf`: `6.1.2`
- `tsc-alias`: `^1.8.16`
- `tsconfig-paths`: `4.2.0`
- `typescript`: `5.9.2`
- `vitest`: `^4.0.18`
- `zod`: `4.1.11`

#### Root `package.json` — `peerDependencies`
- `react`: `^19.0.0`
- `rxjs`: `^7.0.0`
- `zod`: `^4.0.0`

#### Root `package.json` — `dependencies`
- `immer`: `^10.1.3`
- `observable-hooks`: `^4.2.4`

#### `apps/demos/package.json` — dependencies
- **dependencies**: `@fontsource/jetbrains-mono`, `@fozy-labs/rx-toolkit` (link: `file:../..`), `@heroui/react` (`2.8.5`), `@mdx-js/react` (`3.1.1`), `@mdx-js/rollup` (`3.1.1`), `@tailwindcss/typography`, `framer-motion`, `prism-react-renderer`, `react` (`19.2.0`), `react-dom` (`19.2.0`), `react-live`, `react-router-dom` (`7.9.6`), `rxjs` (`7.8.2`)
- **devDependencies**: `@tailwindcss/vite` (`4.1.17`), `@types/react`, `@types/react-dom`, `@vitejs/plugin-react` (`4.7.0`), `tailwindcss` (`4.1.17`), `typescript` (`5.9.3`), `vite` (`5.4.21`), `vite-tsconfig-paths` (`5.1.4`)
- No eslint dependencies.

---

### 3. Formatting Status

#### No formatting configuration exists
- No `.prettierrc` or `prettier.config.*` files found.
- No `.editorconfig` file found.
- No prettier-related dependencies in any `package.json`.

#### Current formatting conventions (sampled across modules)

**Indentation**: 4 spaces consistently across all sampled files.

| File | Indent |
|---|---|
| `@/src/common/utils/deepEqual.ts` | 4 spaces |
| `@/src/common/utils/shallowEqual.ts` | 4 spaces |
| `@/src/common/react/useConstant.ts` | 4 spaces |
| `@/src/signals/signals/State.ts` | 4 spaces |
| `@/src/query/api/createResource.ts` | 4 spaces |
| `@/apps/demos/src/app/App.tsx` | 4 spaces |
| `@/apps/demos/src/components/LiveExample.tsx` | 4 spaces |

**Quote style**: Mixed.
- `@/src/common/utils/deepEqual.ts` — double quotes in type comparisons (`"object"`)
- `@/src/common/react/useConstant.ts` — no quotes for imports (single)… actually no imports use quotes consistently
- `@/src/signals/signals/State.ts` — double quotes for string imports: `"rxjs"`, `"@/signals/types"`
- `@/src/query/api/createResource.ts` — double quotes: `"@/query/types"`, `"@/query/core/Resource/Resource"`
- `@/apps/demos/src/app/App.tsx` — single quotes for most imports: `'react-router-dom'`, `'@heroui/react'`; double quotes for rx-toolkit: `"@fozy-labs/rx-toolkit"`
- `@/apps/demos/src/components/LiveExample.tsx` — single quotes for external imports: `'react-live'`, `'prism-react-renderer'`; single quotes for `'@fozy-labs/rx-toolkit'` too
- **Pattern**: The main `src/` codebase predominantly uses **double quotes** for import paths. The `apps/demos/` code uses a **mix of single and double quotes** (mostly single).

**Semicolons**: Present everywhere in `.ts`/`.tsx` files. All statements end with semicolons.

**Trailing commas**: Present in multi-line constructs. Observed in:
- Object literals: `@/src/signals/signals/State.ts:13` (constructor parameter list with trailing comma)
- Function arguments: `@/src/query/api/createResource.ts:5` — trailing comma after options parameter
- Import lists: `@/apps/demos/src/components/LiveExample.tsx` — trailing commas in import destructuring
- Array elements: present in test files and demo data

**Line length**: No consistent enforcement observed. Lines vary; some reach ~120+ characters (e.g., JSX with Tailwind classes in demos).

#### Import ordering patterns

**`@/src/signals/signals/State.ts`**:
```
import { BehaviorSubject } from "rxjs";
import { SignalFn, SignalOptionsOrKey, ... } from "@/signals/types";
import { Batcher, DependencyTracker, Devtools } from "../base";
```
Pattern: external (`rxjs`) → `@/` alias → relative (`../`)

**`@/src/signals/react/useSignal.test.ts`**:
```
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSignal } from './useSignal';
import { Signal } from '@/signals/signals/Signal';
import { flushMicrotasks } from '../../__tests__/helpers/async-helpers';
```
Pattern: external (`vitest`, `@testing-library`) → local (`./`) → `@/` alias → relative (`../../`). **Not consistent with src/ convention.**

**`@/src/query/react/useResourceAgent.test.ts`**:
```
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResourceAgent } from './useResourceAgent';
import { createResource } from '@/query/api/createResource';
import { SKIP } from '@/query/SKIP_TOKEN';
import { flushMicrotasks } from '@/__tests__/helpers/async-helpers';
```
Pattern: external → local → `@/` alias → `@/` alias → `@/` test helpers.

**`@/apps/demos/src/app/App.tsx`**:
```
import React from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Navbar, ... } from '@heroui/react';
import { reduxDevtools, DefaultOptions } from "@fozy-labs/rx-toolkit";
```
Pattern: `react` → external packages → library import. No blank lines between import groups.

**`@/apps/demos/src/components/LiveExample.tsx`**:
```
import React from 'react';
import { LiveEditor, ... } from 'react-live';
import { themes } from 'prism-react-renderer';
import { queryV2, ... } from '@fozy-labs/rx-toolkit';
import { Button, ... } from '@heroui/react';
import { fetches } from '../utils/fetches';
```
Pattern: `react` → external → library → UI components → relative. No blank lines between groups.

**General observation**: Imports are **not consistently grouped or separated** by blank lines. The loose pattern is external packages first, then `@/` or library imports, then relative imports — but it varies per file and module.

---

### 4. `apps/demos/` Structure

#### Configuration files

**`apps/demos/package.json`** (`@/apps/demos/package.json`):
- Name: `rx-toolkit-demos`
- Type: `module`
- Only script: `"dev": "vite"`
- Links to root library via `"@fozy-labs/rx-toolkit": "file:../.."`
- UI: HeroUI (`@heroui/react` 2.8.5), TailwindCSS v4, framer-motion
- MDX: `@mdx-js/react` + `@mdx-js/rollup`
- Live code editing: `react-live`, `prism-react-renderer`
- Routing: `react-router-dom` 7.9.6

**`apps/demos/tsconfig.json`** (`@/apps/demos/tsconfig.json`):
- `target`: `"ES2020"`
- `moduleResolution`: `"bundler"`
- `jsx`: `"react-jsx"`
- `strict`: `true`
- `noEmit`: `true`
- `types`: `["vite/client"]`
- `include`: `["src"]`
- No path aliases, no explicit baseUrl.

**`apps/demos/vite.config.ts`** (`@/apps/demos/vite.config.ts`):
- Plugins: MDX (with `enforce: 'pre'`), `@vitejs/plugin-react`, `@tailwindcss/vite`
- Server port: `3000`
- `assetsInclude: ['**/*.tsx?raw']` — for importing example files as raw strings.
- Note: **no `vite-tsconfig-paths` plugin used in vite config** despite it being in devDependencies.

#### Directory contents

**`apps/demos/src/app/`**:
- `App.tsx` — main app component with routing
- `hero.ts` — HeroUI Tailwind plugin config (`heroui()`)
- `main.tsx` — React entry point with `BrowserRouter` + `HeroUIProvider`
- `styles.css` — Tailwind v4 imports, font, hero plugin, custom Prism styles

**`apps/demos/src/pages/`**:
- `HomePage.mdx`
- `SignalsPage.mdx`
- `QueriesPage.mdx`
- `QueriesV2Page.mdx`

**`apps/demos/src/components/`**:
- `index.ts` — re-exports `LiveExample` and `QueryTabs`
- `LiveExample.tsx` — live code playground using `react-live`
- `QueryTabs.tsx` — tabbed container with URL sync via `?tab=` query param

**`apps/demos/src/examples/`**:
- `index.ts` — re-exports namespaces: `Signals`, `Query`, `QueryV2`
- `signals/` — `index.ts`, `base-signals.tsx`, `counter-store.tsx`, `local-state.tsx`
- `query/` — `index.ts`, `simple-list.tsx`, `shopping-cart.tsx`, `user-profile.tsx`, `todo-patches.tsx`, `duplicator.tsx`
- `query-v2/` — `index.ts`, `simple-resource.tsx`, `optimistic-patches.tsx`, `ssr-snapshot.tsx`

**`apps/demos/src/utils/`**:
- `fetches.ts` — mock fetch functions returning hardcoded data with simulated delays

#### Routing
- **Location**: `@/apps/demos/src/app/App.tsx`
- Uses `react-router-dom` `<Routes>` and `<Route>`.
- Routes:
  - `/` → `<HomePage />` (from `HomePage.mdx`)
  - `/signals` → `<SignalsPage />`
  - `/queries` → `<QueriesPage />`
  - `/queries-v2` → `<QueriesV2Page />`
- Navigation via `<Navbar>` with `<Link>` components and `useLocation()` for active state.
- `BrowserRouter` wrapped in `main.tsx`.

#### How pages reference examples
- Pages are `.mdx` files that import components (`LiveExample`, `QueryTabs`, `Tab`) and example namespaces.
- Example pattern in `@/apps/demos/src/pages/SignalsPage.mdx`:
  ```mdx
  import { LiveExample, QueryTabs } from "../components";
  import { Signals } from "../examples";
  
  <LiveExample title="..." initialCode={Signals.examples.counterStore} />
  ```
- Examples are loaded as **raw strings** using Vite's `?raw` import suffix.
- Each example subdirectory has an `index.ts` that imports raw files and exports them as an `examples` object.
- Example pattern in `@/apps/demos/src/examples/signals/index.ts`:
  ```ts
  import counterStoreRaw from "./counter-store.tsx?raw";
  export const examples = { counterStore: counterStoreRaw };
  ```

#### How external entities are imported into the sandbox
- `LiveExample.tsx` creates a `react-live` `<LiveProvider>` with a `scope` object.
- The scope includes pre-imported entities from `@fozy-labs/rx-toolkit` (e.g., `Signal`, `useSignal`, `createResource`, `queryV2`, `SKIP`, etc.) and from `@heroui/react` (UI components).
- Example `.tsx` files use `import` statements (e.g., `import { Signal } from "@fozy-labs/rx-toolkit"`) but `LiveExample.processExample()` **strips all import lines** via regex: `code.replace(/^import .+ from .+;$/gm, '')`.
- The stripped code then relies on the scope object for all identifiers.
- To add a new external entity to the sandbox: import it in `LiveExample.tsx` and add it to the `defaultScope` object.

#### How to add a new page
1. Create a new `.mdx` file in `@/apps/demos/src/pages/`.
2. Import components (`LiveExample`, `QueryTabs`) and example namespaces.
3. Add a `<Route>` in `@/apps/demos/src/app/App.tsx`.
4. Add a `<NavbarItem>` / `<Link>` in the navbar section of `App.tsx`.

#### How to add a new example
1. Create a `.tsx` file in the appropriate `@/apps/demos/src/examples/<category>/` directory.
2. The file must use `export function Base()` as the main component (processed by `LiveExample`'s `processExample` which appends `render(Base)` if it finds `function Base`).
3. Import the raw file in the category's `index.ts` using `?raw` suffix.
4. Add the export to the `examples` object in that `index.ts`.
5. Reference the example in a page `.mdx` file via `<LiveExample initialCode={Namespace.examples.key} />`.

#### Type declarations
- `@/apps/demos/src/vite-env.d.ts` — declares `vite/client` reference and `*.mdx` module types.

---

### 5. Existing `.github/instructions/` Content

#### `thoughts-workflow.instructions.md`
- **Location**: `@/.github/instructions/thoughts-workflow.instructions.md`
- **YAML frontmatter fields**: `name`, `description`, `applyTo`
  - `name`: `"thoughts-workflow"`
  - `description`: explains the scope (`.thoughts/` workflow files)
  - `applyTo`: `".thoughts/**"`
- **Content structure**:
  - `# .thoughts/ Workflow Guidelines` (H1 heading)
  - `## Directory Structure` — describes folder layout
  - `## Document Conventions` — language, front matter, status, cross-references, file paths
  - `## Mermaid Diagrams` — rules for diagrams
  - `## Stages` — lists the 4 stages
- **This is the only instruction file** in `.github/instructions/`.

#### Other `.github/` contents
- `@/.github/copilot-instructions.md` — minimal file, just says "Read and follow CONTRIBUTING.md".
- `@/.github/agents/` — 16 agent files (RDPI workflow agents: orchestrator, researcher, architect, planner, coder, reviewers, etc.).
- `@/.github/skills/` — contains `orchestrate/` subdirectory.
- `@/.github/rdpi-stages/` — contains stage phase prompt files: `01-research.md`, `02-design.md`, `03-plan.md`, `04-implement.md`.

---

## Code References

- `@/tsconfig.json:1-24` — root TypeScript config; excludes `**/*.test.ts` and `src/__tests__/**`
- `@/vitest.config.ts:1-33` — vitest config; `globals: true`, `environment: 'jsdom'`, setup file
- `@/src/__tests__/setup.ts:1-11` — test setup; explicit vitest imports, `resetSharedOptions()` in `beforeEach`
- `@/src/__tests__/helpers/singleton-reset.ts:1-8` — `SharedOptions.reset()` helper
- `@/package.json:1-73` — root package.json; all dependencies, scripts, metadata
- `@/src/query/SKIP_TOKEN.test.ts:1-25` — test sample; imports `describe, it, expect` from `'vitest'`
- `@/src/signals/signals/State.test.ts:1-80` — test sample; imports `describe, it, expect, vi` from `'vitest'`
- `@/src/signals/base/Batcher.test.ts:1-80` — test sample; imports `describe, it, expect, vi` from `'vitest'`
- `@/src/query/react/useResourceAgent.test.ts:1-80` — test sample; imports `beforeEach, afterEach`, uses `@testing-library/react`
- `@/src/query-v2/core/__tests__/ResourceV2.test.ts:1-80` — test sample; imports `beforeEach, afterEach, vi`
- `@/src/query-v2/core/CacheMap.test.ts:1-80` — test sample; imports from `'vitest'` + `@/` aliases
- `@/src/signals/react/useSignal.test.ts:1-30` — test sample; imports `renderHook, act` from `@testing-library/react`
- `@/src/common/utils/deepEqual.ts:1-31` — formatting sample; 4-space indent, double quotes, semicolons
- `@/src/common/utils/shallowEqual.ts:1-30` — formatting sample; same conventions
- `@/src/common/react/useConstant.ts:1-24` — formatting sample; 4-space indent, no semicolons on some lines
- `@/src/signals/signals/State.ts:1-80` — formatting sample; double-quote imports, trailing commas
- `@/src/query/api/createResource.ts:1-9` — formatting sample; double-quote imports
- `@/apps/demos/package.json:1-35` — demos dependencies and config
- `@/apps/demos/tsconfig.json:1-22` — demos TypeScript config
- `@/apps/demos/vite.config.ts:1-17` — demos Vite config; MDX, React, TailwindCSS plugins
- `@/apps/demos/src/app/App.tsx:1-63` — main app; routing, navbar, imports from `@fozy-labs/rx-toolkit`
- `@/apps/demos/src/app/main.tsx:1-14` — entry point; `BrowserRouter`, `HeroUIProvider`
- `@/apps/demos/src/app/hero.ts:1-3` — HeroUI tailwind plugin config
- `@/apps/demos/src/app/styles.css:1-50` — Tailwind v4 + custom Prism styles
- `@/apps/demos/src/pages/HomePage.mdx:1-15` — home page; imports `LiveExample` + `Signals`
- `@/apps/demos/src/pages/SignalsPage.mdx:1-21` — signals page; uses `QueryTabs` + `Tab` + `LiveExample`
- `@/apps/demos/src/pages/QueriesPage.mdx:1-41` — queries page; 5 tabs with examples
- `@/apps/demos/src/pages/QueriesV2Page.mdx:1-30` — query-v2 page; 3 tabs with examples
- `@/apps/demos/src/components/index.ts:1-2` — re-exports `LiveExample`, `QueryTabs`
- `@/apps/demos/src/components/LiveExample.tsx:1-150` — live playground; `processExample()` strips imports, scope object for `react-live`
- `@/apps/demos/src/components/QueryTabs.tsx:1-33` — tabbed container with URL sync
- `@/apps/demos/src/examples/index.ts:1-3` — re-exports `Signals`, `Query`, `QueryV2` namespaces
- `@/apps/demos/src/examples/signals/index.ts:1-10` — raw imports for signal examples
- `@/apps/demos/src/examples/query/index.ts:1-14` — raw imports for query examples
- `@/apps/demos/src/examples/query-v2/index.ts:1-9` — raw imports for query-v2 examples
- `@/apps/demos/src/examples/signals/counter-store.tsx:1-55` — example; imports from `@fozy-labs/rx-toolkit` + `@heroui/react`
- `@/apps/demos/src/examples/query/simple-list.tsx:1-80` — example; imports from `@fozy-labs/rx-toolkit` + `@heroui/react` + relative utils
- `@/apps/demos/src/examples/query-v2/simple-resource.tsx:1-80` — example; uses `queryV2.createApi()` pattern
- `@/apps/demos/src/utils/fetches.ts:1-50` — mock API functions with hardcoded data + delays
- `@/apps/demos/src/vite-env.d.ts:1-11` — Vite client types + `*.mdx` module declaration
- `@/.github/instructions/thoughts-workflow.instructions.md:1-56` — only instruction file; YAML frontmatter with `name`, `description`, `applyTo`
- `@/.github/copilot-instructions.md:1-3` — minimal; points to CONTRIBUTING.md
