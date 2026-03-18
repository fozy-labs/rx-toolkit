---
title: "Phase 6: AI Instructions for apps/demos/"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Create the AI instruction file for `apps/demos/` that guides AI agents (GitHub Copilot) when working with demo files. This phase is fully independent of the other tooling phases.

## Dependencies

- **Requires**: None (independent of all other phases)
- **Blocks**: None

## Execution

Parallel with all other phases — can be executed at any time.

## Tasks

### Task 6.1: Create `.github/instructions/demos.instructions.md`

- **File**: `.github/instructions/demos.instructions.md`
- **Action**: Create
- **Description**: Create an AI instruction file for agents working with `apps/demos/` files. The file uses the existing instruction file pattern from `.github/instructions/thoughts-workflow.instructions.md` as a structural reference. Content covers project structure, how to add pages/examples/scope entities, key components, and mock utilities.
- **Details**:
  - **YAML Frontmatter**:
    - `name: "demos"`
    - `description:` brief description for semantic matching (e.g., "Instructions for working with the rx-toolkit interactive demos app")
    - `applyTo: "apps/demos/**"`
  - **Topic 1: Project Structure Overview**
    - Tech stack: React 19 + Vite + MDX + TailwindCSS v4 + HeroUI + react-live
    - Key directories: `pages/`, `examples/`, `components/`, `utils/`
    - Entry point: `main.tsx` → `App.tsx` (routing + navbar)
    - Linked library: `@fozy-labs/rx-toolkit` via `file:../..`
    - Type declarations: `vite-env.d.ts` for `*.mdx` module types and Vite client types
  - **Topic 2: How to Add a New Page**
    - Create `.mdx` file in `src/pages/`
    - Import components from `../components` (`LiveExample`, `QueryTabs`)
    - Import example namespaces from `../examples`
    - Add `<Route>` in `App.tsx` with path and element
    - Add navigation link in `<Navbar>` section of `App.tsx`
    - Page component is the default export of the MDX file
  - **Topic 3: How to Add a New Example**
    - Create `.tsx` file in `src/examples/<category>/`
    - Export `function Base()` as main component (required by `LiveExample.processExample()`)
    - Import raw file in category's `index.ts` using `?raw` suffix
    - Add export to the examples object in that `index.ts`
    - Reference in MDX via `<LiveExample initialCode={Namespace.examples.key} />`
    - Note: `processExample()` strips import lines via regex — imports are for readability only
  - **Topic 4: How to Add External Entities to Sandbox Scope**
    - `react-live` `<LiveProvider>` uses scope object in `LiveExample.tsx`
    - Import entity in `LiveExample.tsx` and add to `defaultScope` object
    - Same for rx-toolkit exports and external packages (e.g., HeroUI components)
  - **Topic 5: Key Components**
    - `LiveExample`: wraps `react-live` with import stripping, scope injection, Prism highlighting
    - `QueryTabs`: tabbed container synced with URL `?tab=` query param
    - Both re-exported from `components/index.ts`
  - **Topic 6: Mock Utilities**
    - `utils/fetches.ts` provides mock API functions with simulated delays
    - Examples import these for data fetching demos
    - Pattern: hardcoded data wrapped in Promise with setTimeout
  - [ref: ../02-design/05-usecases.md#uc-13-content-specification-for-appsdemos-ai-instruction-file]

## Verification

- [ ] File exists at `.github/instructions/demos.instructions.md`
- [ ] YAML frontmatter has `applyTo: "apps/demos/**"` (T24)
- [ ] Content covers all 6 topics: project structure, adding pages, adding examples, adding scope entities, key components, mock utilities (T25)
- [ ] Follows existing instruction file pattern (matches format of `.github/instructions/thoughts-workflow.instructions.md`)
- [ ] `npm run ts-check` still passes (compilability invariant — no code changed)
