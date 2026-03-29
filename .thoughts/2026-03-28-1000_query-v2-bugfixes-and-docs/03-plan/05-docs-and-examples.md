---
title: "Phase 5: Docs & Examples"
date: 2026-03-29
stage: 03-plan
role: rdpi-planner
---

## Goal

Fix 3 factual documentation errors, add error handling and lifecycle hooks sections to README, update optimistic-updates.md, add migration note, and create 4–5 interactive examples. All changes reflect the tested, verified behavior from Phases 1–4.

## Dependencies

- **Requires**: Phase 4 (Tests — docs describe tested behavior)
- **Blocks**: None

## Execution

Sequential

## Tasks

### Task 5.1: Fix factual errors in existing docs

- **Complexity**: Low
- **File**: `docs/query-v2/README.md`
- **Action**: Modify
- **Description**: Three corrections:
  1. **Line ~152**: Remove `MachineIdle` from the machine class list. Replace with clarification that `MachinePending` is the initial state.
  2. **Line ~146**: Fix the `idle` row in the machine states table — clarify that "idle" is a conceptual pre-entry state (no `CacheEntry` exists), not a machine class. Or replace with `pending`.
  3. **Line ~340**: Remove `unstable_queryV2.MachineIdle;` from the API reference exports list.
- **Details**:
  - Line numbers are approximate from design research — verify actual positions before editing.
  - [ref: ../02-design/07-docs.md#1.1]

- **File**: `docs/query-v2/devtools.md`
- **Action**: Modify
- **Description**: Remove references to non-existent `devtoolsDebug` option (code examples, Options Reference table, Debug Mode section). Fix `resources` config pattern (line ~10–17) that shows incorrect `createApi({ resources: { ... } })` syntax. Fix `idle` state references (lines ~47, 58, 77) — replace with `MachinePending` or "entry removed." Keep `devtools` and `beforeDevtoolsPush` references (these exist).
- **Details**:
  - [ref: ../02-design/07-docs.md#1.2]

- **File**: `docs/query-v2/optimistic-updates.md`
- **Action**: Modify
- **Description**: In the "Использование через onQueryStarted" section (line ~131), add a brief note that `onQueryStarted` is now functional. No structural changes needed — the documented patterns (`$queryFulfilled`, `getCacheEntry`) are now accurate after Bug #2 fix.
- **Details**:
  - [ref: ../02-design/07-docs.md#1.3]

### Task 5.2: Add Error Handling section to README

- **Complexity**: Medium
- **File**: `docs/query-v2/README.md`
- **Action**: Modify
- **Description**: Add a new section (2–3 paragraphs + one code block) after the existing "Machine States" section covering:
  1. SWR error semantics: `isError=true` AND `data` (stale) coexist when a refetch fails with previous data present. The new state combination `{ status: "refreshing", isError: true, data: staleData, error: Error }` is now valid.
  2. `lastError` field: when a same-args refetch fails, `MachineSuccess` preserves both `data` and `lastError`. Cleared on next successful fetch.
  3. Error recovery: `invalidate()` or arg-change triggers re-fetch.
  4. Brief migration guidance: use `isError`/`isLoading` boolean flags over raw `status` checks.
- **Details**:
  - Keep proportional — ~½ page. Follow existing Russian-language style.
  - [ref: ../02-design/07-docs.md#2.1]
  - [ref: ../02-design/08-risks.md#R3 mitigation]

### Task 5.3: Expand Lifecycle Hooks section in README

- **Complexity**: Medium
- **File**: `docs/query-v2/README.md`
- **Action**: Modify
- **Description**: Expand the existing "Lifecycle Hooks" subsection (currently ~10 lines at end of README) with:
  1. `onQueryStarted` + `$queryFulfilled` usage pattern (1 code example showing callback signature and `$queryFulfilled` await).
  2. `onCacheEntryAdded` + `$cacheDataLoaded` / `$cacheEntryRemoved` — note that `$cacheDataLoaded` now rejects on cache reset (Bug #5 fix). Show mandatory `try/catch` pattern.
  3. Brief deferred migration note (1–2 sentences): comprehensive v1→v2 migration guide is planned, link to `docs/migrations/` pattern.
- **Details**:
  - [ref: ../02-design/07-docs.md#2.2, 2.3]
  - [ref: ../02-design/08-risks.md#R5 mitigation]

### Task 5.4: Create interactive examples (4 required + 1 optional)

- **Complexity**: High
- **File**: `apps/demos/src/examples/query-v2/basic-query.tsx`
- **Action**: Create
- **Description**: Basic entry point example. Shows `createApi` → `createResourceV2` → `useResourceV2Agent` → display loading/success states. Uses `fetches` utility for mock data, HeroUI Card layout. Demonstrates `isLoading`/`isSuccess`/`data` flags.

- **File**: `apps/demos/src/examples/query-v2/error-swr-states.tsx`
- **Action**: Create
- **Description**: Demonstrates Bug #3 fix — error transparency with stale data. Uses a `fetches` mock that fails intermittently. Shows `isError=true` + `data` coexistence, `lastError` on `MachineSuccess`, error recovery via `invalidate()`. Visual: error banner + stale data simultaneously.

- **File**: `apps/demos/src/examples/query-v2/skip-token.tsx`
- **Action**: Create
- **Description**: Shows conditional fetching with `SKIP` sentinel. Toggle between skipped and active query. Demonstrates agent behavior when args are `SKIP`.

- **File**: `apps/demos/src/examples/query-v2/snapshot-hydration.tsx`
- **Action**: Create
- **Description**: Demonstrates Bug #1 fix — hydration without wasted fetch. Shows `createApi({ initialSnapshot })`, `maxSnapshotDataAge`, instant data availability. Visually shows fetch count (0 for fresh snapshot, 1 for stale).

- **File**: `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx` (optional)
- **Action**: Create
- **Description**: Demonstrates `onQueryStarted` + `$queryFulfilled` after Bug #2 fix. Shows hook firing on each query, lifecycle logging. Include only if time permits.

- **Details**:
  - Follow existing patterns: HeroUI `Card`/`CardBody`/`CardHeader`, `fetches` utility, visual state indicators.
  - No commands/mutations — queries only.
  - [ref: ../02-design/07-docs.md#3]

### Task 5.5: Register new examples in examples index

- **Complexity**: Low
- **File**: `apps/demos/src/examples/query-v2/index.ts`
- **Action**: Modify
- **Description**: Add imports for all new example files (`basic-query.tsx`, `error-swr-states.tsx`, `skip-token.tsx`, `snapshot-hydration.tsx`, and optionally `lifecycle-hooks.tsx`) using the existing `?raw` import pattern. Export them in the `examples` object.
- **Details**:
  - Follow existing pattern: `import basicQueryRaw from "./basic-query.tsx?raw";` etc.
  - Add corresponding entries to the `examples` object.
  - [ref: ../02-design/07-docs.md#3]

## Verification

- [ ] `npm run ts-check` passes (including `apps/demos/`)
- [ ] `docs/query-v2/README.md` does not contain `MachineIdle` (grep check)
- [ ] `docs/query-v2/devtools.md` does not contain `devtoolsDebug` (grep check)
- [ ] `docs/query-v2/optimistic-updates.md` `onQueryStarted` section is accurate
- [ ] Error handling section present in README
- [ ] Lifecycle hooks section expanded in README
- [ ] All new example files compile without errors
- [ ] Examples index exports all new examples
- [ ] Demo app builds successfully: `cd apps/demos && npm run build`
