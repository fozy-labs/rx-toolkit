---
title: "Verification: Phase 8"
date: 2026-03-26
stage: 04-implement
role: rdpi-tester
---

## Results

| Check | Status | Details |
|-------|--------|---------|
| ts-check (non-legacy) | PASS | 0 errors outside `src/query-v2-legacy/`. 114 errors in legacy — all pre-existing. |
| INT01: full pipeline query→cache→agent | PASS | |
| INT02: React hook→fetch→render→SWR | PASS | (stderr: setState-in-render warning — known React hook issue) |
| INT03: ReactHooksPlugin contributes hooks | PASS | |
| INT04: Snapshot SSR round-trip | PASS | |
| INT05: GC — data cached before timer expires | PASS | |
| INT06: GC — entry removed after timer expires | FAIL | `expected ResourceV2CacheEntry{…} to be null` — entry not GC'd after timer. Related to pre-existing GC failures (GC01–GC05). |
| INT07: createPatch + abort rolls back | PASS | |
| INT08: createPatch + commit persists | PASS | |
| INT09: consistency violation → auto-invalidation | FAIL | `expected 1 to be greater than 1` — queryFn not called a second time after consistency violation abort. Auto-invalidation/refetch not triggered. |
| INT10: resetAll clears all agents/entries | PASS | |
| INT11: Multi-agent shared cache | PASS | |
| INT12: Args change — old request not aborted | PASS | |
| INT13: Lifecycle hooks fire in correct order | FAIL | `expected ['cacheEntryAdded:1'] to include 'cacheDataLoaded:1'` — `cacheDataLoaded` callback never fires after query resolution. |
| INT14: Plugin augmentResource receives merged options | PASS | |
| E01: queryFn throws synchronously → error | FAIL | Sync throw propagates uncaught instead of being caught by `_doFetch`. Stack: `ResourceV2CacheEntry._doFetch` → `ResourceV2.query`. |
| E02: queryFn rejected promise → error | PASS | |
| E03: null as valid TData | PASS | |
| E04: large args serialization | PASS | |
| E05: resource never queried — no leaks | PASS | |
| E06: resetCache during inflight | PASS | |
| E07: hydrated entry used without re-fetch | PASS | |
| E08: AbortError — no spurious transitions | PASS | |
| E09: double-commit/abort idempotent | PASS | |
| E10: createPatch during refreshing | PASS | |
| Full suite regression (non-known) | PASS | No new regressions beyond the 4 failures above. |
| Barrel: `getSnapshot` exported | FAIL | `getSnapshot` exists in `core/Snapshot.ts` and `core/index.ts` but is NOT re-exported from `src/query-v2/index.ts`. Plan Task 8.7 requires it. |
| Barrel: `Patcher` exported | FAIL | `Patcher` exists in `core/machines/index.ts` but is NOT re-exported from `src/query-v2/index.ts`. Plan Task 8.7 requires it. |
| Barrel: all §15 public symbols present | FAIL | Missing `getSnapshot` and `Patcher` value exports. |
| Barrel: no internal symbols leak | FAIL | `export type * from "./types"` re-exports internal types from `cache.types.ts`: `ICacheEntry`, `ICacheEntryOptions`, `ICacheMap`, `TCacheMapFactory`, `ICacheMapOptions` (all marked Internal in §15). |
| `src/index.ts` re-exports `unstable_queryV2` | PASS | `export * as unstable_queryV2 from "./query-v2"` — correct. |
| Circular imports | SKIPPED | `madge` not available in project. ts-check passing (non-legacy) provides indirect confidence. |

## Known Pre-existing Failures (NOT counted)

These were documented before Phase 13 and are excluded from the pass/fail count:

- **RE19–RE22** (4 tests): Batcher/`_status$` tests in ResourceV2.test.ts
- **GC01–GC05** (5 tests): Garbage collection tests in ResourceV2.test.ts
- **useResourceV2Agent.test.ts** (10 tests): Entire file — infinite re-render loop (Phase 12 known issue)
- **PL10** (1 test): `augmented resource does not expose non-existent methods` — Invalid hook call outside React component (related to React hook issue)

Total pre-existing: 20 tests.

## Summary

**22/30** checks passed, **7 failed**, **1 skipped**.

New Phase 13 failures requiring fixes:

1. **INT09** — Consistency violation auto-invalidation not triggering refetch. `Patcher` abort with `isConsistencyViolation` does not cause the entry to transition to refreshing.
2. **INT13** — `onCacheEntryAdded` lifecycle `cacheDataLoaded` promise never resolves. The lifecycle hook system doesn't fire the data-loaded callback after query success.
3. **E01** — Synchronous throw in `queryFn` not caught by `_doFetch()`. The `queryFn()` call in `ResourceV2CacheEntry._doFetch` is not wrapped in try/catch.
4. **INT06** — GC timer expiration doesn't remove entry. Related to pre-existing GC failures (GC01–GC05) — the GC mechanism itself is broken, not the test.
5. **Barrel: missing exports** — `getSnapshot` and `Patcher` not re-exported from `src/query-v2/index.ts`.
6. **Barrel: internal type leak** — `ICacheEntry`, `ICacheEntryOptions`, `ICacheMap`, `TCacheMapFactory`, `ICacheMapOptions` leak through `export type * from "./types"`.
