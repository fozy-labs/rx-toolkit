---
title: "Phase 9: Documentation & Demos"
date: 2026-03-25
stage: 03-plan
role: rdpi-planner
---

## Goal

Create v0.2 documentation, add deprecation banners to v0.1 docs, update the migration guide, and update demo app examples to use the new query-v2 API.

## Dependencies

- **Requires**: Phase 8 (all code complete and tested)
- **Blocks**: None (final phase)

## Execution

Parallel: v0.2 doc creation, v0.1 banner additions, and demo updates are independent.

## Tasks

### Task 9.1: Create v0.2 documentation — README

- **File**: `docs/query-v2/v0.2/README.md`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Main documentation page for query-v2 v0.2.
- **Details**:
  - Overview of query-v2 architecture (5-layer hierarchy)
  - Getting started guide: `createApi`, defining resources, using `useResourceV2Agent`
  - Core concepts: Machine states, SWR, GC, SKIP token
  - API reference summary (detailed API docs can reference types)
  - Link to migration guide from v0.1
  - Follow structure of existing `docs/query-v2/v0.1/README.md` but for v0.2 API
  - [ref: ../02-design/07-docs.md]

### Task 9.2: Create v0.2 documentation — optimistic updates

- **File**: `docs/query-v2/v0.2/optimistic-updates.md`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Guide for optimistic update patterns using Patcher.
- **Details**:
  - `createPatch` usage on data-bearing states
  - Patch resolution on server response
  - Consistency violation handling
  - Rollback workflow: `handle.abort()` reverts optimistic data via inverse patches (`TPatch.inversePatches`), then re-query for fresh data
  - `onQueryStarted` callback pattern for automatic patching
  - Code examples for each pattern
  - [ref: ../02-design/07-docs.md, ../02-design/05-usecases.md#UC-3]

### Task 9.3: Create v0.2 documentation — SSR

- **File**: `docs/query-v2/v0.2/ssr.md`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Guide for server-side rendering snapshot workflow.
- **Details**:
  - `getSnapshot()` on server after queries resolve
  - Serialization to HTML / script tag
  - `hydrateSnapshot()` on client before render
  - Snapshot version compatibility
  - Code examples for Next.js / Vite SSR patterns
  - [ref: ../02-design/07-docs.md, ../02-design/05-usecases.md#UC-5]

### Task 9.4: Add deprecation banners to v0.1 docs

- **File**: `docs/query-v2/v0.1/README.md`
- **Action**: Modify
- **Complexity**: Low
- **Description**: Add deprecation banner pointing to v0.2 docs.
- **Details**: Add a prominent banner/admonition at the top: `> ⚠️ **Deprecated**: This documents query-v2 v0.1. See [v0.2 documentation](../v0.2/README.md) for the current version.`

---

- **File**: `docs/query-v2/v0.1/optimistic-updates.md`
- **Action**: Modify
- **Complexity**: Low
- **Description**: Add deprecation banner pointing to v0.2 equivalent.
- **Details**: Same banner pattern linking to `../v0.2/optimistic-updates.md`.

---

- **File**: `docs/query-v2/v0.1/ssr.md`
- **Action**: Modify
- **Complexity**: Low
- **Description**: Add deprecation banner pointing to v0.2 equivalent.
- **Details**: Same banner pattern linking to `../v0.2/ssr.md`.

---

- **File**: `docs/query-v2/v0.1/Внутриянка.md`
- **Action**: Modify
- **Complexity**: Low
- **Description**: Add deprecation banner indicating v0.1 internals doc is obsolete.
- **Details**: Same banner pattern noting this is v0.1 internals documentation.

### Task 9.5: Update docs index

- **File**: `docs/query-v2/README.md`
- **Action**: Modify
- **Complexity**: Low
- **Description**: Add v0.2 link to the query-v2 documentation index.
- **Details**:
  - Add v0.2 section/link alongside existing v0.1 link
  - Mark v0.1 as deprecated in the index

### Task 9.6: Update migration guide

- **File**: `docs/migrations/query-v2.md`
- **Action**: Modify
- **Complexity**: Medium
- **Description**: Add v0.1→v0.2 migration notes.
- **Details**:
  - Breaking changes: class-based machines (immutable), Patcher API changes, CacheMap strategy selection, plugin augmentation via generics (not `declare module`), Agent callback-based architecture
  - Migration steps: update imports, update machine usage patterns, update lifecycle hook signatures
  - API rename mappings (if any — per ADR-15, most names keep V2 suffix)
  - [ref: ../02-design/07-docs.md]

### Task 9.7: Update demo — simple resource

- **File**: `apps/demos/src/examples/query-v2/simple-resource.tsx`
- **Action**: Modify
- **Complexity**: Low
- **Description**: Update demo to use new query-v2 API.
- **Details**:
  - Update imports to new module paths
  - Update `createApi` usage to v0.2 signature
  - Update `useResourceV2Agent` usage to v0.2 hook API
  - Verify demo compiles and renders correctly
  - [ref: ../02-design/07-docs.md]

### Task 9.8: Update demo — optimistic patches

- **File**: `apps/demos/src/examples/query-v2/optimistic-patches.tsx`
- **Action**: Modify
- **Complexity**: Low
- **Description**: Update optimistic patches demo to use new Patcher API.
- **Details**:
  - Update `createPatch` usage to v0.2 API (on MachineWithData instances)
  - Update patch resolution and undo patterns
  - Update lifecycle hook patterns if changed
  - [ref: ../02-design/07-docs.md]

### Task 9.9: Update demo — SSR snapshot

- **File**: `apps/demos/src/examples/query-v2/ssr-snapshot.tsx`
- **Action**: Modify
- **Complexity**: Low
- **Description**: Update SSR snapshot demo to use new snapshot API.
- **Details**:
  - Update `getSnapshot` / `hydrateSnapshot` usage to v0.2 API
  - Update snapshot version handling
  - [ref: ../02-design/07-docs.md]

## Verification

- [ ] `npm run ts-check` passes (including demos app)
- [ ] v0.2 docs exist at `docs/query-v2/v0.2/` with 3 files
- [ ] All v0.1 docs have deprecation banners
- [ ] Migration guide has v0.1→v0.2 section
- [ ] `docs/query-v2/README.md` links to both v0.1 and v0.2
- [ ] Demo app compiles: `cd apps/demos && npm run build`
- [ ] Demos render correctly (manual check or Playwright if available)
