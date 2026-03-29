---
title: "Verification: Phase 2"
date: 2026-03-29
stage: 04-implement
role: rdpi-tester
---

## Results

| Check | Status | Details |
|-------|--------|---------|
| ts-check | PASS | `npx tsc --noEmit` exit code 0, no errors |
| vitest — existing tests | PARTIAL | 245/248 tests pass, 3 failures + 1 unhandled rejection (see below) |
| Snapshot hydration: `_doFetch` NOT called with `initialMachine` | PASS | Constructor: `if (!options.initialMachine) { this._doFetch()... }` — hydrated entries skip fetch |
| Normal entry: `_doFetch` IS called without `initialMachine` | PASS | Constructor: `super(options.initialMachine ?? new MachinePending(...))` then `_doFetch()` for non-hydrated |
| `fireQueryStarted` before `queryFn` in `_doFetch` | PASS | `_doFetch` calls `this._onQueryStarted?.(this._args, this)` before `this._queryFn(...)` (lines ~170–176) |
| `resolveQueryFulfilled` on success/error | PASS | `this._onQueryFulfilled?.(this._args, { data })` in success handler; `this._onQueryFulfilled?.(this._args, { error })` in both error and sync-error paths |
| `$cacheDataLoaded` rejects before `$cacheEntryRemoved` in `fireCacheEntryRemoved` | PASS | Order: (1) `resolvers.dataLoaded.reject(...)`, (2) `resolvers.entryRemoved.resolve()`, (3) `delete` |

## Test Failures Detail

### E07 (EXPECTED)
**Test**: `E07: hydrated entry is used without re-fetch when queried with same args`
**Error**: `expected "vi.fn()" to be called 1 times, but got 0 times`
**Reason**: Test documents old buggy behavior — expected queryFn to be called once on hydrated entry. Bug #1 fix correctly skips `_doFetch` for hydrated entries, so queryFn is called 0 times. **Expected failure per plan.**

### AP08c (EXPECTED — same root cause as E07)
**Test**: `AP08c: Snapshot data older than maxSnapshotDataAge triggers auto-invalidation on createResourceV2`
**Error**: `expected "vi.fn()" to be called 2 times, but got 1 times`
**Reason**: Test expects 2 queryFn calls (one per hydrated+auto-invalidated entry). With Bug #1 fix, hydrated entries no longer auto-fetch on construction — the auto-invalidation call to `invalidate()` must now be the sole trigger. The missing call is the construction-time fetch that no longer occurs. **Same root cause as E07 — snapshot hydration no longer triggers `_doFetch`.**

### INT04 (EXPECTED — same root cause as E07)
**Test**: `INT04: server capture → serialize → deserialize → client createApi → createResourceV2 → React hook uses hydrated data`
**Error**: `expected "vi.fn()" to be called 1 times, but got 0 times`
**Reason**: Integration test expects hydrated entry to trigger queryFn once. Bug #1 fix correctly prevents this. **Same root cause as E07.**

### Unhandled Rejection (Bug #5 side-effect)
**Source**: `LifecycleHooks.test.ts` — test LH03 calls `fireCacheEntryRemoved` which now rejects `$cacheDataLoaded` (Bug #5 fix). The test passes, but the rejection propagates as an unhandled promise rejection because the test doesn't `.catch()` the `$cacheDataLoaded` promise.
**Impact**: Warning only — does not cause test failure but produces noise. Should be addressed in Phase 4 (Tests) when tests are updated.

## Summary
7/7 behavioral checks passed.
3/248 test failures — all 3 are expected consequences of Bug #1 fix (snapshot hydration no longer triggers `_doFetch`). 1 unhandled rejection warning from Bug #5 fix side-effect in existing test.

All failures are in tests that document pre-fix behavior. These tests need updating in Phase 4 (Tests).
