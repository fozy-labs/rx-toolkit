---
title: "Documentation Impact: Query-v2 Bugfixes and Docs"
date: 2026-03-29
stage: 02-design
role: rdpi-architect
---

# Documentation Impact

This document specifies WHAT documentation changes are needed — not how to write them. All changes match the existing Russian-language style of `docs/query-v2/` (except `devtools.md` which is English). Interactive examples follow the existing `apps/demos/` patterns (HeroUI components, `fetches` utility).

---

## 1. Factual Error Fixes (Blocking)

These must ship with the code changes. Incorrect docs are worse than missing docs.

### 1.1 `docs/query-v2/README.md` — Remove `MachineIdle`

- **Line 152**: Remove `MachineIdle` from the machine class list. The actual machine states are `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`, `MachineWithData`.
- **Line 146**: The `idle` row in the machine states table is misleading — there is no `MachineIdle` class. Clarify that `pending` is the initial state when a cache entry is created, or note that "idle" is a conceptual pre-entry state (no `CacheEntry` exists yet).
- **Line 340**: Remove `unstable_queryV2.MachineIdle;` from the API reference exports list.

[ref: ../01-research/01-codebase-analysis.md#Documentation Structure]

### 1.2 `docs/query-v2/devtools.md` — Remove Non-Existent Options

- **`devtoolsDebug` option**: Referenced throughout (`devtoolsDebug: true` in code examples, Options Reference table, Debug Mode section) but does not exist in `TResourceV2Options` or any query-v2 type. Remove all `devtoolsDebug` references.
- **`resources` config pattern** (line 10-17): Shows `createApi({ resources: { ... } })` which is not the actual API. `createApi` returns `{ createResourceV2 }` — resources are created individually.
- **`idle` state reference** (lines 47, 58, 77): Same `idle` issue — there is no `MachineIdle`. The reset state is `MachinePending` (entry re-created) or entry removed entirely.
- Keep `devtools` and `beforeDevtoolsPush` references — these exist in the type system.

[ref: ../01-research/01-codebase-analysis.md#Documentation Structure]

### 1.3 `docs/query-v2/optimistic-updates.md` — `onQueryStarted` Section

- **"Использование через onQueryStarted" section** (line ~131): Currently documents `onQueryStarted` with `$queryFulfilled` as if functional. After Bug #2 fix, this section becomes accurate. Add a brief note that `onQueryStarted` is available since version [TBD].
- No structural changes needed — the documented pattern (`$queryFulfilled`, `getCacheEntry`) matches the design in [ref: 01-architecture.md#5. Fetch Lifecycle], [ref: 02-dataflow.md#2. Query Fetch + onQueryStarted Flow].

---

## 2. Targeted Additions

### 2.1 Error Handling Section — Add to `docs/query-v2/README.md`

A new section (2–3 paragraphs + one code block) covering:

- SWR error semantics after Bug #3 fix: `isError=true` AND `data` (stale) coexist when a refetch fails with previous data present.
- `lastError` field on `MachineSuccess` (new enhancement): when a same-args refetch fails, `MachineSuccess` preserves both `data` and `lastError` for visibility.
- Error recovery: how `invalidate()` or arg-change triggers re-fetch.

Place after the existing "Machine States" section. Keep proportional — RTK Query's error docs are ~1 page; ours should be ~½ page.

[ref: 03-model.md#MachineSuccess — lastError Enhancement]
[ref: 04-decisions.md#ADR-2]

### 2.2 Lifecycle Hooks Guide — Add to `docs/query-v2/README.md`

Expand the existing "Lifecycle Hooks" subsection (currently ~10 lines at end of README) with:

- `onQueryStarted` + `$queryFulfilled` usage pattern (1 code example).
- `onCacheEntryAdded` + `$cacheDataLoaded` / `$cacheEntryRemoved` — note that `$cacheDataLoaded` now rejects on cache reset (Bug #5 fix).
- Keep brief — the optimistic-updates doc already covers the main `onQueryStarted` use case.

[ref: 01-architecture.md#5. Fetch Lifecycle]
[ref: 04-decisions.md#ADR-5]

### 2.3 Deferred Migration Note — `docs/query-v2/README.md`

Add 1–2 sentences in the intro or a "Migration" subsection noting that a comprehensive v1→v2 migration guide is planned. Link to the existing `docs/migrations/` directory pattern. No detailed guide in this scope.

[ref: 00-short-design.md#Scope Boundaries]

---

## 3. Interactive Examples

4–5 examples in `apps/demos/src/examples/query-v2/`. Each follows the existing pattern: HeroUI `Card`/`CardBody`/`CardHeader` layout, `fetches` utility for mock data, visual state indicators. No commands/mutations — queries only (except where patching is demonstrated by existing `optimistic-patches.tsx`).

### 3.1 Basic Query Example

- **Purpose**: Entry point example. Shows `createApi` → `createResourceV2` → `useResourceV2Agent` → display states.
- **Concepts**: Loading → success flow, `isLoading`/`isSuccess`/`data` flags.
- **Relation**: Overlaps with existing `simple-resource.tsx` but focused on minimal clarity. Consider replacing or renaming existing example.

### 3.2 Error & SWR States Example

- **Purpose**: Demonstrates Bug #3 fix — error transparency with stale data.
- **Concepts**: `isError=true` + `data` coexistence, `lastError` on `MachineSuccess`, `error` field visibility during SWR, error recovery via `invalidate()`.
- **Relation**: New — no existing example covers error states. Uses a `fetches` mock that fails intermittently.

### 3.3 SKIP Token Example

- **Purpose**: Shows conditional fetching with `SKIP` sentinel.
- **Concepts**: `SKIP` token usage, agent behavior when args are `SKIP`, transition from skipped to active query.
- **Relation**: New — no existing example for SKIP. Mentioned in README but no visual demo.

### 3.4 Snapshot Hydration Example

- **Purpose**: Demonstrates Bug #1 fix — hydration without wasted fetch.
- **Concepts**: `createApi({ initialSnapshot })`, `maxSnapshotDataAge`, instant data availability, stale snapshot triggers refetch.
- **Relation**: Extends existing `ssr-snapshot.tsx`. The existing demo simulates snapshot hydration but doesn't highlight the zero-fetch behavior. New example should visually show fetch count (0 for fresh, 1 for stale).

### 3.5 (Optional) Lifecycle Hooks Example

- **Purpose**: Demonstrates `onQueryStarted` + `$queryFulfilled` after Bug #2 fix.
- **Concepts**: Hook fires on each query, `$queryFulfilled` resolves/rejects, lifecycle logging.
- **Relation**: Complements existing `optimistic-patches.tsx` (which uses manual `createPatch`). Shows the declarative hook-based alternative.
- **Include only if**: Bug #2 fix is confirmed in implementation scope. Otherwise defer.

---

## 4. Existing Docs — No Changes Needed

| Document | Reason |
|----------|--------|
| `docs/query-v2/ssr.md` | Accurate. Snapshot format and hydration flow unchanged. Bug #1 fix is internal — SSR docs describe the user-facing API correctly. |
| `docs/query-v2/optimistic-updates.md` (sections other than §onQueryStarted) | Patch mechanics (`createPatch`, `commit`, `abort`, consistency violations) are unaffected by Bugs #1–#5. Bug #4 fix is internal to `Patcher.resolvePatches`. |
| `docs/devtools/README.md` | Separate from query-v2 devtools doc. Not in scope. |
| `docs/signals/README.md` | No changes — signals module unaffected. |
