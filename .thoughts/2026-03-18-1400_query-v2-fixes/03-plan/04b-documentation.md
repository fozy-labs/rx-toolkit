---
title: "Phase 4B: Documentation Updates"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Update two existing documentation files with information about standalone hooks (Fix #1+#2), snapshot hydration errors (Fix #5), and optimistic update snapshot behavior (Fix #7). No new documentation files or demo changes. [ref: ../02-design/07-docs.md]

## Dependencies

- **Requires**: Phase 3A (DevTools Isolation) + Phase 3B (Snapshot Errors) — docs describe behavior implemented in previous phases
- **Blocks**: None

## Execution

Parallel with Phase 4A (JSDoc).

## Tasks

### Task 4B.1: Update `docs/query-v2/ssr.md` — optimistic update + error handling

- **File**: `docs/query-v2/ssr.md`
- **Action**: Modify
- **Description**: Two additions to this file:

  **Fix #7 — Optimistic update snapshot behavior** (append to existing "Ограничения" section):
  Add 3–5 bullet points explaining:
  - During active optimistic patches, `data` in the snapshot is the patched (optimistic) value, not `originalData`
  - `originalData` and `patches` are excluded from `TResourceV2SnapshotSlice`
  - Hydrating a mid-patch snapshot installs optimistic data as canonical server data
  - Recommendation: commit/abort patches before calling `getSnapshot()`

  **Fix #5 — Hydration error behavior** (add to "Ограничения" section or new "Ошибки гидрации" sub-section):
  Add 3–4 bullet points noting:
  - `hydrateSnapshot` now throws on version mismatch (previously silent skip)
  - `hydrateSnapshot` now throws on keyPrefix mismatch (previously silent skip)
  - Unknown resource keys produce `console.warn` and are skipped (non-fatal)
  - Advise try/catch for rolling-deployment scenarios where snapshot version parity is not guaranteed

- **Design reference**: [ref: ../02-design/07-docs.md §fix-7 + §fix-5], [ref: ../02-design/05-usecases.md UC-6.1, UC-6.2, UC-4.6]
- **Complexity**: Low

### Task 4B.2: Update `docs/query-v2/api-reference.md` — standalone hooks

- **File**: `docs/query-v2/api-reference.md`
- **Action**: Modify
- **Description**: In the "ReactHooksPlugin" section, add a note (~5 lines) that `useResourceV2Agent` and `useResourceV2Ref` are now also available as standalone imports from `@fozy-labs/rx-toolkit/query-v2/react`, without requiring `ReactHooksPlugin`. Include the import path and a one-line usage example.
- **Design reference**: [ref: ../02-design/07-docs.md §fix-1-2]
- **Complexity**: Low

## Verification

- [ ] `docs/query-v2/ssr.md` contains optimistic update snapshot behavior in "Ограничения" section
- [ ] `docs/query-v2/ssr.md` contains hydration error behavior documentation
- [ ] `docs/query-v2/api-reference.md` mentions standalone hook imports
- [ ] No new documentation files created (design constraint)
- [ ] No demo changes (design constraint)
- [ ] Documentation additions are proportional: ~20 lines total across 2 files [ref: ../02-design/README.md §documentation-proportionality]
