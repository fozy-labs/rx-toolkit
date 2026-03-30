---
title: "Implementation: query-v2 CompareCacheMap, devtools key extraction, lifecycle hooks, and demo fixes"
date: 2026-03-30
status: Approved
feature: "Restructure CompareCacheMap to use Map, add devtoolsKey option, move LifecycleHooks to ResourceEntry, fix demo isError descriptions"
plan: "../03-plan/README.md"
---

## Status
- Phases completed: 4/4
- Verification: all passed (36/36 checks across 4 verification reports)
- Issues: none

## Quality Review

### Checklist
| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | All plan phases implemented | PASS | Phase 1 (Tasks 1.1–1.10), Phase 2 (Tasks 2.1–2.7), Phase 3 (Task 3.1), Phase 4 (Tasks 4.1–4.7) — all tasks executed. |
| 2 | Verification passed for each phase | PASS | verification-1: 9/9, verification-2: 12/12, verification-3: 7/7, verification-4: 8/8. Zero failures across all 36 checks. |
| 3 | No files outside plan scope modified | PASS | Modified files match the plan scope exactly: 10 src files (Phase 1), 5 modify + 2 delete (Phase 2), 1 create (Phase 3), 5 demos + 2 docs (Phase 4). No unplanned files touched. `LifecycleHooks.ts` and its test deleted as planned. |
| 4 | Code follows project patterns | PASS | Naming conventions maintained (`_private` prefix, `$` suffix for promises/observables, camelCase). `@/` alias used consistently. Indentation matches existing files. Class structure follows `CacheEntry` inheritance pattern. |
| 5 | Barrel exports updated correctly | PASS | `src/query-v2/core/index.ts` — `LifecycleHooks` export removed (Task 2.4). No new public symbols requiring barrel export changes. `ICacheMap` interface change (`entries()` removal) is transparent to barrel exports. |
| 6 | TypeScript strict mode maintained | PASS | `npm run ts-check` passed after every phase with zero errors. No `any` types introduced. Nullable resolver fields use `T | null` pattern. `readonly argsKey: string` properly typed on both interface and class. |
| 7 | Documentation proportional to existing docs/demos | PASS | `docs/query-v2/README.md`: 1 table row (`devtoolsKey`), `doCacheArgs` clarification, 2–3 sentences under Cache Strategies. `docs/query-v2/devtools.md`: 1 table row + Signal key format paragraph. Proportional to existing ~350 lines across 4 docs. Demos: 5 files with text/label corrections only, no structural changes. |
| 8 | No security vulnerabilities | PASS | No user input handled unsafely. `devtoolsKey` callback is user-provided but only produces string keys for devtools display. `PromiseResolver` reject/resolve are internal-only. No new network calls, no DOM manipulation in src. |

### Documentation Proportionality

Existing `docs/query-v2/` contains 4 files (~350 lines). Implementation added:
- `docs/query-v2/README.md`: `devtoolsKey` parameter row, `doCacheArgs` serialize-only clarification, compare-strategy counter explanation (2–3 sentences)
- `docs/query-v2/devtools.md`: `devtoolsKey` in Options Reference table, Signal Key Format section (3–4 sentences)
- No change to: `optimistic-updates.md`, `ssr.md`

Demo changes: 5 of 8 query-v2 example files modified — text/label corrections only (no new files, no structural changes, no queryFn logic changes). All `isError` misleading displays replaced with `isRefreshError` derivation or removed with SWR semantics comments.

Proportional to the scope — one new public option (`devtoolsKey`), one clarification (`doCacheArgs`), five demo label fixes. Neither over-documented nor under-documented.

### Issues Found

No issues found.

## Verification Results Summary

| Phase | Report | Checks | Status |
|-------|--------|--------|--------|
| 1 — CacheMap + Factory + Consumers | [verification-1.md](./verification-1.md) | 9/9 | PASS |
| 2 — LifecycleHooks Elimination | [verification-2.md](./verification-2.md) | 12/12 | PASS |
| 3 — Integration Tests | [verification-3.md](./verification-3.md) | 7/7 | PASS |
| 4 — Demo Fixes + Documentation | [verification-4.md](./verification-4.md) | 8/8 | PASS |

