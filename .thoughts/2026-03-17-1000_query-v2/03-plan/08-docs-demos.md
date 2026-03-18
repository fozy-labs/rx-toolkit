---
title: "Phase 8: Documentation + Demos"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Create documentation pages, migration guide, and demo applications as specified in the design's documentation impact document (07-docs.md). Update existing pages with query-v2 references. This phase produces no code changes — only documentation and demo content.

## Dependencies

- **Requires**: Phase 7 (all code stable, exports finalized, tests passing)
- **Blocks**: None (final phase)

## Execution

Sequential (depends on Phase 7).

## Tasks

### Task 8.1: Create query-v2 documentation pages

- **Files** (all Create):
  - `docs/query-v2/README.md`
  - `docs/query-v2/api-reference.md`
  - `docs/query-v2/optimistic-updates.md`
  - `docs/query-v2/ssr.md`
- **Action**: Create
- **Description**: Create the core documentation for query-v2. Each page follows the style and depth of existing `docs/query/README.md`.
- **Details**:
  - `README.md`: Main concepts page covering `createApi`, `ResourceV2`, Agents, Machine states, cache strategies, `SKIP_TOKEN`, lifecycle hooks, plugins. Structure parallel to existing `docs/query/README.md`. [ref: ../02-design/07-docs.md]
  - `api-reference.md`: Tables of options and return types for `createApi`, `api.createResource`, `IResourceV2`, `IResourceV2Agent`, machine classes. Format similar to RFC tables.
  - `optimistic-updates.md`: Patcher usage guide — `createPatch`, `finishPatch`, commit/abort patterns. Replaces v1 patch + Command link pattern.
  - `ssr.md`: SSR guide — `getSnapshot()`, `initialSnapshot`, `maxSnapshotDataAge`, server dehydration + client hydration. New topic with no v1 equivalent.
  - All pages in Russian (following project convention for docs/).
  - Mark query-v2 as **experimental** in the README header.
- **Complexity**: Medium

### Task 8.2: Create migration guide

- **File**: `docs/migrations/query-v2.md`
- **Action**: Create
- **Description**: Migration guide from query v1 to query v2.
- **Details**:
  - Concept mapping: `createResource` → `createApi` + `api.createResource`, Resource → ResourceV2, Command → out of scope, Agent pattern changes, boolean flags → machine states, `useResourceAgent` → `useResourceV2Agent`.
  - Follow format established by `docs/migrations/0.5.0.md`. [ref: ../02-design/07-docs.md]
  - Note v1/v2 coexistence: both modules can be used simultaneously without conflict. No imports cross between `src/query/` and `src/query-v2/`.
- **Complexity**: Low

### Task 8.3: Update existing documentation

- **Files** (all Modify):
  - `docs/query/README.md` — Modify
  - `README.md` (root) — Modify
- **Action**: Modify
- **Description**: Add query-v2 references to existing pages.
- **Details**:
  - `docs/query/README.md`: Add a brief note at the top linking to query-v2 as the experimental successor. Example: "**Note:** Экспериментальная версия Query v2 доступна — см. [Query v2](../query-v2/README.md)." No structural changes to v1 docs. [ref: ../02-design/07-docs.md]
  - `README.md` (root): Add query-v2 to the feature list. Mark as experimental.
- **Complexity**: Low

### Task 8.4: Create demo applications

- **Files** (all Create):
  - `apps/demos/src/examples/query-v2/index.ts`
  - `apps/demos/src/examples/query-v2/simple-resource.tsx`
  - `apps/demos/src/examples/query-v2/optimistic-patches.tsx`
  - `apps/demos/src/examples/query-v2/ssr-snapshot.tsx` (optional — may not be feasible in Vite demo without SSR setup)
- **Action**: Create
- **Description**: Demo examples mirroring existing v1 demos in style and scope.
- **Details**:
  - `index.ts`: Barrel export for query-v2 demos.
  - `simple-resource.tsx`: Basic resource query — parallel to existing `apps/demos/src/examples/query/simple-list.tsx`. Demonstrates `createApi`, `createResource`, `useResourceV2Agent`, loading/success/error states. [ref: ../02-design/07-docs.md]
  - `optimistic-patches.tsx`: Optimistic update demo — parallel to existing `apps/demos/src/examples/query/todo-patches.tsx`. Demonstrates `createPatch`, `finishPatch`, rollback on error. [ref: ../02-design/07-docs.md]
  - `ssr-snapshot.tsx`: SSR snapshot demo if feasible. May be a simulated demo (client-side only, using a pre-built snapshot object) rather than actual SSR, since the Vite demo app doesn't have SSR infrastructure. [ref: ../02-design/07-docs.md]
  - Update `apps/demos/src/examples/index.ts` to include query-v2 demos.
  - Follow existing demo patterns for styling, layout, code structure.
- **Complexity**: Low

## Verification

- [ ] `npm run ts-check` passes (demo app compilation)
- [ ] All doc pages exist and are non-empty
- [ ] `docs/query-v2/README.md` marks query-v2 as experimental
- [ ] `docs/query/README.md` contains v2 link note
- [ ] Root `README.md` lists query-v2 feature
- [ ] `docs/migrations/query-v2.md` covers key concept mappings
- [ ] Demo files compile and render correctly in the demo app
- [ ] Demo barrel export includes v2 examples
- [ ] Existing v1 demos in `apps/demos/src/examples/query/` are unchanged
- [ ] No imports from `src/query/` in any query-v2 demo
