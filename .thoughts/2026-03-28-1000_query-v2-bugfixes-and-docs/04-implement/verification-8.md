---
title: "Verification: Phase 12"
date: 2026-03-29
stage: 04-implement
role: rdpi-tester
---

## Results

| Check | Status | Details |
|-------|--------|---------|
| `npx tsc --noEmit` (root) | PASS | Exit code 0, no errors |
| `cd apps/demos && npx tsc --noEmit` | PASS | Exit code 0, no errors |
| lifecycle-hooks.tsx — `onQueryStarted` API | PASS | Configured at resource level via `api.createResourceV2({ onQueryStarted })`. Callback signature `(args, { $queryFulfilled })` matches `TOnQueryStarted<TArgs, TData>`. `$queryFulfilled` resolves to `{ data }` — correct per `IQueryStartedTools`. |
| lifecycle-hooks.tsx — `onCacheEntryAdded` API | PASS | Configured at resource level via `api.createResourceV2({ onCacheEntryAdded })`. Callback signature `(args, { $cacheDataLoaded, $cacheEntryRemoved })` matches `TOnCacheEntryAdded<TArgs, TData>`. `$cacheDataLoaded` resolves to `TData` directly — correct per `ICacheEntryAddedTools`. |
| lifecycle-hooks.tsx — NOT a React hook | PASS | Lifecycle hooks configured in `createResourceV2` options object, not as a React hook. Correct pattern. |
| basic-query.tsx — correct API | PASS | Uses `createApi` → `createResourceV2` → `useResourceV2Agent`. Correct pattern. |
| error-swr-states.tsx — SWR states | PASS | Uses `createResourceV2` with error-throwing queryFn, `useResourceV2Agent` state for `isError`, `isRefreshing`, `data` (stale). `invalidate()` for refetch. Correct SWR demo. |
| skip-token.tsx — SKIP token | PASS | Uses `unstable_queryV2.SKIP` as args to `useResourceV2Agent(selectedId !== null ? { userId: selectedId } : unstable_queryV2.SKIP)`. Correct pattern. |
| snapshot-hydration.tsx — initialSnapshot | PASS | Uses `createApi({ initialSnapshot: freshSnapshot, maxSnapshotDataAge })`. Snapshot structure uses `CURRENT_SNAPSHOT_VERSION`, correct resource/entry format. Correct pattern. |
| All examples query-only | PASS | No `createCommand`, no mutations, no optimistic update patterns in any of the 5 new examples. Query-only per TASK.md item #7. |
| QueriesV2Page.mdx — all tabs present | PASS | 8 total tabs: simpleResource, optimisticPatches, ssrSnapshot (pre-existing) + basicQuery, errorSwrStates, skipToken, snapshotHydration, lifecycleHooks (new). All correctly wired via `QueryV2.examples.<key>`. |
| `npx vitest run src/query-v2/` | PASS | 23 test files, 280 tests passed, 0 failures |

## Summary
12/12 checks passed.
