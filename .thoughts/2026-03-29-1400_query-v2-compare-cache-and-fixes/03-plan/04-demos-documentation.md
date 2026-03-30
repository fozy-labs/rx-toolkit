---
title: "Phase 4: Demo Fixes + Documentation"
date: 2026-03-30
stage: 03-plan
role: rdpi-planner
---

## Goal

Fix misleading `isError` UI descriptions in 5 query-v2 demo files (Area C, problem #6) and update documentation to reflect the new `devtoolsKey` option and `doCacheArgs` clarification. No queryFn logic changes in any demo. Documentation additions are proportional to the scope — one new option row, short notes, and a clarification.

## Dependencies

- **Requires**: Phase 1 (documentation references `devtoolsKey` API introduced in Phase 1)
- **Blocks**: None

## Execution

Parallel with Phase 2 and Phase 3 — demo files and docs do not affect compilation of `src/` or test execution.

## Tasks

### Task 4.1: Fix error-swr-states.tsx

- **File**: `apps/demos/src/examples/query-v2/error-swr-states.tsx`
- **Action**: Modify
- **Description**: Primary error demo — relabel as SWR error recovery demo [ref: ../02-design/01-architecture.md §6.2; ADR-7]:
  1. Update page title/heading to indicate SWR error recovery (e.g., "⚠️ SWR-восстановление после ошибки (Query v2)") instead of implying `isError: true` is reachable.
  2. Replace `isError: {String(state.isError)}` badge (~line 66-67) with `isRefreshError` indicator — use `state.error !== undefined && state.status === "success"` or similar derivation. Show `isRefreshError: {String(!!state.error && state.status === "success")}`.
  3. Remove or restyle the unreachable `state.isError && (...)` error banner (~line 75) — it never renders because `isError` is always `false` after first success.
  4. Add `state.error` display to show the actual SWR error data when available (demonstrates `lastError` under SWR semantics).
  5. Update comments/description text to explain SWR semantics: after initial success, errors during refresh preserve stale data with `lastError`, `isError` stays `false`.
  6. Update state log entry (~line 42) to show `isRefreshError` instead of `isError`.
- **Details**:
  - queryFn logic is NOT changed — `fetchCount` alternating success/error pattern stays.
  - DV01, DV02, DV03 from test strategy are manual visual verification items for this file.

### Task 4.2: Fix lifecycle-hooks.tsx

- **File**: `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx`
- **Action**: Modify
- **Description**: Remove or relabel misleading `isError` display [ref: ../02-design/01-architecture.md §6.2; ADR-7]:
  1. If there is an `isError` badge/display — replace with `isRefreshError` or remove entirely with a comment explaining `isError` is always `false` in this example due to SWR semantics.
  2. If there is a conditional error banner — remove the unreachable block or add a descriptive comment.
- **Details**:
  - DV04 from test strategy covers this file.
  - queryFn logic unchanged.

### Task 4.3: Fix basic-query.tsx

- **File**: `apps/demos/src/examples/query-v2/basic-query.tsx`
- **Action**: Modify
- **Description**: Remove misleading `isError` display [ref: ../02-design/01-architecture.md §6.2; ADR-7]:
  1. Remove `isError` badge/display or add comment explaining it is always `false` for this example (queryFn always succeeds).
- **Details**:
  - DV05 from test strategy covers this file.

### Task 4.4: Fix optimistic-patches.tsx

- **File**: `apps/demos/src/examples/query-v2/optimistic-patches.tsx`
- **Action**: Modify
- **Description**: Remove unreachable `isError` early return [ref: ../02-design/01-architecture.md §6.2; ADR-7]:
  1. Remove `if (state.isError)` early return block or add comment explaining it is dead code.
- **Details**:
  - DV06 from test strategy covers this file.

### Task 4.5: Fix ssr-snapshot.tsx

- **File**: `apps/demos/src/examples/query-v2/ssr-snapshot.tsx`
- **Action**: Modify
- **Description**: Remove unreachable `isError` conditional block [ref: ../02-design/01-architecture.md §6.2; ADR-7]:
  1. Remove `{state.isError && (...)}` block or add comment explaining it never renders.
- **Details**:
  - DV07 from test strategy covers this file.

### Task 4.6: Update docs/query-v2/README.md

- **File**: `docs/query-v2/README.md`
- **Action**: Modify
- **Description**: Three documentation updates [ref: ../02-design/07-docs.md]:
  1. Add `devtoolsKey` row to **Параметры `createResourceV2`** table: `devtoolsKey | (args: TArgs) => string | — | Функция для извлечения ключа devtools из аргументов (только для стратегии compare). По умолчанию — монотонный счётчик (0, 1, 2…)` [ref: ADR-3].
  2. Add 2–3 sentences under **Cache Strategies** section explaining that compare strategy uses a monotonic counter for devtools identification by default and that `devtoolsKey` overrides this.
  3. Update `doCacheArgs` description in the parameter table to clarify it applies only to serialize strategy (`keyStrategy: 'serialize'`). Compare strategy ignores it [ref: ADR-2].
- **Details**:
  - No change to: Machine States, Agents, SKIP, Plugins, GC, Error Handling sections.
  - Lifecycle Hooks section describes user-facing API (unchanged) — no update needed unless internal `LifecycleHooks` class is mentioned (currently it is not).

### Task 4.7: Update docs/query-v2/devtools.md

- **File**: `docs/query-v2/devtools.md`
- **Action**: Modify
- **Description**: Two documentation updates [ref: ../02-design/07-docs.md]:
  1. Add `devtoolsKey` row to the **Options Reference** table (if one exists) or add a short subsection on `devtoolsKey`.
  2. Add a short paragraph (3–4 sentences) explaining Signal key format for compare strategy entries: `"Resource/:key/:counter"` (default) vs `"Resource/:key/:customKey"` (with `devtoolsKey`). Contrast with serialize strategy: `"Resource/:key/:serializedArgs"` [ref: ../02-design/05-usecases.md UC2].
- **Details**:
  - Generic devtools docs at `docs/devtools/README.md` are NOT changed — query-v2-specific changes are scoped to `docs/query-v2/devtools.md`.
  - `docs/query-v2/ssr.md` — verify snapshot format documentation. SSR requires serialize strategy, so compare-strategy changes don't affect it. Likely no change needed but should verify [ref: ../02-design/07-docs.md "No Change Needed"].

## Verification

- [ ] Demo app builds without errors (`npm run build` in `apps/demos/`)
- [ ] `error-swr-states.tsx` shows `isRefreshError` instead of `isError` (DV01, DV02, DV03)
- [ ] `lifecycle-hooks.tsx` has no misleading `isError` display (DV04)
- [ ] `basic-query.tsx` has no `isError` display (DV05)
- [ ] `optimistic-patches.tsx` has no unreachable `isError` code path (DV06)
- [ ] `ssr-snapshot.tsx` has no unreachable `isError` block (DV07)
- [ ] `docs/query-v2/README.md` contains `devtoolsKey` parameter row and `doCacheArgs` clarification
- [ ] `docs/query-v2/devtools.md` mentions `devtoolsKey` and Signal key format for compare strategy
- [ ] No queryFn logic was changed in any demo file