Key verification highlights:
- **334 tests pass** (full query-v2 suite after all phases, 0 failures)
- **Zero `LifecycleHooks` references** remain in `src/query-v2/`
- **Zero `cacheEntries` references** remain in `src/query-v2/`
- **CM51**: `serializeArgs` called exactly once per new entry (problem #4 fix verified)
- **IT01**: Zero `stableStringify` calls for compare strategy (problem #3 fix verified)
- **LH20**: Concurrent entries have independent `$queryFulfilled` (problem #5 fix verified)
- **LH30**: Hydrated entry `$cacheDataLoaded` resolves immediately (R9 hydration fix verified)

## Change Summary

### Phase 1 — CacheMap + Factory + Consumer Migration + CacheMap Tests
- `src/query-v2/types/cache.types.ts` — Removed `entries()` from `ICacheMap`, changed `TCacheMapFactory` to `(args, argsKey) => TEntry`, added `devtoolsKey` to `ICacheMapOptions`
- `src/query-v2/types/resource.types.ts` — Added `devtoolsKey` to `TResourceV2Options`, added `readonly argsKey: string` to `IResourceV2CacheEntry`
- `src/query-v2/core/CacheMap/CompareCacheMap.ts` — Full rewrite: `Array<{args, entry}>` → `Map<TArgs, TEntry>`, removed `_compareArg`/`_find`/`entries()`, added `_counter`/`_devtoolsKey`, O(1) operations
- `src/query-v2/core/CacheMap/SerializeCacheMap.ts` — `getOrCreate` passes pre-computed `key` to factory, removed `entries()`
- `src/query-v2/core/resource/ResourceV2.ts` — Factory closure → passthrough `(args, argsKey)`, removed `serializeFn` intermediate, added `devtoolsKey` to createCacheMap options, renamed `cacheEntries()` → `cacheValues()`, added `keyStrategy` accessor
- `src/query-v2/core/resource/ResourceV2CacheEntry.ts` — Added `readonly argsKey: string` field
- `src/query-v2/core/Snapshot.ts` — Migrated to `cacheValues()` + `entry.argsKey`, replaced `typeof key !== "string"` guard with `resource.keyStrategy === "compare"` throw
- `src/query-v2/api/createApi.ts` — Changed `cacheEntries()` → `cacheValues()` in stale check loop
- `src/query-v2/core/CacheMap/__tests__/CacheMap.test.ts` — Updated factory signatures, added CM20–CM56 tests
- `src/query-v2/core/resource/__tests__/ResourceV2.test.ts` — Updated `cacheEntries` → `cacheValues`
- `src/query-v2/core/__tests__/Snapshot.test.ts` — Updated for `cacheValues()` + `entry.argsKey`

### Phase 2 — LifecycleHooks Elimination + Lifecycle Tests
- `src/query-v2/core/resource/ResourceV2CacheEntry.ts` — Added lifecycle resolver state (`_entryDataLoaded`, `_entryRemoved`, `_queryFulfilled`), replaced closure callbacks with `TOnCacheEntryAdded`/`TOnQueryStarted`, implemented `_fireCacheEntryAdded()` with hydration check, updated `_doFetch()` and `complete()` with resolver management
- `src/query-v2/core/resource/ResourceV2.ts` — Removed `LifecycleHooks` import/field, store callbacks directly, updated `_entryFactory` to pass callbacks, removed `clearAll()` from `resetCache()`
- `src/query-v2/core/LifecycleHooks.ts` — **Deleted** (113 lines, class absorbed by entry)
- `src/query-v2/core/index.ts` — Removed `LifecycleHooks` export
- `src/query-v2/core/__tests__/LifecycleHooks.test.ts` — **Deleted** (replaced by LH10–LH33 in entry tests)
- `src/query-v2/core/resource/__tests__/ResourceV2CacheEntry.test.ts` — Added 24 per-entry lifecycle tests (LH10–LH33) + edge cases
- `src/query-v2/core/resource/__tests__/ResourceV2.test.ts` — Updated for new lifecycle model

### Phase 3 — Integration Tests
- `src/query-v2/__tests__/integration/cachemap-lifecycle-integration.test.ts` — **Created** with 8 integration tests (IT01–IT08): CacheMap devtools key verification, lifecycle hook flows, Snapshot consumer migration, createApi stale check path

### Phase 4 — Demo Fixes + Documentation
- `apps/demos/src/examples/query-v2/error-swr-states.tsx` — Relabeled as SWR recovery demo, replaced `isError` with `isRefreshError` derivation, added `state.error` display
- `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx` — Removed misleading `isError` display
- `apps/demos/src/examples/query-v2/basic-query.tsx` — Removed `isError` badge
- `apps/demos/src/examples/query-v2/optimistic-patches.tsx` — Removed unreachable `if (state.isError)` early return
- `apps/demos/src/examples/query-v2/ssr-snapshot.tsx` — Removed unreachable `isError` conditional block
- `docs/query-v2/README.md` — Added `devtoolsKey` parameter row, `doCacheArgs` clarification, compare-strategy counter explanation
- `docs/query-v2/devtools.md` — Added `devtoolsKey` option reference, Signal key format section

## Post-Implementation Recommendations
- [ ] Full build: `npm run build`
- [ ] Full test run: `npm run test`
- [ ] Manual testing — demo visual checks:
  - DV01: `error-swr-states.tsx` — `isRefreshError` badge turns active on SWR error, stays inactive on success
  - DV02: `error-swr-states.tsx` — SWR error banner displays `state.error` content
  - DV03: `error-swr-states.tsx` — State log shows `isRefreshError=true/false` transitions
  - DV04: `lifecycle-hooks.tsx` — No misleading `isError` display
  - DV05: `basic-query.tsx` — No `isError` badge visible
  - DV06: `optimistic-patches.tsx` — No dead-code error return path
  - DV07: `ssr-snapshot.tsx` — No unreachable error block

## Recommended Commit Message

```
refactor(query-v2): restructure CacheMap, lifecycle hooks, devtools keys, and demo fixes

- Replace CompareCacheMap Array<{args, entry}> with Map<TArgs, TEntry> (O(1) lookup)
- Add devtoolsKey option for compare strategy (default: monotonic counter)
- Eliminate double serialization via TCacheMapFactory signature change (args, argsKey)
- Remove entries() from ICacheMap, migrate consumers to values() + entry.argsKey
- Move lifecycle resolver state from shared LifecycleHooks to per-entry ownership
- Delete LifecycleHooks class (absorbed by ResourceV2CacheEntry)
- Fix misleading isError UI in 5 demo files (SWR semantics: isRefreshError)
- Update docs: devtoolsKey option, doCacheArgs clarification, Signal key format
- Add 70+ new tests: CacheMap (CM20–CM56), lifecycle (LH10–LH33), integration (IT01–IT08)

Resolves: problems #1–#6 from TASK.md
```
